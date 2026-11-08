import type { StoreType } from './tasks/storeSetup';

/**
 * One place that decides what a location gets from the product, by business category:
 * dashboard tabs, onboarding steps (vendors, close samples, fuel), and shop-only services.
 * Starter tasks stay in presetsForStore — they already filter by type.
 *
 * Hours can be scheduled. Pay is never part of this.
 */
export type DashboardModules = {
  money: boolean;
  fuel: boolean;
  orders: boolean;
  /** C-store vendor catalog (HLA / cigarettes). Not a real-estate or office step. */
  vendors: boolean;
  schedules: boolean;
  tasks: boolean;
  inspection: boolean;
  /** Daily close / invoice wording to teach the reader. */
  samples: boolean;
  fuelOption: boolean;
};

const NO_TILL: DashboardModules = {
  money: false,
  fuel: false,
  orders: false,
  vendors: false,
  schedules: true,
  tasks: true,
  inspection: false,
  samples: false,
  fuelOption: false,
};

const SHOP: DashboardModules = {
  money: true,
  fuel: false,
  orders: true,
  vendors: true,
  schedules: true,
  tasks: true,
  inspection: false,
  samples: true,
  fuelOption: true,
};

/** No cash-register dashboard: office, shipping, realty, personal. */
const DESK: StoreType[] = ['office', 'shipping', 'real_estate', 'personal'];

export function isDeskBusiness(storeType: StoreType | null | undefined): boolean {
  return Boolean(storeType && DESK.includes(storeType));
}

/** True when onboarding should ask for HLA-style vendors or a close/invoice sample. */
export function needsShopOnboarding(modules: Pick<DashboardModules, 'vendors' | 'samples'>): boolean {
  return modules.vendors === true || modules.samples === true;
}

export function dashboardModules(storeType: StoreType | null, fuel = false): DashboardModules {
  if (storeType === 'office' || storeType === 'real_estate' || storeType === 'personal') {
    return { ...NO_TILL };
  }
  if (storeType === 'shipping') {
    return { ...NO_TILL, orders: true };
  }
  if (storeType === 'appointments' || storeType === 'other') {
    return {
      money: true,
      fuel: false,
      orders: false,
      vendors: false,
      schedules: true,
      tasks: true,
      inspection: false,
      samples: true,
      fuelOption: false,
    };
  }
  const shop = storeType === 'seven_eleven' || storeType === 'convenience' || storeType === 'gas_station' || storeType === null;
  return {
    ...SHOP,
    money: shop,
    fuel: Boolean(fuel || storeType === 'gas_station'),
    inspection: storeType === 'seven_eleven' || storeType === null,
  };
}
