/**
 * Scenario/tool catalog for vertical packs.
 * Supervisor sees descriptions + examples; code owns loaders.
 */

import type { StoreAgentId } from '../crew';

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

/** Books tools for c_store_gas (enrolled Books add-on). */
export const C_STORE_GAS_BOOKS_TOOLS: CrewToolDef[] = [
  {
    id: 'standing_report',
    agentId: 'books',
    description:
      'Period standing / DMR: sales, cash, card, gas, buying, expenses, standing, close count, missing closes.',
    examples: [
      'How is standing this month?',
      'How is the DMR looking?',
      'How are sales this week?',
    ],
  },
  {
    id: 'open_invoices',
    agentId: 'books',
    description: 'Vendor bills still owed (open / unpaid remaining). Optional vendor name filter.',
    examples: [
      'What invoices are still open?',
      'What do we still owe Pepsi?',
      'Pending vendor bills',
    ],
  },
  {
    id: 'invoice_period_summary',
    agentId: 'books',
    description:
      'How many invoices in the period, totals, paid vs open counts and dollars. Use for “how many invoices”, “total invoices”, “paid invoices”.',
    examples: [
      'How many invoices this month?',
      'Total paid invoices',
      'Invoice count so far this month',
    ],
  },
  {
    id: 'missing_closes',
    agentId: 'books',
    description: 'How many days in the period are missing a confirmed close.',
    examples: ['How many missing closes?', 'Which days missing a close this month?'],
  },
  {
    id: 'help_capabilities',
    agentId: 'books',
    description: 'List what Books can answer from confirmed data.',
    examples: ['What can you help with?', 'Help'],
    alwaysAvailable: true,
  },
];

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
  /** When set, only tools for this agent (direct chat shortcut). */
  agentFilter?: StoreAgentId | 'supervisor' | null;
}): CrewToolDef[] {
  const books = opts.booksEnrolled ? C_STORE_GAS_BOOKS_TOOLS : C_STORE_GAS_BOOKS_TOOLS.filter((t) => t.alwaysAvailable);
  const all = [...books, ...META_TOOLS];
  if (!opts.agentFilter || opts.agentFilter === 'supervisor') return all;
  return all.filter((t) => t.agentId === opts.agentFilter || t.alwaysAvailable);
}

export function toolById(id: string): CrewToolDef | undefined {
  return [...C_STORE_GAS_BOOKS_TOOLS, ...META_TOOLS].find((t) => t.id === id);
}

export function isCrewToolId(id: string): id is CrewToolId {
  return (CREW_TOOL_IDS as readonly string[]).includes(id);
}
