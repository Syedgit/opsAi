/**
 * Scenario/tool catalog for vertical packs.
 * Supervisor sees descriptions + examples; code owns loaders.
 */

import type { StoreAgentId } from '../crew';
import { PACK_BOOKS_TOOL_IDS, type VerticalPack } from '../packs';

export const CREW_TOOL_IDS = [
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'staff_schedule',
  'ops_today',
  'help_capabilities',
  'list_connectors',
  'list_gmail_rules',
  'create_gmail_rule',
  'clarify',
  'unsupported',
  'not_ai_chat',
] as const;

export type CrewToolId = (typeof CREW_TOOL_IDS)[number];

export type ToolPeriod = 'week' | 'month' | 'custom';
export type InvoiceStatusFilter = 'all' | 'open' | 'paid';
export type GmailRuleRouteSlot = 'dm' | 'group' | 'both';

export type ToolSlots = {
  period?: ToolPeriod | null;
  /** ISO days when period is custom (single-day sales = from === to). */
  from?: string | null;
  to?: string | null;
  vendor?: string | null;
  status?: InvoiceStatusFilter | null;
  /** Gmail automation create slots (not date range). */
  ruleLabel?: string | null;
  ruleFrom?: string | null;
  ruleContains?: string | null;
  route?: GmailRuleRouteSlot | null;
};

export type CrewToolDef = {
  id: CrewToolId;
  agentId: StoreAgentId;
  description: string;
  examples: string[];
  /** If true, supervisor may pick this without enrollment (routing only). */
  alwaysAvailable?: boolean;
};

const BOOKS_TOOL_DEFS: Record<
  Exclude<
    CrewToolId,
    'clarify' | 'unsupported' | 'not_ai_chat' | 'list_connectors' | 'list_gmail_rules' | 'create_gmail_rule'
  >,
  CrewToolDef
> = {
  standing_report: {
    id: 'standing_report',
    agentId: 'books',
    description:
      'Standing / DMR / sales for a week, month, or a specific day (yesterday, today, or a date). Sales, cash, card, gas, buying, expenses, standing, closes.',
    examples: [
      'How is standing this month?',
      'What was sale yesterday?',
      'Sales for 11/21',
      'How are sales this week?',
    ],
  },
  open_invoices: {
    id: 'open_invoices',
    agentId: 'books',
    description: 'Vendor bills still owed (open / unpaid remaining). Optional vendor name filter.',
    examples: ['What invoices are still open?', 'What do we still owe Pepsi?', 'Pending vendor bills'],
  },
  invoice_period_summary: {
    id: 'invoice_period_summary',
    agentId: 'books',
    description:
      'How many invoices in the period, totals, paid vs open counts and dollars, and which vendor was paid most recently. Use for “how many invoices”, “paid invoices”, “who was paid last”.',
    examples: [
      'How many invoices this month?',
      'Total paid invoices',
      'Who was the vendor paid last time?',
    ],
  },
  missing_closes: {
    id: 'missing_closes',
    agentId: 'books',
    description: 'How many days in the period are missing a confirmed close.',
    examples: ['How many missing closes?', 'Which days missing a close this month?'],
  },
  staff_schedule: {
    id: 'staff_schedule',
    agentId: 'books',
    description:
      'Who worked / is working from the confirmed shift schedule (hours only, never pay). Use for yesterday, today, or this week’s roster.',
    examples: [
      'Who worked yesterday?',
      'Who is working today?',
      'Who was on at the shop yesterday?',
      'Show this week’s schedule hours',
    ],
  },
  ops_today: {
    id: 'ops_today',
    agentId: 'books',
    description:
      'What needs attention now: open tasks due/overdue, bills due soon, who is on today, missing yesterday close. Default for “anything to follow?”, greetings, or vague business follow-ups.',
    examples: [
      'Anything to follow today?',
      'What needs attention?',
      'What’s due today?',
      'What should I check?',
      'Hi',
    ],
  },
  help_capabilities: {
    id: 'help_capabilities',
    agentId: 'books',
    description: 'List what Books can answer from confirmed data for this business.',
    examples: ['What can you help with?', 'Help', 'What can you do'],
    alwaysAvailable: true,
  },
};

export function booksToolsForPack(pack: VerticalPack): CrewToolDef[] {
  const ids = PACK_BOOKS_TOOL_IDS[pack] ?? PACK_BOOKS_TOOL_IDS.c_store_gas;
  const out: CrewToolDef[] = [];
  for (const id of ids) {
    const def = BOOKS_TOOL_DEFS[id as keyof typeof BOOKS_TOOL_DEFS];
    if (def) out.push(def);
  }
  return out;
}

/** @deprecated Prefer booksToolsForPack('c_store_gas'). */
export const C_STORE_GAS_BOOKS_TOOLS: CrewToolDef[] = booksToolsForPack('c_store_gas');

export const META_TOOLS: CrewToolDef[] = [
  {
    id: 'list_connectors',
    agentId: 'books',
    description:
      'Show which connectors are set up for this business (Gmail, WhatsApp group, task alerts) and what is still missing. Use for “what’s connected?”, “set up Gmail”, connector status.',
    examples: [
      'What connectors do we have?',
      'Is Gmail connected?',
      'What’s set up for alerts?',
      'Show connected apps',
    ],
    alwaysAvailable: true,
  },
  {
    id: 'list_gmail_rules',
    agentId: 'books',
    description: 'List Gmail alert rules (From / contains / where they deliver: DM, group, or both).',
    examples: ['Show Gmail rules', 'What email alerts do I have?', 'List my Gmail automations'],
    alwaysAvailable: true,
  },
  {
    id: 'create_gmail_rule',
    agentId: 'books',
    description:
      'Add a Gmail alert rule. Slots: ruleFrom and/or ruleContains, optional ruleLabel, route dm|group|both. Requires Gmail connected; OAuth connect stays in Business admin → Tools.',
    examples: [
      'Alert me when mail from ustocktrader contains Test-sza',
      'When pricing email comes from @vendor.com post it in the group',
      'Add a Gmail rule from billing@x.com to DM me',
    ],
    alwaysAvailable: true,
  },
  {
    id: 'clarify',
    agentId: 'books',
    description: 'Question too vague; ask one short clarifying question.',
    examples: [],
    alwaysAvailable: true,
  },
  {
    id: 'unsupported',
    agentId: 'books',
    description: 'Forecast, payroll, profit, utilities due — not available from confirmed books yet.',
    examples: [],
    alwaysAvailable: true,
  },
  {
    id: 'not_ai_chat',
    agentId: 'books',
    description: 'Staff ops capture (close, invoice photo, OK/FIX) — not a books question.',
    examples: [],
    alwaysAvailable: true,
  },
];

export function toolsForSupervisor(opts: {
  booksEnrolled: boolean;
  pack?: VerticalPack | null;
  /** When set, only tools for this agent (direct chat shortcut). */
  agentFilter?: StoreAgentId | 'supervisor' | null;
}): CrewToolDef[] {
  const pack = opts.pack ?? 'c_store_gas';
  const packTools = booksToolsForPack(pack);
  const books = opts.booksEnrolled ? packTools : packTools.filter((t) => t.alwaysAvailable);
  const all = [...books, ...META_TOOLS];
  if (!opts.agentFilter || opts.agentFilter === 'supervisor') return all;
  return all.filter((t) => t.agentId === opts.agentFilter || t.alwaysAvailable);
}

export function toolById(id: string, pack: VerticalPack = 'c_store_gas'): CrewToolDef | undefined {
  return [...booksToolsForPack(pack), ...META_TOOLS].find((t) => t.id === id);
}

export function isCrewToolId(id: string): id is CrewToolId {
  return (CREW_TOOL_IDS as readonly string[]).includes(id);
}
