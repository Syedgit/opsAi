import type { Check } from './checks';
import type { StoreProfile } from './profile';
import type { FuelPriceGrade, FuelPrices, FuelPriceSource } from './schema';

/**
 * Competitor pole photos vs our own price-board photos.
 *
 * The AI reads the numbers. Code decides whose board it is: caption first, then
 * the brand on the sign versus this store's name/aliases. Never treat a pole as a close.
 */

const FUEL_BRANDS = [
  'exxon',
  'mobil',
  'shell',
  'bp',
  'sunoco',
  'citgo',
  'valero',
  'chevron',
  'marathon',
  'speedway',
  'wawa',
  'gulf',
  'lukoil',
  'amoco',
  'arco',
  'phillips',
  'tesoro',
  'circle k',
  'circlek',
  '7-eleven',
  '7 eleven',
  '7eleven',
  'seven eleven',
  'seveneleven',
] as const;

const OWN_CAPTION =
  /\b(our (?:prices?|board|sign|pumps?)|we (?:changed|updated|posted)|(?:prices?|board) (?:updated|changed)|updated (?:the )?prices?)\b/i;
const COMPETITOR_CAPTION =
  /\b(competitor|competition|nearby|down the street|other (?:station|store)|their prices?)\b/i;

const PRICE_WORDS =
  /\b(regular|plus|super|premium|diesel|unleaded|exxon|mobil|shell|\bbp\b|sunoco|citgo|valero|chevron|\$?\d\.\d{2,3})\b/i;

export function isFuelPriceTaskTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (/competitor/.test(t) && /price/.test(t)) || /gas prices?/.test(t) || /price board/.test(t) || /our prices/.test(t);
}

export function looksLikeFuelPriceText(text: string): boolean {
  return PRICE_WORDS.test(text);
}

export function formatFuelPrice(n: number): string {
  return `$${(Math.round(n * 1000) / 1000).toFixed(3)}`;
}

export function gradeKey(product: string): string {
  const p = product.toLowerCase();
  if (/diesel/.test(p)) return 'diesel';
  if (/plus|midgrade|mid-grade|\bmid\b|extra/.test(p)) return 'plus';
  if (/super|premium|supreme/.test(p)) return 'premium';
  if (/regular|unleaded|\breg\b/.test(p)) return 'regular';
  return p.replace(/[^a-z0-9]+/g, '');
}

function brandsIn(text: string): string[] {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
  return FUEL_BRANDS.filter((brand) => {
    if (brand === 'bp') return /(?:^|\s)bp(?:\s|$)/.test(lower);
    const compact = lower.replace(/[\s-]/g, '');
    const brandCompact = brand.replace(/[\s-]/g, '');
    return lower.includes(brand) || compact.includes(brandCompact);
  });
}

function storeBrands(profiles: StoreProfile[]): Set<string> {
  const found = new Set<string>();
  for (const p of profiles) {
    for (const name of [p.storeName, ...p.aliases]) {
      for (const brand of brandsIn(name)) found.add(brand);
    }
  }
  return found;
}

function captionSource(text: string | undefined): FuelPriceSource | null {
  if (!text?.trim()) return null;
  if (COMPETITOR_CAPTION.test(text)) return 'competitor';
  if (OWN_CAPTION.test(text)) return 'own';
  return null;
}

export function resolveFuelSource(
  reading: FuelPrices,
  profiles: StoreProfile[],
  messageText?: string
): { source: FuelPriceSource; reason: string } {
  const fromCaption = captionSource(messageText);
  if (fromCaption) {
    return {
      source: fromCaption,
      reason: fromCaption === 'competitor' ? 'caption names a competitor' : 'caption says this is our board',
    };
  }

  const station = reading.stationHint?.trim() ?? '';
  const ours = storeBrands(profiles);
  const onSign = station ? brandsIn(station) : [];
  const signIsOurs = onSign.some((brand) => ours.has(brand));
  const signIsOther = onSign.some((brand) => !ours.has(brand));

  if (signIsOurs && !signIsOther) {
    return { source: 'own', reason: 'the brand on the sign matches this store' };
  }
  if (signIsOther && !signIsOurs) {
    return { source: 'competitor', reason: 'the brand on the sign is not this store' };
  }

  const hinted = reading.sourceHint;
  if (hinted === 'own' || hinted === 'competitor') {
    return { source: hinted, reason: 'as written on the message' };
  }

  return { source: 'competitor', reason: 'could not tell — treated as a competitor. Reply FIX source own if this is our board.' };
}

export function checkFuelPrices(reading: FuelPrices): Check[] {
  const checks: Check[] = [];
  if (reading.grades.length === 0) {
    checks.push({
      id: 'fuel_prices_empty',
      status: 'fail',
      message: 'No grade prices were readable on that board.',
    });
    return checks;
  }
  for (const grade of reading.grades) {
    if (grade.price < 1 || grade.price > 15) {
      checks.push({
        id: `fuel_price_range_${gradeKey(grade.product)}`,
        status: 'warn',
        message: `${grade.product} at ${formatFuelPrice(grade.price)} looks off for a US pump. Reply FIX ${gradeKey(grade.product)} <price> if that is wrong.`,
        actual: grade.price,
      });
    }
  }
  return checks;
}

export function fuelPriceLines(
  reading: FuelPrices,
  source: FuelPriceSource,
  storeName: string,
  station: string | null,
  checks: Check[]
): string[] {
  const whose = source === 'own' ? 'Our board' : 'Competition';
  const where = station?.trim() || (source === 'own' ? storeName : 'nearby');
  const lines = [`⛽ ${whose} · ${where} · ${storeName}`];
  for (const grade of reading.grades) {
    lines.push(`${grade.product} ${formatFuelPrice(grade.price)}`);
  }
  for (const check of checks) {
    if (check.status === 'pass') continue;
    lines.push(check.status === 'fail' ? `❌ ${check.message}` : `⚠️ ${check.message}`);
  }
  return lines;
}

export function fuelPricesPayload(
  reading: FuelPrices,
  source: FuelPriceSource,
  station: string | null,
  observedDate: string,
  checks: Check[],
  needsReview: string[]
): Record<string, unknown> {
  const grades = reading.grades.map((g) => ({ product: g.product, price: g.price, key: gradeKey(g.product) }));
  const byKey = Object.fromEntries(grades.map((g) => [g.key, g.price]));
  return {
    _kind: 'fuel_prices',
    prices: { ...reading, sourceHint: source, stationHint: station },
    source,
    station: station ?? null,
    observed_date: observedDate,
    grades,
    regular: byKey.regular ?? null,
    plus: byKey.plus ?? null,
    premium: byKey.premium ?? null,
    diesel: byKey.diesel ?? null,
    checks,
    needs_review: needsReview,
  };
}

function setGrade(grades: FuelPriceGrade[], product: string, price: number): FuelPriceGrade[] {
  const key = gradeKey(product);
  const label = product.charAt(0).toUpperCase() + product.slice(1).toLowerCase();
  let found = false;
  const next = grades.map((g) => {
    if (gradeKey(g.product) !== key) return g;
    found = true;
    return { ...g, price };
  });
  return found ? next : [...next, { product: label, price }];
}

export function applyFuelPriceFix(
  reading: FuelPrices,
  source: FuelPriceSource,
  field: string,
  value: string
): { ok: true; reading: FuelPrices; source: FuelPriceSource } | { ok: false; message: string } {
  const key = field.toLowerCase();
  const trimmed = value.trim();

  if (key === 'source' || key === 'whose' || key === 'who') {
    const how = trimmed.toLowerCase();
    if (/^(own|ours|our|us|we)$/.test(how)) return { ok: true, reading, source: 'own' };
    if (/^(competitor|competition|other|nearby)$/.test(how)) return { ok: true, reading, source: 'competitor' };
    return { ok: false, message: 'FIX source own, or FIX source competitor.' };
  }

  if (key === 'station' || key === 'brand') {
    return { ok: true, reading: { ...reading, stationHint: trimmed || null }, source };
  }

  const amount = Number(trimmed.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount)) {
    return { ok: false, message: `"${value}" is not a number. Example: FIX regular 4.099` };
  }
  if (!/^(regular|reg|plus|mid|super|premium|diesel|e85)$/.test(key) && !reading.grades.some((g) => gradeKey(g.product) === gradeKey(key))) {
    return { ok: false, message: 'You can fix: regular, plus, premium, diesel, station, source.' };
  }
  return { ok: true, reading: { ...reading, grades: setGrade(reading.grades, key, amount) }, source };
}
