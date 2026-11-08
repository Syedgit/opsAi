/**
 * Shapes of an end-to-end test case. A case is a folder:
 *
 *   samples/cases/<name>/case.json       the conversation and what you expect
 *   samples/cases/<name>/recorded.json   (optional) what the AI said last time, used by replay mode
 *   plus the photos / text / voice files that case.json points to (paths are relative to the folder)
 */

export type Sender = 'owner' | 'staff' | 'stranger';

export interface EntryExpect {
  kind?: 'daily_close' | 'invoice' | 'deposit_receipt' | 'work_schedule' | 'order';
  /** Store name (case-insensitive contains). */
  store?: string;
  date?: string;

  // daily_close
  cash?: number | null;
  card?: number | null;
  insideTotal?: number | null;
  fuel?: number | null;
  gallons?: number | null;
  deposit?: number | null;
  dayTotal?: number | null;
  payouts?: Array<{ label: string; amount: number }>;

  // invoice
  vendor?: string;
  total?: number | null;
  invoiceNumber?: string | null;
  lineCount?: number;
  paymentStatus?: string;

  // work_schedule
  /** Hours per employee (name is case-insensitive), in sheet order. */
  employees?: Array<{ name: string; hours: number }>;
  totalHours?: number;

  // deposit_receipt
  bank?: string;
  accountLast4?: string | null;

  /** Check id -> status ("pass" | "warn" | "fail"). */
  checks?: Record<string, string>;
  /** These check ids must have raised a warning or failure. */
  warnings?: string[];
  /** true: no check raised a warning or failure. */
  clean?: boolean;
  /** Whether a deposit rule was proposed for the owner to approve. */
  suggestsDepositRule?: boolean;
}

export interface DashboardExpect {
  /** Counts by dashboard tab, e.g. { sales: 1, invoices: 0 }. */
  [tab: string]: number | { count: number; first?: Record<string, unknown> };
}

export interface StepExpect {
  replyContains?: string[];
  replyNotContains?: string[];
  noReply?: boolean;
  /** Exactly this many messages sent back. */
  replyCount?: number;
  /** Entries created by this message (checked in order, and the count must match). */
  entries?: EntryExpect[];
  /** How many entries are in each state after this step, across the whole conversation. */
  status?: { PENDING?: number; CONFIRMED?: number; CANCELLED?: number };
  /** Store name -> whether it has a saved deposit rule after this step. */
  savedRule?: Record<string, boolean>;
  /** Posts to the store's WhatsApp group made by this step (hours summaries). */
  groupPosts?: number;
  groupPostContains?: string[];
  groupPostNotContains?: string[];
  /** Tasks (by title, case-insensitive contains) that must exist in this state; code and proof type are optional. */
  tasks?: Array<{ title: string; status: 'OPEN' | 'DONE' | 'MISSED' | 'CANCELLED'; code?: number; evidenceType?: string; evidenceText?: string; outcome?: string; photoVerdict?: string }>;
  /** How many task runs are in each state after this step, across the whole case. */
  taskCounts?: { OPEN?: number; DONE?: number; MISSED?: number; CANCELLED?: number };
  /** What the owner would see on the dashboard after this step, by store name. */
  dashboard?: Record<string, DashboardExpect>;
  /** HTTP status the webhook answers with (default 200). */
  httpStatus?: number;
}

export interface Step {
  /** Plain-English label shown in the report. */
  name?: string;
  from?: Sender;
  /** Text typed by the sender (or the caption when sent with a photo). */
  text?: string;
  /** Read the text from a file instead. */
  textFile?: string;
  /** A photo. */
  image?: string;
  /** A voice note. */
  audio?: string;
  /** Move the clock to this moment before the step (ISO with offset), e.g. "2026-10-26T10:05:00-04:00". */
  at?: string;
  /** Before the step, the owner deletes the tasks whose title contains this (in the dashboard). */
  removeTasks?: string;
  /** Not a message: the scheduler wakes up (what the cron does every few minutes). */
  tick?: boolean;
  /** This step must not use the AI (chatter, over the daily cap). Fails if it does. */
  noAi?: boolean;
  /** Deliver the same message this many times (Meta retries). Only one reply set is expected. */
  repeat?: number;
  /** "bad": send a wrong signature; the webhook must refuse it. */
  signature?: 'bad';
  expect?: StepExpect;
}

export interface CaseFile {
  title: string;
  /** What this case proves, in one line. */
  why?: string;
  /** "Now" for the case, so date checks do not drift as the calendar moves. */
  today?: string;
  /** Settings for this case only, e.g. a low AI cap to test the limit. */
  env?: Record<string, string>;
  /** Stores (by name) that have a WhatsApp group linked, so confirmed schedules are posted to it. */
  linkedGroups?: string[];
  /** Tasks already set up for a store (the same fields as the dashboard form), by store name. */
  taskTemplates?: Array<Record<string, unknown> & { store: string }>;
  /** Deposit rules already taught for a store, by store name. */
  savedRules?: Record<string, { includeCardSales: boolean; includeFuelSales: boolean; subtractPayouts: boolean; floatLeftInRegister?: number }>;
  /** Vendors this store orders from (set at signup), by store name. */
  vendors?: Record<string, Array<{ name: string; category: string }>>;
  /** Store type at signup (convenience, gas_station, seven_eleven, other), by store name. */
  storeTypes?: Record<string, 'seven_eleven' | 'convenience' | 'gas_station' | 'office' | 'shipping' | 'real_estate' | 'appointments' | 'personal' | 'other'>;
  steps: Step[];
}

export interface Recording {
  reading?: unknown;
  transcript?: string;
}
export type Recordings = Record<string, Recording>;

export interface EntryView {
  kind: string;
  store: string;
  date: string | null;
  cash?: number | null;
  card?: number | null;
  insideTotal?: number | null;
  fuel?: number | null;
  gallons?: number | null;
  deposit?: number | null;
  dayTotal?: number | null;
  payouts?: Array<{ label: string; amount: number }>;
  vendor?: string | null;
  total?: number | null;
  invoiceNumber?: string | null;
  lineCount?: number;
  paymentStatus?: string | null;
  bank?: string | null;
  accountLast4?: string | null;
  employees?: Array<{ name: string; hours: number }>;
  totalHours?: number | null;
  checks: Record<string, string>;
  suggestsDepositRule: boolean;
}

export interface StepActual {
  httpStatus: number;
  replies: string[];
  /** Messages posted to a WhatsApp group (not a private reply). */
  groupPosts: string[];
  entries: EntryView[];
  status: { PENDING: number; CONFIRMED: number; CANCELLED: number };
  savedRule: Record<string, boolean>;
  tasks: Array<{ title: string; status: string; code: number; evidenceType: string | null; evidenceText: string | null; outcome: string | null; photoVerdict?: string | null }>;
  taskCounts: { OPEN: number; DONE: number; MISSED: number; CANCELLED: number };
  dashboard: Record<string, Record<string, { count: number; first?: Record<string, unknown> }>>;
}
