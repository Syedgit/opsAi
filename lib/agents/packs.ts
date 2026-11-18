/**
 * Vertical packs: agent job copy + Books tool allowlists from store business category.
 * Pack is derived from setup storeType — not invented mid-chat.
 */

import { AI_CHAT_USD_PER_STORE_PER_MONTH } from '../aiChatAccess';
import type { StoreType } from '../tasks/storeSetup';

export const VERTICAL_PACKS = [
  'c_store_gas',
  'appointments',
  'desk',
  'real_estate',
  'personal',
  'generic',
] as const;

export type VerticalPack = (typeof VERTICAL_PACKS)[number];

/** Mirrors AgentCatalogEntry in crew.ts without importing crew (avoid cycles). */
export type PackCatalogEntry = {
  id: 'close' | 'finance' | 'staff' | 'books' | 'followup';
  name: string;
  role: string;
  job: string;
  pricing: 'included' | 'addon';
  monthlyUsd: number;
  core: boolean;
  defaultOn: boolean;
};

export const PACK_LABEL: Record<VerticalPack, string> = {
  c_store_gas: 'C-store / gas',
  appointments: 'Appointments / clinic',
  desk: 'Office / shipping',
  real_estate: 'Real estate',
  personal: 'Personal / solo',
  generic: 'General business',
};

/** Map every setup store type to one pack. */
export function packForStoreType(storeType: StoreType | null | undefined): VerticalPack {
  switch (storeType) {
    case 'appointments':
      return 'appointments';
    case 'office':
    case 'shipping':
      return 'desk';
    case 'real_estate':
      return 'real_estate';
    case 'personal':
      return 'personal';
    case 'other':
      return 'generic';
    case 'seven_eleven':
    case 'convenience':
    case 'gas_station':
    case null:
    case undefined:
      return 'c_store_gas';
    default:
      return 'generic';
  }
}

export function isVerticalPack(value: unknown): value is VerticalPack {
  return typeof value === 'string' && (VERTICAL_PACKS as readonly string[]).includes(value);
}

function baseCatalog(jobs: Record<'close' | 'finance' | 'followup' | 'staff' | 'books', string>): PackCatalogEntry[] {
  return [
    {
      id: 'close',
      name: 'Mira',
      role: 'Close',
      job: jobs.close,
      pricing: 'included',
      monthlyUsd: 0,
      core: true,
      defaultOn: true,
    },
    {
      id: 'finance',
      name: 'Jules',
      role: 'Finance',
      job: jobs.finance,
      pricing: 'included',
      monthlyUsd: 0,
      core: true,
      defaultOn: true,
    },
    {
      id: 'followup',
      name: 'Avery',
      role: 'Follow-up',
      job: jobs.followup,
      pricing: 'included',
      monthlyUsd: 0,
      core: true,
      defaultOn: true,
    },
    {
      id: 'staff',
      name: 'Sam',
      role: 'Staff',
      job: jobs.staff,
      pricing: 'included',
      monthlyUsd: 0,
      core: false,
      defaultOn: true,
    },
    {
      id: 'books',
      name: 'Quinn',
      role: 'Books',
      job: jobs.books,
      pricing: 'addon',
      monthlyUsd: AI_CHAT_USD_PER_STORE_PER_MONTH,
      core: false,
      defaultOn: false,
    },
  ];
}

const C_STORE_JOBS = {
  close: 'Daily sales, DMR, and deposits — draft then OK/FIX on WhatsApp',
  finance: 'Invoices, remaining balances, and vendor bills',
  followup: 'Reminders for missing closes and overdue bills',
  staff: 'Shift tasks, photo proof, and escalations',
  books: 'Ask on confirmed store data — web and WhatsApp 1:1',
};

const APPOINTMENTS_JOBS = {
  close: 'Day sheet / till close — draft then OK/FIX on WhatsApp',
  finance: 'Supplier bills and remaining balances when you send invoices',
  followup: 'Reminders for missing day closes and open bills',
  staff: 'Rooms ready, confirmations, and shift proofs',
  books: 'Ask on confirmed closes and bills for this book',
};

const DESK_JOBS = {
  close: 'End-of-day wrap and lock-up notes from the team',
  finance: 'Bills and expenses when you capture them on WhatsApp',
  followup: 'Nudges for open tasks and anything still owed',
  staff: 'Who is in, meetings, and desk checklists',
  books: 'Ask on confirmed ops data for this office',
};

const REAL_ESTATE_JOBS = {
  close: 'Day wrap and lock-up for the agency',
  finance: 'Vendor / repair bills when you send them in',
  followup: 'Reminders for open showings tasks and bills',
  staff: 'Showings, keys, and listing follow-ups',
  books: 'Ask on confirmed agency data you have posted',
};

const PERSONAL_JOBS = {
  close: 'Daily plan and wrap-up in WhatsApp',
  finance: 'Personal bills and expenses you capture',
  followup: 'Light nudges for open reminders',
  staff: 'Your solo checklist and proofs',
  books: 'Ask on what you have confirmed in chat',
};

const GENERIC_JOBS = {
  close: 'Daily close / wrap for this business',
  finance: 'Invoices and expenses you send in',
  followup: 'Reminders for missing closes and open bills',
  staff: 'Shift or site tasks and photo proof',
  books: 'Ask on confirmed data for this business',
};

export const PACK_CATALOGS: Record<VerticalPack, PackCatalogEntry[]> = {
  c_store_gas: baseCatalog(C_STORE_JOBS),
  appointments: baseCatalog(APPOINTMENTS_JOBS),
  desk: baseCatalog(DESK_JOBS),
  real_estate: baseCatalog(REAL_ESTATE_JOBS),
  personal: baseCatalog(PERSONAL_JOBS),
  generic: baseCatalog(GENERIC_JOBS),
};

const SHOP_BOOKS = [
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'help_capabilities',
] as const;

const TILL_BOOKS = [
  'standing_report',
  'open_invoices',
  'invoice_period_summary',
  'missing_closes',
  'help_capabilities',
] as const;

const LIGHT_BOOKS = ['help_capabilities'] as const;

/** Books tool ids offered for each pack (defs live in tools/catalog.ts). */
export const PACK_BOOKS_TOOL_IDS: Record<VerticalPack, readonly string[]> = {
  c_store_gas: SHOP_BOOKS,
  appointments: TILL_BOOKS,
  generic: TILL_BOOKS,
  desk: LIGHT_BOOKS,
  real_estate: LIGHT_BOOKS,
  personal: LIGHT_BOOKS,
};

export function catalogForPack(pack: VerticalPack): PackCatalogEntry[] {
  return PACK_CATALOGS[pack] ?? PACK_CATALOGS.c_store_gas;
}
