/**
 * Named agent crew — product faces + allowlists over the existing capability core.
 * Supervisor routes; subagents never invent totals or post without confirm.
 */

import { ClassificationType } from '@prisma/client';
import {
  AI_CHAT_USD_PER_STORE_PER_MONTH,
  readAiChatState,
  withAiChatEnrollment,
} from '../aiChatAccess';
import { USD_PER_STORE_PER_MONTH } from '../billing/plans';

export const AGENT_IDS = ['supervisor', 'close', 'finance', 'staff', 'books', 'followup'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Subagents a store can enable (Supervisor is always the router). */
export const STORE_AGENT_IDS = ['close', 'finance', 'staff', 'books', 'followup'] as const;
export type StoreAgentId = (typeof STORE_AGENT_IDS)[number];

export type VerticalPack = 'c_store_gas';
export type AgentAutonomy = 'draft_only' | 'auto_remind';

export type StoreAgentsConfig = {
  pack: VerticalPack;
  enabled: Record<StoreAgentId, boolean>;
  autonomy: AgentAutonomy;
};

export type AgentCatalogEntry = {
  id: StoreAgentId;
  /** Person-style display name shown in product UI. */
  name: string;
  /** Specialty label (Close, Finance, …). */
  role: string;
  job: string;
  /** Included in base $25/store vs paid add-on. */
  pricing: 'included' | 'addon';
  monthlyUsd: number;
  /** Core agents cannot be turned off. */
  core: boolean;
  defaultOn: boolean;
};

export const C_STORE_GAS_CATALOG: AgentCatalogEntry[] = [
  {
    id: 'close',
    name: 'Mira',
    role: 'Close',
    job: 'Daily sales, DMR, and deposits — draft then OK/FIX on WhatsApp',
    pricing: 'included',
    monthlyUsd: 0,
    core: true,
    defaultOn: true,
  },
  {
    id: 'finance',
    name: 'Jules',
    role: 'Finance',
    job: 'Invoices, remaining balances, and vendor bills',
    pricing: 'included',
    monthlyUsd: 0,
    core: true,
    defaultOn: true,
  },
  {
    id: 'followup',
    name: 'Avery',
    role: 'Follow-up',
    job: 'Reminders for missing closes and overdue bills',
    pricing: 'included',
    monthlyUsd: 0,
    core: true,
    defaultOn: true,
  },
  {
    id: 'staff',
    name: 'Sam',
    role: 'Staff',
    job: 'Shift tasks, photo proof, and escalations',
    pricing: 'included',
    monthlyUsd: 0,
    core: false,
    defaultOn: true,
  },
  {
    id: 'books',
    name: 'Quinn',
    role: 'Books',
    job: 'Ask on confirmed store data — web and WhatsApp 1:1',
    pricing: 'addon',
    monthlyUsd: AI_CHAT_USD_PER_STORE_PER_MONTH,
    core: false,
    defaultOn: false,
  },
];

/** Main chat router — always present, not a toggleable store agent. */
export const SUPERVISOR_AGENT = {
  id: 'supervisor' as const,
  name: 'Riley',
  role: 'Ops lead',
  job: 'Routes your question to the right agent and tool',
};

export const AGENT_DISPLAY: Record<AgentId, string> = {
  supervisor: SUPERVISOR_AGENT.name,
  close: 'Mira',
  finance: 'Jules',
  staff: 'Sam',
  books: 'Quinn',
  followup: 'Avery',
};

export const AGENT_ROLE: Record<AgentId, string> = {
  supervisor: SUPERVISOR_AGENT.role,
  close: 'Close',
  finance: 'Finance',
  staff: 'Staff',
  books: 'Books',
  followup: 'Follow-up',
};

const CORE_ALWAYS_ON: StoreAgentId[] = ['close', 'finance', 'followup'];

function asProfile(profileJson: unknown): Record<string, unknown> {
  if (profileJson && typeof profileJson === 'object' && !Array.isArray(profileJson)) {
    return { ...(profileJson as Record<string, unknown>) };
  }
  return {};
}

function readAgentsBlob(profile: Record<string, unknown>): Record<string, unknown> {
  const raw = profile.agents;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Resolved crew for a store. Books mirrors `aiChat.enrolled` (source of truth for the add-on).
 * Close / Finance / Follow-up stay on. Staff defaults on unless explicitly disabled.
 */
export function readStoreAgentsConfig(profileJson: unknown): StoreAgentsConfig {
  const profile = asProfile(profileJson);
  const blob = readAgentsBlob(profile);
  const enabledRaw =
    blob.enabled && typeof blob.enabled === 'object' && !Array.isArray(blob.enabled)
      ? (blob.enabled as Record<string, unknown>)
      : {};
  const books = readAiChatState(profile).enrolled;
  const staff = enabledRaw.staff !== false;
  const pack: VerticalPack = blob.pack === 'c_store_gas' ? 'c_store_gas' : 'c_store_gas';
  const autonomy: AgentAutonomy = blob.autonomy === 'auto_remind' ? 'auto_remind' : 'draft_only';

  return {
    pack,
    enabled: {
      close: true,
      finance: true,
      followup: true,
      staff,
      books,
    },
    autonomy,
  };
}

export function isAgentEnabled(profileJson: unknown, agentId: StoreAgentId): boolean {
  return readStoreAgentsConfig(profileJson).enabled[agentId] === true;
}

export function withStoreAgentsUpdate(
  profileJson: unknown,
  patch: {
    staff?: boolean;
    books?: boolean;
    autonomy?: AgentAutonomy;
  },
  now = new Date()
): Record<string, unknown> {
  let base = asProfile(profileJson);
  if (typeof patch.books === 'boolean') {
    base = withAiChatEnrollment(base, patch.books, now);
  }
  const prev = readStoreAgentsConfig(base);
  const staff = typeof patch.staff === 'boolean' ? patch.staff : prev.enabled.staff;
  const autonomy = patch.autonomy ?? prev.autonomy;
  const books = readAiChatState(base).enrolled;

  return {
    ...base,
    agents: {
      pack: prev.pack,
      autonomy,
      enabled: {
        close: true,
        finance: true,
        followup: true,
        staff,
        books,
      },
    },
  };
}

/** Keep `agents.enabled.books` aligned when enrollment changes via set_ai_chat. */
export function syncAgentsBooksFromAiChat(profileJson: unknown): Record<string, unknown> {
  const base = asProfile(profileJson);
  const prev = readStoreAgentsConfig(base);
  return {
    ...base,
    agents: {
      pack: prev.pack,
      autonomy: prev.autonomy,
      enabled: {
        close: true,
        finance: true,
        followup: true,
        staff: prev.enabled.staff,
        books: readAiChatState(base).enrolled,
      },
    },
  };
}

export function agentForClassification(type: ClassificationType): StoreAgentId {
  switch (type) {
    case ClassificationType.INVOICE_EXPENSE:
      return 'finance';
    case ClassificationType.ORDER_REQUEST:
      return 'finance';
    case ClassificationType.STORE_SALES:
    case ClassificationType.FUEL_SALES:
    case ClassificationType.PAID_OUT:
      return 'close';
    default:
      return 'close';
  }
}

export type WaAgentPath =
  | 'command'
  | 'audio_ignored'
  | 'not_linked'
  | 'rate_limited'
  | 'empty'
  | 'task_evidence'
  | 'ai_chat'
  | 'chatter'
  | 'no_data'
  | 'rules'
  | 'ai'
  | 'ai_limit'
  | 'fallback_rules'
  | 'photo_unread'
  | 'ai_off';

/** Tag WhatsApp paths with the crew agent that owns the work (supervisor = routing only). */
export function agentForWhatsAppPath(
  path: WaAgentPath,
  type?: ClassificationType | null
): AgentId {
  switch (path) {
    case 'ai_chat':
      return 'books';
    case 'task_evidence':
      return 'staff';
    case 'rules':
    case 'ai':
    case 'fallback_rules':
    case 'photo_unread':
    case 'ai_off':
      return type ? agentForClassification(type) : 'close';
    case 'command':
    case 'chatter':
    case 'no_data':
    case 'empty':
    case 'audio_ignored':
    case 'not_linked':
    case 'rate_limited':
    case 'ai_limit':
      return 'supervisor';
    default:
      return 'supervisor';
  }
}

export function agentsBoardPayload(profileJson: unknown) {
  const config = readStoreAgentsConfig(profileJson);
  return {
    pack: config.pack,
    packLabel: 'C-store / gas',
    autonomy: config.autonomy,
    enabled: config.enabled,
    baseMonthlyUsd: USD_PER_STORE_PER_MONTH,
    supervisor: { ...SUPERVISOR_AGENT, enabled: true },
    catalog: C_STORE_GAS_CATALOG.map((entry) => ({
      ...entry,
      enabled: config.enabled[entry.id],
      canToggle: !entry.core && (entry.id !== 'books' || true),
    })),
    marketingLine: 'Your store agents — you confirm every money post.',
  };
}

export function isCoreAgent(id: StoreAgentId): boolean {
  return CORE_ALWAYS_ON.includes(id);
}
