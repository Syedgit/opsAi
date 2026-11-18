import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { handleSlackAsk, type SlackAskEvent } from '../../lib/notify/slackAsk';
import { slackConfig, verifySlackSignature } from '../../lib/notify/slack';
import { readRawBody } from '../../lib/whatsappSignature';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

/** Slack signs the raw bytes. */
export const config = { api: { bodyParser: false } };

async function rawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return readRawBody(req);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cfg = slackConfig();
  if (!cfg.ready) {
    res.status(503).json({ error: 'Slack is not configured' });
    return;
  }

  let raw = '';
  try {
    raw = await rawBody(req);
  } catch (error: unknown) {
    logAppError('slack.webhook.body', serializeError(error));
    res.status(400).json({ error: 'Could not read body' });
    return;
  }

  const sig = verifySlackSignature({
    signingSecret: cfg.signingSecret,
    timestamp: typeof req.headers['x-slack-request-timestamp'] === 'string'
      ? req.headers['x-slack-request-timestamp']
      : undefined,
    signature: typeof req.headers['x-slack-signature'] === 'string' ? req.headers['x-slack-signature'] : undefined,
    rawBody: raw,
  });
  if (!sig.ok) {
    res.status(401).json({ error: sig.error });
    return;
  }

  let payload: {
    type?: string;
    challenge?: string;
    event?: SlackAskEvent;
    event_id?: string;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // URL verification challenge
  if (payload.type === 'url_verification' && payload.challenge) {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  if (payload.type !== 'event_callback' || !payload.event) {
    logApp('slack.webhook', { ignored: true, type: payload.type || null });
    res.status(200).json({ ok: true });
    return;
  }

  const event = payload.event;
  const isDm = event.type === 'message' && (event.channel_type === 'im' || event.channel?.startsWith('D'));
  const isMention = event.type === 'app_mention';
  if (!isDm && !isMention) {
    logApp('slack.webhook', { ignored: true, eventType: event.type || null });
    res.status(200).json({ ok: true });
    return;
  }
  if (event.type === 'message' && event.subtype && event.subtype !== 'file_share') {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const result = await handleSlackAsk(prisma, event);
    logApp('slack.webhook', { handled: result.ok, reason: result.reason || null, eventId: payload.event_id || null });
    res.status(200).json({ ok: true, ...result });
  } catch (error: unknown) {
    logAppError('slack.webhook', serializeError(error));
    res.status(200).json({ ok: true, handled: false });
  }
}

export default loggedHandler('slack.webhook', handler);
