/**
 * Per-store configuration that changes how messages are interpreted.
 *
 * Every owner reports differently, so nothing here is hard-coded per customer.
 * Profiles start from defaults and are refined over time (learn by asking once).
 */

/** How the store's "deposit" figure is built from the day's numbers. */
export interface DepositRule {
  includeCardSales: boolean;
  includeFuelSales: boolean;
  subtractPayouts: boolean;
  /** Cash left in the register overnight; subtracted from the deposit. */
  floatLeftInRegister: number;
}

export interface StoreProfile {
  storeId: string;
  storeName: string;
  /** Other names the owner uses for this store, e.g. "Denville Exxon". */
  aliases: string[];
  timezone: string;
  /** null until confirmed with the owner; checks then try to infer it. */
  depositRule: DepositRule | null;
  /** Owner's labels mapped to a canonical meaning, lower-case keys: "store credit" -> "card_sales". */
  labelAliases: Record<string, CanonicalLabel>;
  /** Owner's short vendor names, lower-case keys: "lays" -> "Empire Snacks LLC". */
  vendorAliases: Record<string, string>;
}

export type CanonicalLabel = 'card_sales' | 'cash_sales' | 'fuel_sales' | 'payout' | 'ignore';

export const DEFAULT_TIMEZONE = 'America/New_York';

export function buildDefaultProfile(input: {
  storeId: string;
  storeName: string;
  timezone?: string | null;
}): StoreProfile {
  return {
    storeId: input.storeId,
    storeName: input.storeName,
    aliases: [],
    timezone: input.timezone?.trim() || DEFAULT_TIMEZONE,
    depositRule: null,
    labelAliases: {},
    vendorAliases: {},
  };
}
