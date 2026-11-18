import crypto from 'crypto';
import { logApp, logAppError, serializeError } from '../requestLog';

export type SlackConfig = {
  botToken: string;
  signingSecret: string;
  defaultChannel: string;
  ready: boolean;
};

export function slackConfig(env: NodeJS.ProcessEnv = process.env): SlackConfig {
  const botToken = env.SLACK_BOT_TOKEN?.trim() || '';
  const signingSecret = env.SLACK_SIGNING_SECRET?.trim() || '';
  const defaultChannel = env.SLACK_DEFAULT_CHANNEL?.trim() || '';
  return {
    botToken,
    signingSecret,
    defaultChannel,
    ready: Boolean(botToken && signingSecret),
  };
}

/** Verify Slack request signature (v0). */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowMs?: number;
}): { ok: true } | { ok: false; error: string } {
  const secret = input.signingSecret?.trim();
  if (!secret) return { ok: false, error: 'Slack signing secret missing' };
  if (!input.timestamp || !input.signature) return { ok: false, error: 'Missing Slack signature headers' };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Invalid Slack timestamp' };
  const now = input.nowMs ?? Date.now();
  if (Math.abs(now / 1000 - ts) > 60 * 5) return { ok: false, error: 'Slack timestamp too old' };

  const base = `v0:${input.timestamp}:${input.rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');
  const expected = `v0=${digest}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid Slack signature' };
  }
  return { ok: true };
}

export type SlackPostResult = { ok: true; ts: string | null } | { ok: false; error: string };

export async function postSlackMessage(
  input: { channel: string; text: string },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SlackPostResult> {
  const cfg = slackConfig(env);
  if (!cfg.botToken) return { ok: false, error: 'SLACK_BOT_TOKEN missing' };
  const channel = input.channel.trim();
  if (!channel) return { ok: false, error: 'No Slack channel' };
  try {
    const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: input.text }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; ts?: string };
    if (!body.ok) {
      logAppError('slack.post', { error: body.error || `HTTP ${res.status}` });
      return { ok: false, error: body.error || 'Slack post failed' };
    }
    logApp('slack.post', { channel, ts: body.ts || null });
    return { ok: true, ts: body.ts || null };
  } catch (error: unknown) {
    logAppError('slack.post', serializeError(error));
    return { ok: false, error: 'Slack post failed' };
  }
}

export async function slackUserEmail(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const cfg = slackConfig(env);
  if (!cfg.botToken || !userId) return null;
  try {
    const url = `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${cfg.botToken}` },
    });
    const body = (await res.json()) as {
      ok?: boolean;
      user?: { profile?: { email?: string } };
    };
    const email = body.ok ? body.user?.profile?.email?.trim().toLowerCase() : null;
    return email && email.includes('@') ? email : null;
  } catch (error: unknown) {
    logAppError('slack.user', serializeError(error));
    return null;
  }
}
