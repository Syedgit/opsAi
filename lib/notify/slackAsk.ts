import type { PrismaClient } from '@prisma/client';
import { answerAiChatQuestion } from '../aiChatAsk';
import { isAiChatEnrolled } from '../aiChatAccess';
import { resolveAgentPack } from '../agents/crew';
import { readStoredSetup } from '../tasks/storeSetup';
import { readChannelPrefs } from './channels';
import { postSlackMessage, slackUserEmail } from './slack';
import { logApp, logAppError, serializeError } from '../requestLog';

export type SlackAskEvent = {
  type?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  bot_id?: string;
  subtype?: string;
  team?: string;
};

/**
 * Map Slack user → opsAi owner/manager by email, pick a store (prefer Slack-enabled),
 * run the same Supervisor ask pipeline as Crew.
 */
export async function handleSlackAsk(
  prisma: PrismaClient,
  event: SlackAskEvent,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; reason?: string }> {
  if (event.bot_id || event.subtype === 'bot_message') {
    return { ok: false, reason: 'bot_message' };
  }
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!text || text.length < 2) return { ok: false, reason: 'empty' };
  if (!event.user || !event.channel) return { ok: false, reason: 'missing_fields' };

  const email = await slackUserEmail(event.user, env);
  if (!email) {
    await postSlackMessage(
      {
        channel: event.channel,
        text: 'I could not match your Slack account to an opsAi login. Use the same email on both, then try again.',
      },
      env
    );
    return { ok: false, reason: 'no_email' };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isActive: true,
      stores: {
        where: { role: { in: ['OWNER', 'MANAGER'] } },
        select: {
          storeId: true,
          store: { select: { storeId: true, storeName: true, active: true, profileJson: true, setupJson: true } },
        },
      },
    },
  });
  if (!user?.isActive || user.stores.length === 0) {
    await postSlackMessage(
      {
        channel: event.channel,
        text: 'No opsAi store linked to this email. Sign in on the web dashboard first.',
      },
      env
    );
    return { ok: false, reason: 'no_user' };
  }

  const active = user.stores.filter((row) => row.store.active);
  const slackEnabled = active.filter((row) => readChannelPrefs(row.store.profileJson).slack.enabled);
  const pool = slackEnabled.length ? slackEnabled : active;
  const booksFirst = pool.find((row) => isAiChatEnrolled(row.store.profileJson)) || pool[0];
  if (!booksFirst) return { ok: false, reason: 'no_store' };

  const storeId = booksFirst.store.storeId;
  if (!isAiChatEnrolled(booksFirst.store.profileJson)) {
    await postSlackMessage(
      {
        channel: event.channel,
        text: `Books is not enrolled for ${booksFirst.store.storeName}. Enable it under Store admin → Crew.`,
      },
      env
    );
    return { ok: false, reason: 'books_off' };
  }

  try {
    const pack = resolveAgentPack(
      booksFirst.store.profileJson,
      readStoredSetup(booksFirst.store.setupJson)?.storeType ?? null
    );
    const result = await answerAiChatQuestion(prisma, storeId, booksFirst.store.storeName, text, {
      history: [],
      agentFilter: 'supervisor',
      booksEnrolled: true,
      pack,
      env,
    });
    const reply =
      (!result.skipped && result.answer) ||
      'I could not answer that from confirmed data. Try standing, open invoices, or missing closes.';
    await postSlackMessage({ channel: event.channel, text: reply.slice(0, 3500) }, env);
    logApp('slack.ask', {
      storeId,
      userId: user.id,
      toolId: result.toolId || null,
      agentId: result.agentId,
    });
    return { ok: true };
  } catch (error: unknown) {
    logAppError('slack.ask', serializeError(error));
    await postSlackMessage(
      { channel: event.channel, text: 'Something went wrong answering that. Try again from Crew on the web.' },
      env
    );
    return { ok: false, reason: 'ask_failed' };
  }
}
