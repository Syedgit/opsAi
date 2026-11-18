/**
 * Owner/manager channel prefs on store profileJson.
 * Email digests and Slack are outbound/manager channels — not field capture.
 */

import {
  readToolsWanted,
  toolsBoardPayload,
  withToolsWanted,
  type ToolsWanted,
  type ToolId,
} from './tools';

export type EmailDigestPrefs = {
  enabled: boolean;
  /** Override recipient; otherwise owners/managers on the store get digests. */
  to: string | null;
};

export type SlackPrefs = {
  enabled: boolean;
  /** Channel or DM id for alerts / morning brief. */
  channelId: string | null;
  /** Slack team id when connected. */
  teamId: string | null;
};

export type TaskAlertsPrefs = {
  /** WhatsApp due / remind / escalate for shift tasks. Default on. */
  enabled: boolean;
};

export type ChannelPrefs = {
  emailDigest: EmailDigestPrefs;
  slack: SlackPrefs;
  taskAlerts: TaskAlertsPrefs;
  tools: ToolsWanted;
};

const DEFAULTS: ChannelPrefs = {
  emailDigest: { enabled: false, to: null },
  slack: { enabled: false, channelId: null, teamId: null },
  taskAlerts: { enabled: true },
  tools: readToolsWanted(null),
};

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readChannelPrefs(profileJson: unknown): ChannelPrefs {
  const profile = asObj(profileJson) || {};
  const channels = asObj(profile.channels) || {};
  const emailRaw = asObj(channels.emailDigest) || asObj(profile.emailDigest) || {};
  const slackRaw = asObj(channels.slack) || asObj(profile.slack) || {};
  const to =
    typeof emailRaw.to === 'string' && emailRaw.to.includes('@') ? emailRaw.to.trim().toLowerCase() : null;
  const channelId =
    typeof slackRaw.channelId === 'string' && slackRaw.channelId.trim()
      ? slackRaw.channelId.trim()
      : null;
  const teamId =
    typeof slackRaw.teamId === 'string' && slackRaw.teamId.trim() ? slackRaw.teamId.trim() : null;
  const taskAlertsRaw = asObj(channels.taskAlerts) || {};
  return {
    emailDigest: {
      enabled: emailRaw.enabled === true,
      to,
    },
    slack: {
      enabled: slackRaw.enabled === true,
      channelId,
      teamId,
    },
    // Default on — only an explicit false pauses WhatsApp task alerts.
    taskAlerts: { enabled: taskAlertsRaw.enabled !== false },
    tools: readToolsWanted(profileJson),
  };
}

/** Whether due / remind / escalate may send WhatsApp for this store. */
export function taskAlertsEnabled(profileJson: unknown): boolean {
  return readChannelPrefs(profileJson).taskAlerts.enabled;
}

export function withChannelPrefs(
  profileJson: unknown,
  patch: {
    emailDigest?: Partial<EmailDigestPrefs>;
    slack?: Partial<SlackPrefs>;
    taskAlerts?: Partial<TaskAlertsPrefs>;
    tools?: Partial<ToolsWanted>;
  }
): Record<string, unknown> {
  let base = asObj(profileJson) ? { ...(profileJson as Record<string, unknown>) } : {};
  if (patch.tools) {
    base = withToolsWanted(base, patch.tools);
  }
  const prev = readChannelPrefs(base);
  const emailDigest: EmailDigestPrefs = {
    enabled: patch.emailDigest?.enabled ?? prev.emailDigest.enabled,
    to:
      patch.emailDigest && 'to' in patch.emailDigest
        ? patch.emailDigest.to
          ? String(patch.emailDigest.to).trim().toLowerCase()
          : null
        : prev.emailDigest.to,
  };
  const slack: SlackPrefs = {
    enabled: patch.slack?.enabled ?? prev.slack.enabled,
    channelId:
      patch.slack && 'channelId' in patch.slack
        ? patch.slack.channelId
          ? String(patch.slack.channelId).trim()
          : null
        : prev.slack.channelId,
    teamId:
      patch.slack && 'teamId' in patch.slack
        ? patch.slack.teamId
          ? String(patch.slack.teamId).trim()
          : null
        : prev.slack.teamId,
  };
  const taskAlerts: TaskAlertsPrefs = {
    enabled: patch.taskAlerts?.enabled ?? prev.taskAlerts.enabled,
  };
  const channels = asObj(base.channels) ? { ...(base.channels as Record<string, unknown>) } : {};
  const tools = (channels.tools as ToolsWanted | undefined) || prev.tools;
  // Keep tools.wanted in sync when email/slack toggles change from the detail form.
  if (patch.emailDigest && 'enabled' in patch.emailDigest) {
    tools.email = emailDigest.enabled;
  }
  if (patch.slack && 'enabled' in patch.slack) {
    tools.slack = slack.enabled;
  }
  const next = { ...base };
  delete next.emailDigest;
  delete next.slack;
  delete next.tools;
  return {
    ...next,
    channels: { ...channels, emailDigest, slack, taskAlerts, tools },
  };
}

export function channelsBoardPayload(profileJson: unknown): ChannelPrefs & {
  emailReady: boolean;
  slackReady: boolean;
  catalog: ReturnType<typeof toolsBoardPayload>['catalog'];
} {
  const prefs = readChannelPrefs(profileJson);
  const tools = toolsBoardPayload(profileJson);
  return {
    ...prefs,
    tools: tools.wanted,
    catalog: tools.catalog,
    emailReady: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
    slackReady: Boolean(process.env.SLACK_BOT_TOKEN?.trim() && process.env.SLACK_SIGNING_SECRET?.trim()),
  };
}

export { DEFAULTS as CHANNEL_DEFAULTS };
export type { ToolsWanted, ToolId };
