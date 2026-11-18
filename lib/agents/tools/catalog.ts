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
  'help_capabilities',
  'clarify',
  'unsupported',
  'not_ai_chat',
] as const;

export type CrewToolId = (typeof CREW_TOOL_IDS)[number];

export type ToolPeriod = 'week' | 'month';
export type InvoiceStatusFilter = 'all' | 'open' | 'paid';

export type ToolSlots = {
  period?: ToolPeriod | null;
  vendor?: string | null;
  status?: InvoiceStatusFilter | null;
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
  Exclude<CrewToolId, 'clarify' | 'unsupported' | 'not_ai_chat'>,
  CrewToolDef
> = {
  standing_report: {
    id: 'standing_report',
    agentId: 'books',
    description:
      'Period standing / DMR: sales, cash, card, gas, buying, expenses, standing, close count, missing closes.',
    examples: ['How is standing this month?', 'How is the DMR looking?', 'How are sales this week?'],
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
  help_capabilities: {
    id: 'help_capabilities',
    agentId: 'books',
    description: 'List what Books can answer from confirmed data for this business.',
    examples: ['What can you help with?', 'Help'],
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
