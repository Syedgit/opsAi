import { z } from 'zod';

/**
 * The store's own vendor list, set at signup: HLA for cigarettes, ABC for drinks, RPS for auto.
 * Code matches a read order to one of these so the owner confirms the vendor, not a guess from thin air.
 */

export const VENDOR_CATEGORIES = [
  'cigarettes',
  'drinks',
  'snacks',
  'candy',
  'lottery',
  'auto',
  'ice',
  'bread',
  'dairy',
  'other',
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  cigarettes: 'Cigarettes / tobacco',
  drinks: 'Drinks',
  snacks: 'Snacks',
  candy: 'Candy',
  lottery: 'Lottery',
  auto: 'Auto / automotive',
  ice: 'Ice',
  bread: 'Bread / bakery',
  dairy: 'Dairy',
  other: 'Other',
};

export const StoreVendorSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: z.enum(VENDOR_CATEGORIES),
});
export type StoreVendor = z.infer<typeof StoreVendorSchema>;

export const StoreVendorsSchema = z.array(StoreVendorSchema).max(20);

/** Starter rows shown on signup; not saved until the owner keeps them. */
export const SUGGESTED_VENDORS: StoreVendor[] = [
  { name: 'HLA', category: 'cigarettes' },
  { name: 'ABC', category: 'drinks' },
  { name: 'RPS', category: 'auto' },
];

const CATEGORY_HINTS: Record<VendorCategory, string[]> = {
  cigarettes: ['cig', 'cigarette', 'tobacco', 'marlboro', 'newport', 'camel', 'pall mall', 'kool', 'winston', 'maverick'],
  drinks: ['drink', 'soda', 'pepsi', 'coke', 'coca', 'gatorade', 'water', 'red bull', 'energy', 'juice', 'beverage'],
  snacks: ['chip', 'lays', 'dorito', 'cheeto', 'snack', 'pretzel', 'frito'],
  candy: ['candy', 'chocolate', 'snickers'],
  lottery: ['lottery', 'scratch', 'lotto'],
  auto: ['auto', 'oil', 'wiper', 'air freshener', 'motor'],
  ice: ['ice bag', 'bag of ice', 'ice'],
  bread: ['bread', 'bun', 'bakery'],
  dairy: ['milk', 'cream', 'dairy'],
  other: [],
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function matchVendorName(wanted: string, vendors: StoreVendor[]): StoreVendor | null {
  const q = norm(wanted);
  if (!q || vendors.length === 0) return null;
  const exact = vendors.find((v) => norm(v.name) === q);
  if (exact) return exact;
  const starts = vendors.filter((v) => norm(v.name).startsWith(q) || q.startsWith(norm(v.name)));
  if (starts.length === 1) return starts[0];
  const contains = vendors.filter((v) => norm(v.name).includes(q) || q.includes(norm(v.name)));
  return contains.length === 1 ? contains[0] : null;
}

export function matchOrderVendor(
  order: { vendorHint?: string | null; items: Array<{ description: string }> },
  vendors: StoreVendor[]
): { matched: StoreVendor | null; how: 'name' | 'category' | null } {
  if (vendors.length === 0) return { matched: null, how: null };
  const byName = matchVendorName(order.vendorHint ?? '', vendors);
  if (byName) return { matched: byName, how: 'name' };

  const blob = [order.vendorHint ?? '', ...order.items.map((i) => i.description)].join(' ').toLowerCase();
  const scored = vendors.map((v) => {
    const keys = CATEGORY_HINTS[v.category];
    const hits = keys.filter((k) => blob.includes(k)).length + (blob.includes(v.category) ? 1 : 0);
    return { v, hits };
  });
  const hits = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
  if (hits.length === 1) return { matched: hits[0].v, how: 'category' };
  if (hits.length > 1 && hits[0].hits > hits[1].hits) {
    const topCat = hits[0].v.category;
    const same = vendors.filter((v) => v.category === topCat);
    if (same.length === 1) return { matched: same[0], how: 'category' };
  }
  return { matched: null, how: null };
}

export function describeVendorCatalog(vendors: StoreVendor[]): string {
  if (vendors.length === 0) return '';
  return vendors.map((v) => `${v.name} (${v.category})`).join(', ');
}
