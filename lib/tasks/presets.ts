import type { TaskTemplateInput } from './schedule';
import { TaskTemplateInputSchema } from './schedule';

/**
 * Starter tasks an owner can add to a store with one click, then edit.
 *
 * The 7-Eleven library is built from a real 7Clean "Debrief Report" (October 2026). 7Clean is the same
 * national standard in every 7-Eleven, so these are shared by all stores. Points follow the report:
 * Critical 50, Major 20, Minor 3. Standard IDs (FS6, PF5, ...) are the report's own.
 *
 * What the report does NOT give us: it only describes the standards that failed, plus a partial list of the
 * pass/fail and count items. So this library covers what the report shows, not the whole standard. Add more
 * reports to grow it. Entries marked `source: 'suggested'` are routines we added, not standards from the report.
 *
 * Times are the store's local clock and are only a starting point: edit them for the store's shifts.
 */

/** Things a store may or may not have. A starter task that needs one is only offered when the owner says the store has it. */
export const STORE_FEATURES = ['fuel', 'cooler', 'shelves', 'restroom', 'till'] as const;
export type StoreFeature = (typeof STORE_FEATURES)[number];

/** Same values as the setup form's store types (kept here so presets do not depend on the setup code). */
export type StoreKind = 'seven_eleven' | 'convenience' | 'gas_station' | 'office' | 'shipping' | 'real_estate' | 'appointments' | 'personal' | 'other';

export const STORE_FEATURE_LABEL: Record<StoreFeature, string> = {
  fuel: 'This location has fuel pumps',
  cooler: 'Walk-in or display cooler',
  shelves: 'Retail shelves to restock',
  restroom: 'Restroom to check',
  till: 'Cash register / daily close',
};

/** How the setup screen groups a starter task so the owner can see what they are picking. */
export const TASK_BUCKETS = {
  daily_reports: {
    label: 'Daily reports',
    blurb: 'WhatsApp nags the shift to send numbers you already collect — the close, the deposit, competitor prices, invoices.',
  },
  shift_checks: {
    label: 'Shift reminders',
    blurb: 'Time-based checks on each shift: open, clean, restock, pumps. Staff reply OK or send a photo.',
  },
  photo_proofs: {
    label: 'Photo proofs',
    blurb: 'Must send a picture — date labels, 7Clean items, a POS screen. The task stays open until the photo is right.',
  },
  weekly_monthly: {
    label: 'Weekly and monthly',
    blurb: 'Less often: utility and insurance bills, fire safety, spill kit, pest report, deep clean.',
  },
} as const;
export type TaskBucket = keyof typeof TASK_BUCKETS;
export const TASK_BUCKET_ORDER: TaskBucket[] = ['daily_reports', 'shift_checks', 'photo_proofs', 'weekly_monthly'];

export interface TaskPreset {
  id: string;
  group: string;
  /** 'report' = a standard the 7Clean report shows; 'suggested' = a routine we added. */
  source: 'report' | 'suggested';
  requires?: StoreFeature;
  /** Left out: any kind of store. Otherwise only these. (7Clean 'report' standards are for 7-Eleven only; see presetsForStore.) */
  stores?: StoreKind[];
  template: TaskTemplateInput;
}

const all = [0, 1, 2, 3, 4, 5, 6];

function preset(
  id: string,
  group: string,
  source: TaskPreset['source'],
  input: Record<string, unknown>,
  requires?: StoreFeature,
  stores?: StoreKind[]
): TaskPreset {
  return { id, group, source, requires, stores, template: TaskTemplateInputSchema.parse({ daysOfWeek: all, ...input }) };
}

const FOOD = 'Food Safety';
const FRESH = 'Proprietary Fresh Food';
const BEV = 'Proprietary Beverage';
const AVAIL = 'Product Availability';
const VAULT = 'Vault';
const INTERIOR = 'Interior Cleanliness';
const EXTERIOR = 'Exterior Cleanliness';
const BOH = 'Back of House';
const OWN = 'Everyday routines';
const REPORTS = 'Daily reports';
const STATION = 'Pumps and forecourt';
const SEVEN: StoreKind[] = ['seven_eleven'];
/** C-store / gas shop floor — not a generic “other” business. */
const SHOP: StoreKind[] = ['convenience', 'gas_station'];
const NOT_711: StoreKind[] = ['convenience', 'gas_station'];
const DESK: StoreKind[] = ['office', 'shipping', 'real_estate', 'appointments', 'personal', 'other'];
const RETAIL: StoreKind[] = ['seven_eleven', 'convenience', 'gas_station'];
const SERVICE: StoreKind[] = ['appointments'];
/** Salon, UPS, or “other” can opt into shop-floor extras (cooler, shelves) without inheriting the c-store pack. */
const OPTIONAL_FLOOR: StoreKind[] = ['appointments', 'shipping', 'other'];
const ALL_KINDS: StoreKind[] = [
  'seven_eleven',
  'convenience',
  'gas_station',
  'office',
  'shipping',
  'real_estate',
  'appointments',
  'personal',
  'other',
];
const BILLS = 'Bills / insurance';

export const TASK_PRESETS: TaskPreset[] = [
  // ---------- Food Safety ----------
  preset('fs6-milk-labels', FOOD, 'report', {
    standardId: 'FS6', criticality: 'critical', category: 'food_safety', shift: 'Morning',
    title: 'Date labels on opened milk, creamers and TCS food',
    instructions: 'Every opened container in the dispensers and cold wells has a date label and none is expired. Photo of the dispensers and cold wells.',
    fallback: 'Label printer broken? Write the open date and time on masking tape with a marker, and log what you labelled.',
    startTime: '07:00', endTime: '15:00', repeatEveryMinutes: 60, evidence: 'photo', lateAfterMinutes: 30,
  }),
  preset('fs1-condiments', FOOD, 'report', {
    standardId: 'FS1', criticality: 'critical', category: 'food_safety', shift: 'Every shift',
    title: 'Condiment containers dated, none expired',
    instructions: 'Each in-use condiment container has its own date on the container. Back-up condiments are within the manufacturer date. Photo of the station.',
    fallback: 'Label printer broken? Date each container by hand with a marker.',
    startTime: '08:00', endTime: '16:00', repeatEveryMinutes: 480, evidence: 'photo',
  }),
  preset('fs5-cold-holding', FOOD, 'report', {
    standardId: 'FS5', criticality: 'major', category: 'food_safety', shift: 'Every shift',
    title: 'Cold holding temperature (open-air case)',
    instructions: 'A working thermometer is in the open-air case. Reply with the temperature, like: 38',
    fallback: 'No thermometer or it is broken? Use a probe thermometer now and replace the case thermometer today.',
    minValue: null, maxValue: 40, unit: 'F',
    startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 240, evidence: 'text', escalateAfterMinutes: 30,
  }),
  preset('fs14-handwashing', FOOD, 'report', {
    standardId: 'FS14', criticality: 'major', category: 'food_safety', shift: 'Morning',
    title: 'Watch staff wash hands before handling food',
    instructions: 'Hands are washed on entering food areas and at the right times. Reply yes, or what you corrected.',
    startTime: '11:30', evidence: 'text',
  }),
  preset('fs24-temp-log', FOOD, 'report', {
    standardId: 'FS24', category: 'food_safety', shift: 'End of shift', points: 3,
    title: 'Temperature log filled out',
    instructions: 'Hot and cold holding, cooling and equipment temperatures are all written on the log. Photo of the log.',
    startTime: '14:00', endTime: '22:00', repeatEveryMinutes: 480, evidence: 'photo',
  }),
  preset('af1-sanitizer', FOOD, 'report', {
    standardId: 'AF1', criticality: 'critical', category: 'food_safety', shift: 'Every shift',
    title: 'Sanitizer set up and in use (auto-fail if not)',
    instructions: 'Sanitizer is mixed and used on food-contact surfaces and tools. Reply with the test-strip reading in ppm, or send a photo of the strip.',
    startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 480, evidence: 'either',
  }),
  preset('af2-pests', FOOD, 'report', {
    standardId: 'AF2', criticality: 'critical', category: 'food_safety', shift: 'Morning',
    title: 'No signs of roaches or rodents (auto-fail if seen)',
    instructions: 'Check the usual spots. Reply none, or what you saw and where.',
    startTime: '07:30', evidence: 'text',
  }),
  preset('as2-safe-to-operate', FOOD, 'report', {
    standardId: 'AS2', criticality: 'critical', category: 'food_safety', shift: 'Morning',
    title: 'Safe to operate: no ill staff, power, hot and drinking water',
    instructions: 'Reply ok, or the problem. A problem here can close food service.',
    startTime: '06:30', evidence: 'text', escalateAfterMinutes: 20,
  }),

  // ---------- Proprietary Fresh Food ----------
  preset('pf5-roller-grill', FRESH, 'report', {
    standardId: 'PF5', criticality: 'critical', category: 'proprietary_fresh', shift: 'Every shift',
    title: 'Roller grill: 140F or higher, code-date labels, 4-hour hold',
    instructions: 'Each product has a code-date label and is within its 4-hour hold, not dry or shriveled. Reply with the grill temperature, like: 150',
    fallback: 'No code-date labels? Write the time put out and the 4-hour discard time on tape with a marker.',
    minValue: 140, maxValue: null, unit: 'F',
    startTime: '07:00', endTime: '21:00', repeatEveryMinutes: 120, evidence: 'text',
  }),
  preset('pf6-buns', FRESH, 'report', {
    standardId: 'PF6', criticality: 'major', category: 'proprietary_fresh', shift: 'Morning',
    title: 'Hot dog buns coded; grill, bun warmer and HDAT clean',
    instructions: 'Wrapped buns are coded and not expired. Roller grill, bun warmer and HDAT are clean and sanitized. Photo.',
    fallback: 'No labels? Hand-write the code date on each pack.',
    startTime: '09:00', endTime: '17:00', repeatEveryMinutes: 480, evidence: 'photo',
  }),
  preset('pf7-chili-cheese', FRESH, 'report', {
    standardId: 'PF7', criticality: 'major', category: 'proprietary_fresh', shift: 'Every shift',
    title: 'Chili and cheese: clean, date and time labels, nacho chips in code',
    instructions: 'Labels carry date and time and are not expired. No handwritten signs. Photo.',
    fallback: 'Label printer broken? Hand-label with date and time, and log it.',
    startTime: '07:00', endTime: '19:00', repeatEveryMinutes: 240, evidence: 'photo',
  }),

  // ---------- Proprietary Beverage ----------
  preset('pb1-fountain', BEV, 'report', {
    standardId: 'PB1', criticality: 'critical', category: 'proprietary_beverage', shift: 'Every shift',
    title: 'Fountain and frozen beverage equipment clean and sanitized',
    instructions: 'Nozzles, ice chutes and the inside and outside of the machines. No build-up on the nozzles. Photo of the nozzles.',
    startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 480, evidence: 'photo',
  }),

  // ---------- Product Availability ----------
  preset('pa1-vault-doors', AVAIL, 'report', {
    standardId: 'PA1', criticality: 'minor', category: 'product_availability', shift: 'Every shift',
    title: 'Vault doors stocked (under 4 empty rows per door)',
    instructions: 'Energy, soda, water, isotonic and single beer doors. Reply with the most empty rows on any one door, like: 2. Flagged in the previous inspection too.',
    minValue: null, maxValue: 3, unit: 'rows',
    startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 480, evidence: 'either',
  }),
  preset('pa2-hot-case', AVAIL, 'report', {
    standardId: 'PA2', criticality: 'minor', category: 'product_availability', shift: 'Morning',
    title: 'Hot food case has 4 or more different items',
    instructions: 'Reply with how many different items are in the hot food case, like: 5',
    minValue: 4, maxValue: null, unit: 'items',
    startTime: '08:00', endTime: '16:00', repeatEveryMinutes: 480, evidence: 'text',
  }),
  preset('pa4-roller-skus', AVAIL, 'report', {
    standardId: 'PA4', criticality: 'minor', category: 'product_availability', shift: 'Morning',
    title: 'Roller grill has 4 or more products, at least 2 of each',
    instructions: 'Reply with how many products have at least 2 available, like: 5',
    minValue: 4, maxValue: null, unit: 'products',
    startTime: '08:00', endTime: '16:00', repeatEveryMinutes: 480, evidence: 'text',
  }),
  preset('pa6-fountain-flavors', AVAIL, 'report', {
    standardId: 'PA6', criticality: 'minor', category: 'product_availability', shift: 'Every shift',
    title: 'Fountain flavors in stock (at most 1 out)',
    instructions: 'Press each flavor button. Reply with how many flavors are out, like: 0',
    minValue: null, maxValue: 1, unit: 'out',
    startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 480, evidence: 'text',
  }),

  // ---------- Vault ----------
  preset('v2-vault-racks', VAULT, 'report', {
    standardId: 'V2', criticality: 'major', category: 'vault', shift: 'Night', daysOfWeek: [1],
    title: 'Back-of-house vault racks and shelving cleaned',
    instructions: 'Glide racks and shelving are free of white build-up and organic matter. Photo.',
    startTime: '22:00', evidence: 'photo',
  }),

  // ---------- Back of House ----------
  preset('boh2-pest-report', BOH, 'report', {
    standardId: 'BOH2', category: 'back_of_house', shift: 'Monthly', frequency: 'monthly', monthDays: [1], points: 2,
    title: 'Pest-control report from the last 90 days is on file',
    instructions: 'Reply with the date of the latest pest-control visit. If it is older than 90 days, call the pest-control company.',
    startTime: '10:00', evidence: 'text',
  }),
  preset('boh3-work-orders', BOH, 'report', {
    standardId: 'BOH3', category: 'back_of_house', shift: 'Weekly', daysOfWeek: [1], points: 2,
    title: 'List any open work orders (INC numbers)',
    instructions: 'Reply with the INC numbers of open work orders, or none. The inspector asks for these.',
    startTime: '10:15', evidence: 'text',
  }),

  // ---------- Exterior Cleanliness ----------
  preset('ec2-fuel-islands', EXTERIOR, 'report', {
    standardId: 'EC2', category: 'exterior_cleanliness', shift: 'Morning', points: 3,
    title: 'Parking lot and fuel islands clean, no grease spills',
    instructions: 'No excessive dried spills or neglected new spills. Photo.',
    startTime: '08:00', endTime: '16:00', repeatEveryMinutes: 480, evidence: 'photo',
  }, 'fuel'),
  preset('ec14-dumpster', EXTERIOR, 'report', {
    standardId: 'EC14', category: 'exterior_cleanliness', shift: 'Morning', points: 3,
    title: 'Dumpster plug or screen in place',
    instructions: 'Photo of the dumpster area.',
    startTime: '09:00', evidence: 'photo',
  }),

  // ---------- Interior Cleanliness (scored 100% in the report, so these keep it there) ----------
  preset('ic-coffee-counter', INTERIOR, 'suggested', {
    category: 'interior_cleanliness', shift: 'Night', points: 3,
    title: 'Clean the coffee counter',
    instructions: 'Wipe down, empty the grounds, refill. Photo when clean.',
    startTime: '23:00', evidence: 'photo',
  }, undefined, SEVEN),
  preset('ic-restrooms', INTERIOR, 'suggested', {
    category: 'interior_cleanliness', shift: 'Night', points: 3,
    title: 'Clean the restrooms',
    instructions: 'Photo of each restroom when finished.',
    startTime: '01:00', evidence: 'photo',
  }, undefined, SEVEN),
  preset('ic-floors', INTERIOR, 'suggested', {
    category: 'interior_cleanliness', shift: 'Night', points: 3,
    title: 'Mop the sales floor',
    startTime: '03:00', evidence: 'photo',
  }, undefined, [...SEVEN, ...SHOP]),

  // ---------- Daily reports the team must send (any kind of store) ----------
  preset('own-daily-close', REPORTS, 'suggested', {
    category: 'reports', shift: 'End of shift', points: 3,
    title: 'Send the daily close report',
    instructions: 'Send opsAi yesterday’s cash, card, gas, payouts and deposit on WhatsApp. A photo of the POS close screen is fine. Reply OK after opsAi reads it.',
    startTime: '22:00', evidence: 'either',
  }, 'till', [...RETAIL, ...SERVICE, ...OPTIONAL_FLOOR]),
  preset('own-deposit', REPORTS, 'suggested', {
    category: 'reports', shift: 'Morning', points: 3,
    title: 'Bank deposit done',
    instructions: 'Drop the deposit and send a photo of the slip, or reply with the amount.',
    startTime: '10:00', evidence: 'either',
  }, 'till', [...RETAIL, ...OPTIONAL_FLOOR]),
  preset('own-competitor-prices', REPORTS, 'suggested', {
    category: 'reports', shift: 'Morning', points: 3,
    title: 'Send competitor gas prices',
    instructions: 'Send a photo of each nearby pole (BP, Shell, Exxon). opsAi reads the prices. Caption the brand if the logo is hard to see. For our own board after a change, send that photo with “prices updated”.',
    startTime: '10:00', evidence: 'photo',
  }, 'fuel'),
  preset('own-invoice-photo', REPORTS, 'suggested', {
    category: 'reports', shift: 'End of shift', points: 3,
    title: 'Photo of today’s vendor invoices',
    instructions: 'Send a photo of each invoice that came in today. opsAi will read vendor, amount, and due date, and remind 3 days before payment is due.',
    startTime: '20:00', evidence: 'photo',
  }, 'till', [...RETAIL, ...OPTIONAL_FLOOR]),

  // ---------- Everyday routines (not from the report) ----------
  preset('own-opening', OWN, 'suggested', {
    category: 'safety', shift: 'Morning', points: 3,
    title: 'Opening checklist',
    instructions: 'Lights, registers, pumps, coffee, restrooms, safe. Reply OK or what is not ready.',
    startTime: '06:15', evidence: 'text',
  }, undefined, NOT_711),
  preset('own-lottery', OWN, 'suggested', {
    category: 'inventory', shift: 'End of shift', points: 3,
    title: 'Lottery / scratch-off count',
    instructions: 'Reply with the lottery sales or pack count for the shift.',
    startTime: '21:00', evidence: 'text',
  }, undefined, [...SEVEN, ...SHOP]),
  preset('own-cooler-temp', OWN, 'suggested', {
    category: 'equipment', shift: 'Every shift', points: 3,
    title: 'Walk-in / cooler temperature',
    instructions: 'Reply with the cooler temperature, like: 36',
    minValue: null, maxValue: 41, unit: 'F',
    startTime: '08:00', endTime: '20:00', repeatEveryMinutes: 480, evidence: 'text',
  }, 'cooler', [...NOT_711, ...OPTIONAL_FLOOR]),
  preset('own-coffee-station', OWN, 'suggested', {
    category: 'food_safety', shift: 'Morning', points: 3,
    title: 'Check the coffee station',
    instructions: 'Fresh pots, lids, cups and stirrers stocked. Photo of the station.',
    startTime: '10:00', evidence: 'photo',
  }, undefined, [...SEVEN, ...SHOP]),
  preset('own-make-food', OWN, 'suggested', {
    category: 'proprietary_fresh', shift: 'Morning', points: 3,
    title: 'Make fresh food and stock the case',
    instructions: 'Photo of the food case once stocked.',
    startTime: '11:00', evidence: 'photo',
  }, undefined, SEVEN),
  preset('own-oven-water', OWN, 'suggested', {
    category: 'food_safety', shift: 'Morning', points: 3,
    title: 'Check and change the oven water',
    instructions: 'Reply with a photo, or the time you changed it.',
    startTime: '08:00', evidence: 'either',
  }, undefined, SEVEN),
  preset('own-restock', OWN, 'suggested', {
    category: 'inventory', shift: 'Second shift', points: 3,
    title: 'Restock the shelves and coolers',
    instructions: 'Photo of the shelves and cooler doors after restocking.',
    startTime: '15:00', evidence: 'photo',
  }, 'shelves', [...SEVEN, ...SHOP, ...OPTIONAL_FLOOR]),
  preset('own-cycle-count', OWN, 'suggested', {
    category: 'inventory', shift: 'Second shift', points: 3,
    title: 'Cycle count',
    instructions: 'Reply with the section you counted and any mismatches.',
    startTime: '18:00', evidence: 'text',
  }, undefined, SEVEN),
  preset('own-fire-safety', OWN, 'suggested', {
    category: 'safety', shift: 'Monthly', frequency: 'monthly', monthDays: [1], points: 3,
    title: 'Check fire extinguishers and the first-aid kit',
    instructions: 'Gauges in the green, tags in date, first-aid kit stocked. Photo of each extinguisher tag.',
    startTime: '10:30', evidence: 'photo',
  }, undefined, [...SEVEN, ...SHOP]),
  preset('own-cooler-deep-clean', OWN, 'suggested', {
    category: 'food_safety', shift: 'Every 2 weeks', frequency: 'interval', intervalDays: 14, points: 3,
    title: 'Deep-clean the walk-in cooler shelves',
    instructions: 'Empty, wash, sanitize and restock. Photo when finished.',
    startTime: '14:00', evidence: 'photo',
  }, undefined, SEVEN),
  preset('own-safe-drop', OWN, 'suggested', {
    category: 'safety', points: 3,
    title: 'Safe drop done',
    startTime: '16:00', evidence: 'none',
  }, 'till', [...SEVEN, ...SHOP]),

  // ---------- Simple routines for stores that are not a 7-Eleven (no inspection standard behind them) ----------
  preset('own-restroom-check', OWN, 'suggested', {
    category: 'cleanliness', shift: 'Every shift', points: 3,
    title: 'Restroom check',
    instructions: 'Soap, paper, bins and floor. Reply with a photo, or OK when all is good.',
    startTime: '08:00', endTime: '20:00', repeatEveryMinutes: 240, evidence: 'either',
  }, 'restroom', [...NOT_711, ...OPTIONAL_FLOOR]),
  preset('own-trash', OWN, 'suggested', {
    category: 'cleanliness', shift: 'End of shift', points: 3,
    title: 'Empty the trash and tidy outside',
    instructions: 'Inside and outside bins emptied, the area around the door swept. Photo when done.',
    startTime: '20:00', evidence: 'photo',
  }, undefined, [...NOT_711, ...OPTIONAL_FLOOR]),
  preset('own-fuel-islands', STATION, 'suggested', {
    category: 'exterior_cleanliness', shift: 'Morning', points: 3,
    title: 'Clean the pumps and fuel islands',
    instructions: 'Wipe pump screens and handles, refill the squeegee buckets, empty the island bins. Photo of the islands.',
    startTime: '08:00', evidence: 'photo',
  }, 'fuel', NOT_711),
  preset('own-pump-check', STATION, 'suggested', {
    category: 'equipment', shift: 'Morning', points: 3,
    title: 'Check the pumps',
    instructions: 'Screens work, nozzles and hoses not damaged, receipt paper loaded. Tell us if anything is out of order.',
    startTime: '08:30', evidence: 'either',
  }, 'fuel', NOT_711),
  preset('own-spill-kit', STATION, 'suggested', {
    category: 'safety', shift: 'Weekly', daysOfWeek: [1], points: 3,
    title: 'Check the spill kit and the emergency fuel shut-off',
    instructions: 'Spill kit stocked, the red emergency shut-off button clear and not blocked. Photo.',
    startTime: '09:30', evidence: 'photo',
  }, 'fuel', NOT_711),

  preset('own-lock-up', OWN, 'suggested', {
    category: 'safety', shift: 'End of shift', points: 3,
    title: 'Lock up',
    instructions: 'Doors locked, lights off, alarm set. Reply OK or what is still open.',
    startTime: '18:00', evidence: 'text',
  }, undefined, DESK),
  preset('own-open-desk', OWN, 'suggested', {
    category: 'safety', shift: 'Morning', points: 3,
    title: 'Open up',
    instructions: 'Lights on, doors unlocked, stations ready. Reply OK or what is not ready.',
    startTime: '06:15', evidence: 'text',
  }, undefined, DESK),
  preset('own-coverage', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Who is in today',
    instructions: 'Post who is in the office and who is covering, or reply same as yesterday.',
    startTime: '06:25', evidence: 'text',
  }, undefined, ['office']),
  preset('own-meetings', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Today’s meetings',
    instructions: 'Post today’s meeting times and rooms, or reply none.',
    startTime: '06:35', evidence: 'text',
  }, undefined, ['office']),
  preset('own-mail', OWN, 'suggested', {
    category: 'customer_service', shift: 'Every shift', points: 3,
    title: 'Mail and packages',
    instructions: 'Check the mail drop and held packages. Reply with the count, or none.',
    startTime: '14:00', evidence: 'text',
  }, undefined, ['office']),
  preset('own-packages', OWN, 'suggested', {
    category: 'customer_service', shift: 'Every shift', points: 3,
    title: 'Held packages check',
    instructions: 'Count held packages, pull anything past hold date, reply with the count.',
    startTime: '11:00', evidence: 'text',
  }, undefined, ['shipping']),
  preset('own-who-on', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Who is on the counter',
    instructions: 'Post who is on the counter this shift.',
    startTime: '06:20', evidence: 'text',
  }, undefined, ['shipping']),
  preset('own-cutoff', OWN, 'suggested', {
    category: 'customer_service', shift: 'End of shift', points: 3,
    title: 'Last drop-off cutoff',
    instructions: 'Last outbound drop-off taken. Reply OK with the time, or what was turned away.',
    startTime: '16:30', evidence: 'text',
  }, undefined, ['shipping']),
  preset('own-supplies', OWN, 'suggested', {
    category: 'inventory', shift: 'Weekly', daysOfWeek: [1], points: 3,
    title: 'Boxes, tape, labels',
    instructions: 'Check packing supplies. Reply OK or what to reorder.',
    startTime: '10:00', evidence: 'text',
  }, undefined, ['shipping']),
  preset('own-showings', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Today’s showings',
    instructions: 'Post today’s showing times and who is covering, or reply none.',
    startTime: '06:25', evidence: 'text',
  }, undefined, ['real_estate']),
  preset('own-keys', OWN, 'suggested', {
    category: 'safety', shift: 'Morning', points: 3,
    title: 'Keys and lockbox',
    instructions: 'Who has which keys or lockbox codes today. Reply with names, or none out.',
    startTime: '06:35', evidence: 'text',
  }, undefined, ['real_estate']),
  preset('own-open-house', OWN, 'suggested', {
    category: 'customer_service', shift: 'Weekly', daysOfWeek: [6], points: 3,
    title: 'Open house prep',
    instructions: 'Signs, flyers, and who is hosting. Reply ready or what is missing.',
    startTime: '10:00', evidence: 'text',
  }, undefined, ['real_estate']),
  preset('own-appointments-today', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Today’s appointments',
    instructions: 'Post today’s book (times and who is with whom), or reply none.',
    startTime: '06:25', evidence: 'text',
  }, undefined, SERVICE),
  preset('own-confirm-tomorrow', OWN, 'suggested', {
    category: 'customer_service', shift: 'End of shift', points: 3,
    title: 'Confirm tomorrow’s bookings',
    instructions: 'Tomorrow’s appointments confirmed. Reply the count, or none.',
    startTime: '16:30', evidence: 'text',
  }, undefined, SERVICE),
  preset('own-rooms-ready', OWN, 'suggested', {
    category: 'cleanliness', shift: 'Morning', points: 3,
    title: 'Rooms / chairs ready',
    instructions: 'Stations or rooms set for the first appointments. Reply OK or what is not ready.',
    startTime: '06:20', evidence: 'text',
  }, undefined, SERVICE),
  preset('own-no-shows', OWN, 'suggested', {
    category: 'customer_service', shift: 'End of shift', points: 3,
    title: 'No-shows today',
    instructions: 'Reply with who did not show, or none.',
    startTime: '17:00', evidence: 'text',
  }, undefined, SERVICE),
  preset('own-today-plan', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Today’s plan',
    instructions: 'Reply with the top three things to get done today.',
    startTime: '06:20', evidence: 'text',
  }, undefined, ['personal', 'other']),
  preset('own-follow-ups', OWN, 'suggested', {
    category: 'customer_service', shift: 'Morning', points: 3,
    title: 'Follow-ups due',
    instructions: 'Reply with who you need to call or message today, or none.',
    startTime: '06:35', evidence: 'text',
  }, undefined, ['personal', 'real_estate', 'other']),
  preset('own-wrap-up', OWN, 'suggested', {
    category: 'safety', shift: 'End of shift', points: 3,
    title: 'Wrap up the day',
    instructions: 'What got done and what moves to tomorrow. Reply with a short list.',
    startTime: '17:30', evidence: 'text',
  }, undefined, ['personal', 'other']),
  preset('own-utility-bill', BILLS, 'suggested', {
    category: 'bills', shift: 'Morning', frequency: 'monthly', monthDays: [1], points: 3,
    title: 'Utility bills due',
    instructions: 'Electric, gas, water, internet, phone. Reply paid, or what is still open.',
    startTime: '10:00', evidence: 'text',
  }, undefined, ALL_KINDS),
  preset('own-insurance', BILLS, 'suggested', {
    category: 'bills', shift: 'Morning', frequency: 'monthly', monthDays: [1], points: 3,
    title: 'Insurance check',
    instructions: 'Store, liability, or vehicle insurance. Reply current, or what is due this month.',
    startTime: '10:15', evidence: 'text',
  }, undefined, ALL_KINDS),
];

/**
 * The starter tasks that make sense for a kind of store. The 7Clean standards are the 7-Eleven inspection:
 * they apply to a 7-Eleven only. Any other store gets simple routines (cleaning, coffee, restocking, pumps).
 * Null (a store that has not been set up) sees everything.
 */
export function presetsForStore(kind: StoreKind | null): TaskPreset[] {
  if (kind === null) return TASK_PRESETS;
  if (kind === 'office' || kind === 'shipping' || kind === 'real_estate' || kind === 'appointments' || kind === 'personal' || kind === 'other') {
    return TASK_PRESETS.filter((p) => p.source === 'suggested' && p.stores?.includes(kind));
  }
  return TASK_PRESETS.filter((p) => (kind === 'seven_eleven' || p.source === 'suggested') && (!p.stores || p.stores.includes(kind)));
}

/** The inspection score and the inspector-report import are for 7-Eleven stores. A store not set up yet keeps them. */
export function inspectionApplies(kind: StoreKind | null): boolean {
  return kind === null || kind === 'seven_eleven';
}

export function getPreset(id: string): TaskPreset | undefined {
  return TASK_PRESETS.find((p) => p.id === id);
}

export function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/['\u2019`]/g, "'").replace(/\s+/g, ' ');
}

/** True when this starter task is already saved on the store (same title or same 7Clean standard). */
export function presetIsOnStore(
  preset: Pick<TaskPreset, 'template'>,
  templates: Array<{ title: string; standardId?: string | null }>,
): boolean {
  const titles = new Set(templates.map((t) => normalizeTaskTitle(t.title)));
  if (titles.has(normalizeTaskTitle(preset.template.title))) return true;
  const standardId = preset.template.standardId;
  return Boolean(standardId && templates.some((t) => t.standardId === standardId));
}

const DAILY_REPORT_IDS = new Set(['own-daily-close', 'own-deposit', 'own-competitor-prices', 'own-invoice-photo']);

/** Setup screen grouping: reports vs shift reminders vs photo proofs vs weekly. */
export function bucketFor(preset: TaskPreset): TaskBucket {
  if (DAILY_REPORT_IDS.has(preset.id)) return 'daily_reports';
  const t = preset.template;
  if (t.frequency === 'monthly' || t.frequency === 'interval') return 'weekly_monthly';
  if (t.frequency === 'weekly' && t.daysOfWeek.length === 1) return 'weekly_monthly';
  if (preset.source === 'report' && t.evidence === 'photo') return 'photo_proofs';
  return 'shift_checks';
}
