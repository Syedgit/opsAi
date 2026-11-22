/**
 * Business tools shown in Agents → Tools.
 * Each tool has an inline connect action in the Tasks admin UI
 * (OAuth, sheet link, Slack channel, email digest, Books enroll, etc.).
 */

export type ToolId = 'whatsapp' | 'googleSheets' | 'gmail' | 'slack' | 'email' | 'books';

export type ToolDef = {
  id: ToolId;
  name: string;
  blurb: string;
  /** Field capture vs owner/manager channel. */
  audience: 'field' | 'owner' | 'addon';
  /** On by default for new stores. */
  defaultWanted: boolean;
  /** Icon path under /public */
  icon: string;
  accent: string;
};

export const BUSINESS_TOOLS: ToolDef[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    blurb: 'Field closes, invoices, and OK/FIX from the floor.',
    audience: 'field',
    defaultWanted: true,
    icon: '/integrations/whatsapp.svg',
    accent: '#25D366',
  },
  {
    id: 'googleSheets',
    name: 'Google Sheets',
    blurb: 'Mirror confirmed entries into a spreadsheet you already use.',
    audience: 'owner',
    defaultWanted: false,
    icon: '/integrations/google-sheets.svg',
    accent: '#0F9D58',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    blurb: 'Connect this business’s inbox. Read-only alerts to WhatsApp.',
    audience: 'owner',
    defaultWanted: false,
    icon: '/integrations/gmail.svg',
    accent: '#EA4335',
  },
  {
    id: 'slack',
    name: 'Slack',
    blurb: 'Manager ask + morning brief in a channel or DM.',
    audience: 'owner',
    defaultWanted: false,
    icon: '/integrations/slack.svg',
    accent: '#4A154B',
  },
  {
    id: 'email',
    name: 'Email digest',
    blurb: 'Morning standing, missing closes, and open invoices.',
    audience: 'owner',
    defaultWanted: false,
    icon: '/integrations/email.svg',
    accent: '#2563EB',
  },
  {
    id: 'books',
    name: 'Books',
    blurb: 'Ask standing and invoices in Crew ($20/store add-on).',
    audience: 'addon',
    defaultWanted: false,
    icon: '/integrations/books.svg',
    accent: '#0F766E',
  },
];

export type ToolsWanted = Record<ToolId, boolean>;

export function defaultToolsWanted(): ToolsWanted {
  return Object.fromEntries(BUSINESS_TOOLS.map((t) => [t.id, t.defaultWanted])) as ToolsWanted;
}

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readToolsWanted(profileJson: unknown): ToolsWanted {
  const base = defaultToolsWanted();
  const profile = asObj(profileJson) || {};
  const channels = asObj(profile.channels) || {};
  const tools = asObj(channels.tools) || asObj(profile.tools) || {};
  for (const tool of BUSINESS_TOOLS) {
    if (typeof tools[tool.id] === 'boolean') base[tool.id] = tools[tool.id] as boolean;
  }
  // Mirror live channel prefs when tools.wanted was never set.
  const email = asObj(channels.emailDigest);
  const slack = asObj(channels.slack);
  if (tools.email === undefined && email?.enabled === true) base.email = true;
  if (tools.slack === undefined && slack?.enabled === true) base.slack = true;
  return base;
}

export function withToolsWanted(
  profileJson: unknown,
  wanted: Partial<ToolsWanted>
): Record<string, unknown> {
  const base = asObj(profileJson) ? { ...(profileJson as Record<string, unknown>) } : {};
  const channels = asObj(base.channels) ? { ...(base.channels as Record<string, unknown>) } : {};
  const prev = readToolsWanted(base);
  const nextTools: ToolsWanted = { ...prev, ...wanted };
  // Keep email/slack enabled flags in sync when toggling from the tools picker.
  const emailDigest = asObj(channels.emailDigest) || { enabled: false, to: null };
  const slack = asObj(channels.slack) || { enabled: false, channelId: null, teamId: null };
  return {
    ...base,
    channels: {
      ...channels,
      tools: nextTools,
      emailDigest: { ...emailDigest, enabled: nextTools.email === true },
      slack: { ...slack, enabled: nextTools.slack === true },
    },
  };
}

export function toolsBoardPayload(profileJson: unknown): {
  catalog: ToolDef[];
  wanted: ToolsWanted;
} {
  return {
    catalog: BUSINESS_TOOLS,
    wanted: readToolsWanted(profileJson),
  };
}
