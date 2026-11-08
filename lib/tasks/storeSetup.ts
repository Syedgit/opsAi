import { z } from 'zod';
import { bucketFor, STORE_FEATURES, TASK_BUCKETS, presetsForStore, type StoreFeature, type TaskBucket, type TaskPreset } from './presets';
import { TaskTemplateInputSchema, describeSchedule, type TaskTemplateInput } from './schedule';
import { parseHHMM } from './time';

/**
 * What a store tells us when it is set up: what kind of store it is, when it is open, and what its
 * shifts are. The starter tasks are then placed to fit: a "Morning" routine lands in the first shift, an
 * "end of shift" routine in the last, and nothing is scheduled while the store is closed.
 * No people or phone numbers are collected here.
 */

export const STORE_TYPES = [
  'seven_eleven',
  'convenience',
  'gas_station',
  'office',
  'shipping',
  'real_estate',
  'appointments',
  'personal',
  'other',
] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export const STORE_TYPE_LABEL: Record<StoreType, string> = {
  seven_eleven: '7-Eleven',
  convenience: 'Convenience store',
  gas_station: 'Gas station',
  office: 'Office',
  shipping: 'Shipping / UPS-style',
  real_estate: 'Real estate',
  appointments: 'Appointments / salon / clinic',
  personal: 'Personal / solo',
  other: 'Other business',
};

/** How the setup screen groups types. A restaurant or gym picks Other — not a new industry card. */
export const STORE_TYPE_FAMILY: Record<StoreType, 'shop' | 'desk' | 'appointments' | 'solo' | 'other'> = {
  seven_eleven: 'shop',
  convenience: 'shop',
  gas_station: 'shop',
  office: 'desk',
  shipping: 'desk',
  real_estate: 'desk',
  appointments: 'appointments',
  personal: 'solo',
  other: 'other',
};

export const STORE_FAMILY_LABEL: Record<typeof STORE_TYPE_FAMILY[StoreType], string> = {
  shop: 'Shop and fuel',
  desk: 'Office and team',
  appointments: 'Appointments',
  solo: 'Just you',
  other: 'Something else',
};

export const STORE_FAMILY_ORDER: Array<typeof STORE_TYPE_FAMILY[StoreType]> = ['shop', 'desk', 'appointments', 'solo', 'other'];

export const STORE_TYPE_BLURB: Record<StoreType, string> = {
  seven_eleven: 'Franchise store. Shift checks plus 7Clean inspection tasks on a schedule.',
  convenience: 'Shop without pumps. Simple cleaning, coffee, and restock reminders.',
  gas_station: 'Fuel and a shop. Adds pump and spill-kit reminders when you sell fuel.',
  office: 'Desk team, agency, insurance. Who is in, meetings, lock-up. Mail later.',
  shipping: 'UPS / pack-and-ship counter. Who is on, held packages, last drop-off. Tick cooler or shelves if this counter has them.',
  real_estate: 'Agency or team. Showings, keys, lock-up. Open house later.',
  appointments: 'Salon, barber, clinic, studio. Today’s book, rooms, till close. Tick cooler or shelves if you restock product.',
  personal: 'Just you. Daily plan and wrap-up in WhatsApp — works in a 1:1 chat.',
  other: 'Other business — restaurant, gym, auto, contractor. Not UPS (pick Shipping) and not a salon (pick Appointments). Open and lock-up first; tick cooler, shelves, or a till if you have them.',
};

export const MAX_SHIFTS = 4;

const hhmm = z
  .string()
  .trim()
  .refine((v) => parseHHMM(v) !== null, 'use a time like 06:00')
  .transform((v) => {
    const m = parseHHMM(v) as number;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });

export const StoreSetupSchema = z
  .object({
    storeType: z.enum(STORE_TYPES),
    open24h: z.boolean(),
    opensAt: hhmm.nullish().transform((v) => v ?? null),
    closesAt: hhmm.nullish().transform((v) => v ?? null),
    shifts: z
      .array(z.object({ name: z.string().trim().min(1, 'name each shift').max(30), start: hhmm }))
      .min(1, 'add at least one shift')
      .max(MAX_SHIFTS, `up to ${MAX_SHIFTS} shifts`),
    /** The store has fuel pumps (turns on the fuel standards). */
    fuel: z.boolean(),
    /** Extra equipment this location has. Shop types also get cooler/shelves/restroom/till automatically. */
    features: z.array(z.enum(STORE_FEATURES)).max(8).default([]),
  })
  .superRefine((s, ctx) => {
    const starts = s.shifts.map((x) => x.start);
    if (new Set(starts).size !== starts.length) {
      ctx.addIssue({ code: 'custom', path: ['shifts'], message: 'two shifts start at the same time' });
    }
    if (s.open24h) return;
    const open = s.opensAt ? parseHHMM(s.opensAt) : null;
    const close = s.closesAt ? parseHHMM(s.closesAt) : null;
    if (open === null || close === null) {
      ctx.addIssue({ code: 'custom', path: ['opensAt'], message: 'say when the store opens and closes, or choose open 24 hours' });
      return;
    }
    if (close <= open) {
      ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'closing must be later than opening on the same day. For a store open past midnight choose open 24 hours' });
      return;
    }
    for (const sh of s.shifts) {
      const m = parseHHMM(sh.start) as number;
      if (m < open || m >= close) {
        ctx.addIssue({ code: 'custom', path: ['shifts'], message: `the ${sh.name} shift starts when the store is closed` });
      }
    }
  })
  .transform((s) => {
    const features = Array.from(new Set(s.fuel ? [...s.features, 'fuel' as const] : s.features));
    return {
      ...s,
      features,
      opensAt: s.open24h ? null : s.opensAt,
      closesAt: s.open24h ? null : s.closesAt,
      shifts: [...s.shifts].sort((a, b) => (parseHHMM(a.start) as number) - (parseHHMM(b.start) as number)),
    };
  });
export type StoreSetup = z.infer<typeof StoreSetupSchema>;

const SHOP_TYPES: StoreType[] = ['seven_eleven', 'convenience', 'gas_station'];

export function defaultFeatures(storeType: StoreType): StoreFeature[] {
  if (storeType === 'appointments') return ['till', 'restroom'];
  return [];
}

/** What this location actually has, including shop-floor defaults a c-store never has to tick. */
export function featuresOn(setup: StoreSetup): Set<StoreFeature> {
  const out = new Set<StoreFeature>(setup.features ?? []);
  if (setup.fuel) out.add('fuel');
  if (SHOP_TYPES.includes(setup.storeType)) {
    out.add('cooler');
    out.add('shelves');
    out.add('restroom');
    out.add('till');
  }
  return out;
}

/** What the setup form starts with for each kind of store. */
export function defaultSetup(storeType: StoreType): StoreSetup {
  const open24h = storeType === 'seven_eleven';
  if (open24h) {
    return {
      storeType,
      open24h: true,
      opensAt: null,
      closesAt: null,
      shifts: [
        { name: 'Morning', start: '06:00' },
        { name: 'Evening', start: '14:00' },
        { name: 'Night', start: '22:00' },
      ],
      fuel: false,
      features: defaultFeatures(storeType),
    };
  }
  const desk =
    storeType === 'office' || storeType === 'real_estate' || storeType === 'personal' || storeType === 'other'
      ? { opensAt: '09:00', closesAt: '18:00', shifts: [{ name: 'Morning', start: '09:00' }, { name: 'Afternoon', start: '13:00' }] }
      : storeType === 'shipping'
        ? { opensAt: '08:00', closesAt: '19:00', shifts: [{ name: 'Morning', start: '08:00' }, { name: 'Evening', start: '14:00' }] }
        : storeType === 'appointments'
          ? { opensAt: '09:00', closesAt: '19:00', shifts: [{ name: 'Morning', start: '09:00' }, { name: 'Evening', start: '14:00' }] }
          : { opensAt: '06:00', closesAt: '22:00', shifts: [{ name: 'Morning', start: '06:00' }, { name: 'Evening', start: '14:00' }] };
  return {
    storeType,
    open24h: false,
    opensAt: desk.opensAt,
    closesAt: desk.closesAt,
    shifts: desk.shifts,
    fuel: storeType === 'gas_station',
    features: defaultFeatures(storeType),
  };
}

export function storeTypeOptions() {
  return STORE_TYPES.map((id) => ({
    id,
    label: STORE_TYPE_LABEL[id],
    blurb: STORE_TYPE_BLURB[id],
    family: STORE_TYPE_FAMILY[id],
    familyLabel: STORE_FAMILY_LABEL[STORE_TYPE_FAMILY[id]],
    defaults: defaultSetup(id),
  }));
}

/** Reads a saved setup; a damaged or missing one reads as "not set up yet". */
export function readStoredSetup(value: unknown): StoreSetup | null {
  const parsed = StoreSetupSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------ placing the tasks ------------------------------ */

const DAY = 1440;
const mod = (n: number) => ((n % DAY) + DAY) % DAY;
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Which shift a starter task belongs to, and the time of day its own wording assumed. */
const SHIFT_ANCHOR: Record<string, { which: 'first' | 'second' | 'last'; base: number }> = {
  Morning: { which: 'first', base: 6 * 60 },
  'Second shift': { which: 'second', base: 14 * 60 },
  'End of shift': { which: 'last', base: 14 * 60 },
  Night: { which: 'last', base: 22 * 60 },
};

/** Keep a task away from the minutes right after opening and right before closing. */
const EDGE = 30;

interface Placed {
  startTime: string;
  endTime: string | null;
  repeatEveryMinutes: number | null;
  shift: string | null;
}

function place(t: TaskTemplateInput, setup: StoreSetup): Placed {
  const start = parseHHMM(t.startTime) as number;
  const end = t.endTime ? (parseHHMM(t.endTime) as number) : null;
  const window = end !== null ? end - start : 0;
  const shifts = setup.shifts.map((s) => parseHHMM(s.start) as number);
  const open = setup.open24h ? null : (parseHHMM(setup.opensAt as string) as number);
  const close = setup.open24h ? null : (parseHHMM(setup.closesAt as string) as number);

  let newStart = start;
  let newEnd = end;
  let shiftName = t.shift;

  const anchor = t.shift ? SHIFT_ANCHOR[t.shift] : undefined;
  if (anchor) {
    const index = anchor.which === 'first' ? 0 : anchor.which === 'last' ? shifts.length - 1 : Math.min(1, shifts.length - 1);
    const from = shifts[index];
    // A shift lasts until the next one starts; the last one until closing (or until the first starts again).
    const until = index + 1 < shifts.length ? shifts[index + 1] : close !== null ? close : shifts[0] + DAY;
    const length = until - from;
    const offset = Math.min(mod(start - anchor.base), Math.max(0, length - EDGE));
    newStart = from + offset;
    if (end !== null) newEnd = Math.min(newStart + window, from + length);
    shiftName = setup.shifts[index].name;
  }

  // A repeating task must stay on one calendar day.
  if (newEnd !== null && newEnd >= DAY) newEnd = DAY - 5;
  newStart = mod(newStart);

  // Stay inside opening hours.
  if (open !== null && close !== null && close - open > 2 * EDGE) {
    const lo = open + EDGE;
    const hi = close - EDGE;
    newStart = Math.min(Math.max(newStart, lo), hi);
    if (newEnd !== null) newEnd = Math.min(newEnd, hi);
  }

  // Too little room left to repeat: ask once, at the start.
  if (newEnd !== null && t.repeatEveryMinutes && newEnd - newStart < t.repeatEveryMinutes) newEnd = null;

  return {
    startTime: toHHMM(newStart),
    endTime: newEnd === null ? null : toHHMM(newEnd),
    repeatEveryMinutes: newEnd === null ? null : t.repeatEveryMinutes,
    shift: shiftName,
  };
}

export interface Suggestion {
  presetId: string;
  title: string;
  group: string;
  bucket: TaskBucket;
  bucketLabel: string;
  source: TaskPreset['source'];
  /** Ticked by default for this kind of store. */
  recommended: boolean;
  /** The task as it would be saved, placed to fit the store's shifts and hours. */
  template: TaskTemplateInput;
  scheduleText: string;
}

/** 7-Eleven and gas/shop keep the existing full starter ticks — those sites are known. */
const SHOP_RECOMMENDED = new Set([
  'own-daily-close', 'own-deposit', 'own-opening',
  'own-coffee-station', 'own-restroom-check', 'ic-floors', 'own-trash', 'own-restock', 'own-safe-drop', 'own-fire-safety',
  'own-fuel-islands', 'own-pump-check', 'own-spill-kit', 'own-competitor-prices',
]);

/**
 * Office, salon, realty, shipping, personal, and “other” only tick a few on day one.
 * The rest stay on the list for Store admin — we do not invent a full ops pack for businesses we have not run.
 */
const BILLS_MONTHLY = ['own-utility-bill', 'own-insurance'] as const;
const MIN_RECOMMENDED: Record<string, Set<string>> = {
  office: new Set(['own-coverage', 'own-meetings', 'own-lock-up', ...BILLS_MONTHLY]),
  shipping: new Set(['own-who-on', 'own-packages', 'own-cutoff', ...BILLS_MONTHLY]),
  real_estate: new Set(['own-showings', 'own-keys', 'own-lock-up', ...BILLS_MONTHLY]),
  appointments: new Set(['own-appointments-today', 'own-rooms-ready', 'own-confirm-tomorrow', 'own-daily-close', ...BILLS_MONTHLY]),
  personal: new Set(['own-today-plan', 'own-follow-ups', 'own-wrap-up', ...BILLS_MONTHLY]),
  other: new Set(['own-open-desk', 'own-lock-up', ...BILLS_MONTHLY]),
};

function isRecommended(preset: TaskPreset, setup: StoreSetup): boolean {
  const min = MIN_RECOMMENDED[setup.storeType];
  if (min) return min.has(preset.id);
  if (preset.id === 'own-daily-close' || preset.id === 'own-deposit') return true;
  if (preset.id === 'own-competitor-prices') return setup.fuel;
  if (setup.storeType !== 'seven_eleven') return SHOP_RECOMMENDED.has(preset.id);
  const t = preset.template;
  if (preset.requires) return preset.source === 'report' && setup.fuel;
  // The routines behind the heavily weighted 7Clean standards, not the whole list: too many tasks wear a team out.
  return preset.source === 'report' && (t.criticality === 'critical' || t.criticality === 'major');
}

/** The starter tasks that fit this store, with times placed around its shifts and hours. */
export function suggestTasks(setup: StoreSetup, presets: TaskPreset[] = presetsForStore(setup.storeType)): Suggestion[] {
  const has = featuresOn(setup);
  return presets
    .filter((p) => !p.requires || has.has(p.requires))
    .map((p) => {
      const placed = place(p.template, setup);
      const template = TaskTemplateInputSchema.parse({ ...p.template, ...placed });
      const bucket = bucketFor(p);
      return {
        presetId: p.id,
        title: template.title,
        group: p.group,
        bucket,
        bucketLabel: TASK_BUCKETS[bucket].label,
        source: p.source,
        recommended: isRecommended(p, setup),
        template,
        scheduleText: describeSchedule(template),
      };
    });
}
