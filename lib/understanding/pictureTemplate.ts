/**
 * Owner-taught document maps: what to take (and ignore) on a business's paperwork.
 * Each location’s close / invoice / schedule can look different. Onboarding can save one
 * starter map; Business admin can add more anytime. The photo is not kept — labels drive later reads.
 *
 * Scale model: packs offer default presets; each business’s saved maps are the source of truth.
 */
import { z } from 'zod';
import type { VerticalPack } from '../agents/packs';

export const PICTURE_TEMPLATE_KINDS = ['daily_close', 'invoice', 'deposit_receipt', 'order', 'work_schedule'] as const;
export type PictureTemplateKind = (typeof PICTURE_TEMPLATE_KINDS)[number];

export const PICTURE_FIELD_PURPOSES = [
  'fuel',
  'gallons',
  'store_credit',
  'cash',
  'inside_total',
  'payout',
  'day_total',
  'deposit',
  'vendor',
  'invoice_total',
  'due_date',
  'paid',
  'hours',
  'ignore',
] as const;
export type PictureFieldPurpose = (typeof PICTURE_FIELD_PURPOSES)[number];

export const MAX_PICTURE_TEMPLATES = 10;
export const MAX_PICTURE_FIELDS = 12;

export const PictureFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  purpose: z.enum(PICTURE_FIELD_PURPOSES),
  note: z.string().trim().max(120).optional(),
});

export const PictureTemplateSchema = z.object({
  id: z.string().trim().min(1).max(40),
  kind: z.enum(PICTURE_TEMPLATE_KINDS),
  title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(400).optional(),
  fields: z.array(PictureFieldSchema).min(1).max(MAX_PICTURE_FIELDS),
});

export type PictureTemplate = z.infer<typeof PictureTemplateSchema>;
export type PictureField = z.infer<typeof PictureFieldSchema>;

export const PICTURE_KIND_LABEL: Record<PictureTemplateKind, string> = {
  daily_close: 'Close / day sales',
  invoice: 'Invoice',
  work_schedule: 'Shift schedule',
  deposit_receipt: 'Bank deposit',
  order: 'Order list',
};

export const PICTURE_PURPOSE_LABEL: Record<PictureFieldPurpose, string> = {
  fuel: 'Fuel / gas',
  gallons: 'Fuel gallons (volume)',
  store_credit: 'Inside card (store credit)',
  cash: 'Inside cash (till / acceptor)',
  inside_total: 'Inside total (shop, not gas)',
  payout: 'Comes off cash (named paid-out)',
  day_total: 'Net cash / day total',
  deposit: 'Bank deposit',
  vendor: 'Vendor name',
  invoice_total: 'Invoice total',
  due_date: 'Due date',
  paid: 'Already paid / remaining',
  hours: 'Shift hours (Time In / Out)',
  ignore: 'Ignore this line',
};

const PURPOSE_PROMPT: Record<PictureFieldPurpose, string> = {
  fuel: 'fuelSales',
  gallons: 'fuelGallons (volume, not dollars)',
  store_credit: 'cardSales / store credit (inside shop)',
  cash: 'cashSales (till cash / Cash Acceptor Cash)',
  inside_total: 'storeSalesTotal (inside shop, not gas)',
  payout: 'a payout that comes off cash — never wages or pay rates',
  day_total: 'reportedDayTotal (Net cash)',
  deposit: 'reportedDeposit',
  vendor: 'vendorName',
  invoice_total: 'invoice total',
  due_date: 'dueDate / payBy',
  paid: 'payments / remainingDue',
  hours: 'work_schedule hours (Time In / Time Out). Never pay.',
  ignore: 'ignore (not a number we store)',
};

const PURPOSE_KINDS: Record<PictureFieldPurpose, PictureTemplateKind[]> = {
  fuel: ['daily_close'],
  gallons: ['daily_close'],
  store_credit: ['daily_close'],
  cash: ['daily_close'],
  inside_total: ['daily_close'],
  payout: ['daily_close'],
  day_total: ['daily_close'],
  deposit: ['daily_close', 'deposit_receipt'],
  vendor: ['invoice', 'order'],
  invoice_total: ['invoice'],
  due_date: ['invoice'],
  paid: ['invoice'],
  hours: ['work_schedule'],
  ignore: [...PICTURE_TEMPLATE_KINDS],
};

export interface PictureTemplatePreset {
  id: string;
  title: string;
  kind: PictureTemplateKind;
  note: string;
  fields: PictureField[];
  /** Which vertical packs offer this starter. Empty = all packs. */
  packs?: VerticalPack[];
}

/** Known layouts the owner can start from, then tweak. C-store fuel/tender live only on c_store_gas. */
export const PICTURE_TEMPLATE_PRESETS: PictureTemplatePreset[] = [
  {
    id: 'exxon_store_close',
    title: 'Exxon Store Close (fuel page)',
    kind: 'daily_close',
    packs: ['c_store_gas'],
    note: 'Fuel is Total Fuel Sales. Non-fuel, if any, is store credit. Ignore the register reading.',
    fields: [
      { label: 'Total Fuel Sales', purpose: 'fuel' },
      { label: 'Volume on Total Fuel Sales', purpose: 'gallons', note: 'volume on the fuel total row, not grade lines' },
      { label: 'Total Non Fuel Sales', purpose: 'store_credit' },
      { label: 'Grand Total Store Sales Reading', purpose: 'ignore', note: 'register reading, not today' },
    ],
  },
  {
    id: 'exxon_tender',
    title: 'Exxon tender page (cash)',
    kind: 'daily_close',
    packs: ['c_store_gas'],
    note: 'Cash is Cash Acceptor Cash, not the Cash row. Pump CRIND stays in fuel. Paid-outs come off this cash.',
    fields: [
      { label: 'Cash Acceptor Cash', purpose: 'cash' },
      { label: 'Cash', purpose: 'ignore', note: 'often $0, not the till cash' },
      { label: 'Credit CRIND', purpose: 'ignore', note: 'pump cards, already in fuel' },
    ],
  },
  {
    id: 'notebook_store_sales',
    title: 'Handwritten store sales',
    kind: 'daily_close',
    packs: ['c_store_gas'],
    note: 'Gas site: inside shop (cigs, drinks) plus gas. Read footer totals only. Product lines are today’s inside sales, not an order.',
    fields: [
      { label: 'Store Credit', purpose: 'store_credit' },
      { label: 'Store Cash', purpose: 'cash' },
      { label: 'Gas', purpose: 'fuel' },
      { label: 'ATM / named paid-out', purpose: 'payout' },
      { label: 'Total', purpose: 'inside_total' },
      { label: 'Net cash', purpose: 'day_total' },
      { label: 'product lines (Marlboro, Lava, …)', purpose: 'ignore' },
    ],
  },
  {
    id: 'day_till_close',
    title: 'Day / till close',
    kind: 'daily_close',
    packs: ['appointments', 'desk', 'real_estate', 'personal', 'generic'],
    note: 'End-of-day cash or till total for non-fuel businesses. Teach labels to match your sheet.',
    fields: [
      { label: 'Cash / till', purpose: 'cash' },
      { label: 'Card / credit', purpose: 'store_credit' },
      { label: 'Day total', purpose: 'day_total' },
      { label: 'Deposit', purpose: 'deposit' },
    ],
  },
  {
    id: 'vendor_invoice',
    title: 'Vendor invoice',
    kind: 'invoice',
    note: 'Read vendor, total, due date, and what was already paid. Line items are the bill, not an order list.',
    fields: [
      { label: 'Vendor', purpose: 'vendor' },
      { label: 'Total', purpose: 'invoice_total' },
      { label: 'Due date', purpose: 'due_date' },
      { label: 'Paid / remaining', purpose: 'paid' },
    ],
  },
  {
    id: 'shift_schedule',
    title: 'Shift schedule',
    kind: 'work_schedule',
    note: 'Hours only. Time In / Time Out. Skip days marked off. Ignore any printed period header.',
    fields: [
      { label: 'Time In', purpose: 'hours' },
      { label: 'Time Out', purpose: 'hours' },
      { label: 'Total Hours', purpose: 'hours' },
      { label: 'printed period header', purpose: 'ignore' },
    ],
  },
];

export function presetsForPack(pack: VerticalPack | null | undefined): PictureTemplatePreset[] {
  return PICTURE_TEMPLATE_PRESETS.filter((p) => {
    if (!p.packs || p.packs.length === 0) return true;
    if (!pack) return p.packs.includes('c_store_gas') || p.packs.includes('generic');
    return p.packs.includes(pack);
  });
}

/** Merge hints from a map’s field purposes — pack-agnostic. */
export function mergeHintsFromPurposes(purposes: Iterable<PictureFieldPurpose>): {
  fuelish: boolean;
  tenderish: boolean;
  sheetish: boolean;
} {
  const set = new Set(purposes);
  const fuelish = set.has('fuel') || set.has('gallons');
  const sheetish = set.has('store_credit') || set.has('inside_total');
  const tenderish = set.has('cash') && !fuelish;
  return { fuelish, tenderish, sheetish };
}

export function findPictureTemplate(
  templates: PictureTemplate[],
  id: string | null | undefined
): PictureTemplate | null {
  if (!id) return null;
  return templates.find((t) => t.id === id) ?? null;
}

export function purposesForKind(kind: PictureTemplateKind): PictureFieldPurpose[] {
  return PICTURE_FIELD_PURPOSES.filter((p) => PURPOSE_KINDS[p].includes(kind));
}

export function pictureMapsBoard(
  templates: PictureTemplate[],
  pack?: VerticalPack | null
) {
  return {
    pictureTemplates: templates,
    pictureTemplatePresets: presetsForPack(pack),
    pictureTemplateKinds: Object.entries(PICTURE_KIND_LABEL).map(([id, label]) => ({ id, label })),
    picturePurposes: PICTURE_FIELD_PURPOSES.map((id) => ({
      id,
      label: PICTURE_PURPOSE_LABEL[id],
      kinds: PURPOSE_KINDS[id],
    })),
  };
}

export function newPictureTemplateId(): string {
  return `pic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function templateFromPreset(presetId: string): Omit<PictureTemplate, 'id'> | null {
  const preset = PICTURE_TEMPLATE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return {
    kind: preset.kind,
    title: preset.title,
    note: preset.note,
    fields: preset.fields.map((f) => ({ ...f })),
  };
}

function cleanField(field: { label?: string; purpose: PictureFieldPurpose; note?: string }): PictureField | null {
  const label = (field.label ?? '').trim().slice(0, 80);
  if (!label) return null;
  const note = field.note?.trim().slice(0, 120) || undefined;
  return { label, purpose: field.purpose, ...(note ? { note } : {}) };
}

export function cleanPictureTemplate(input: {
  id?: string;
  kind: PictureTemplateKind;
  title: string;
  note?: string;
  fields: Array<{ label?: string; purpose: PictureFieldPurpose; note?: string }>;
}): PictureTemplate | null {
  const title = input.title.trim().slice(0, 80) || 'Picture map';
  const kind = PICTURE_TEMPLATE_KINDS.includes(input.kind) ? input.kind : 'daily_close';
  const fields = input.fields.map(cleanField).filter((f): f is PictureField => Boolean(f)).slice(0, MAX_PICTURE_FIELDS);
  if (fields.length === 0) return null;
  const note = input.note?.trim().slice(0, 400) || undefined;
  return {
    id: input.id?.trim() || newPictureTemplateId(),
    kind,
    title,
    ...(note ? { note } : {}),
    fields,
  };
}

/** One line the owner sees after save. */
export function describePictureTemplate(template: PictureTemplate): string {
  const takes = template.fields
    .filter((f) => f.purpose !== 'ignore')
    .map((f) => `${f.label} → ${PICTURE_PURPOSE_LABEL[f.purpose]}`);
  const ignores = template.fields.filter((f) => f.purpose === 'ignore').map((f) => f.label);
  const parts = [template.title, ...takes];
  if (ignores.length) parts.push(`ignore ${ignores.join(', ')}`);
  return parts.join(' · ');
}

/** Vocabulary injected into the extraction prompt for this business. */
export function pictureMapsForPrompt(templates: PictureTemplate[]): string[] {
  if (templates.length === 0) {
    return [
      'No picture maps taught yet for this business. Identify the document kind, fill only fields visible on this page, and leave others null. Multi-page bursts merge later by business and date.',
    ];
  }
  const header =
    'Match this photo to exactly one picture map below when it fits. Set pageTemplateId to that map’s id and pageTemplateTitle to its title. Only fill fields that map covers; leave other amounts null so other pages in the burst can supply them.';
  const lines = templates.slice(0, MAX_PICTURE_TEMPLATES).map((t) => {
    const fields = t.fields
      .map((f) => {
        const extra = f.note ? ` (${f.note})` : '';
        const verb = f.purpose === 'ignore' ? 'ignore' : 'take';
        return `${verb} "${f.label}" as ${PURPOSE_PROMPT[f.purpose]}${extra}`;
      })
      .join('; ');
    const note = t.note ? ` Owner note: ${t.note.slice(0, 240)}` : '';
    return `picture map id="${t.id}" title="${t.title}" (${t.kind}): ${fields}.${note}`;
  });
  return [header, ...lines];
}
