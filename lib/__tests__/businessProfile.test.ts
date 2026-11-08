import { dashboardModules, isDeskBusiness } from '../businessProfile';

describe('dashboard by business type', () => {
  it('hides cash-register tabs for an office, shipping counter, or real-estate team', () => {
    expect(isDeskBusiness('office')).toBe(true);
    expect(isDeskBusiness('shipping')).toBe(true);
    expect(isDeskBusiness('real_estate')).toBe(true);
    expect(isDeskBusiness('personal')).toBe(true);
    expect(isDeskBusiness('appointments')).toBe(false);
    expect(isDeskBusiness('seven_eleven')).toBe(false);

    expect(dashboardModules('office')).toMatchObject({
      money: false,
      fuel: false,
      orders: false,
      vendors: false,
      schedules: true,
      samples: false,
      fuelOption: false,
    });
    expect(dashboardModules('shipping')).toMatchObject({
      money: false,
      orders: true,
      vendors: false,
      schedules: true,
    });
    expect(dashboardModules('real_estate')).toMatchObject({ money: false, vendors: false, samples: false });
    expect(dashboardModules('personal')).toMatchObject({ money: false, schedules: true, samples: false, vendors: false });
    expect(dashboardModules('appointments')).toMatchObject({ money: true, schedules: true, fuel: false, orders: false, vendors: false, samples: true });
    expect(dashboardModules('other')).toMatchObject({ money: true, schedules: true, fuel: false, orders: false, vendors: false, samples: true, fuelOption: false });
  });

  it('keeps HLA vendors on a shop, not on real estate or a salon', () => {
    expect(dashboardModules('convenience').vendors).toBe(true);
    expect(dashboardModules('seven_eleven').vendors).toBe(true);
    expect(dashboardModules('gas_station').vendors).toBe(true);
    expect(dashboardModules('real_estate').vendors).toBe(false);
    expect(dashboardModules('office').vendors).toBe(false);
    expect(dashboardModules('appointments').vendors).toBe(false);
  });

  it('keeps sales and invoices for a shop or gas station', () => {
    expect(dashboardModules('seven_eleven')).toMatchObject({ money: true, samples: true, inspection: true });
    expect(dashboardModules('gas_station', true).fuel).toBe(true);
    expect(dashboardModules('convenience').orders).toBe(true);
  });
});
