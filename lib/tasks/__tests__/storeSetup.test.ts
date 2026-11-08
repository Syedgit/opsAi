import { TASK_PRESETS, getPreset, inspectionApplies, presetIsOnStore, presetsForStore } from '../presets';
import { STORE_TYPES, StoreSetupSchema, defaultSetup, readStoredSetup, storeTypeOptions, suggestTasks, type StoreSetup } from '../storeSetup';
import { parseHHMM } from '../time';

const minutes = (v: string) => parseHHMM(v) as number;
const pick = (setup: StoreSetup, id: string) => {
  const found = suggestTasks(setup).find((s) => s.presetId === id);
  if (!found) throw new Error(`no suggestion ${id}`);
  return found;
};

const open24 = (): StoreSetup => defaultSetup('seven_eleven');
const daytime = (over: Partial<StoreSetup> = {}): StoreSetup =>
  StoreSetupSchema.parse({ ...defaultSetup('convenience'), opensAt: '08:00', closesAt: '20:00', shifts: [{ name: 'Open', start: '08:00' }, { name: 'Close', start: '14:00' }], ...over });

describe('store setup form', () => {
  it('starts every kind of store from a valid setup', () => {
    for (const type of STORE_TYPES) expect(StoreSetupSchema.safeParse(defaultSetup(type)).success).toBe(true);
  });

  it('describes 7-Eleven, gas, convenience, office, shipping, real estate, and other businesses for the setup form', () => {
    const ids = storeTypeOptions().map((t) => t.id);
    expect(ids).toEqual(['seven_eleven', 'convenience', 'gas_station', 'office', 'shipping', 'real_estate', 'appointments', 'personal', 'other']);
    expect(storeTypeOptions().every((t) => t.blurb.length > 20)).toBe(true);
    expect(storeTypeOptions().map((t) => t.family)).toEqual(['shop', 'shop', 'shop', 'desk', 'desk', 'desk', 'appointments', 'solo', 'other']);
  });

  it('starts a 7-Eleven open 24 hours with three shifts, and a gas station with fuel on', () => {
    expect(defaultSetup('seven_eleven')).toMatchObject({ open24h: true, fuel: false });
    expect(defaultSetup('seven_eleven').shifts.map((s) => s.name)).toEqual(['Morning', 'Evening', 'Night']);
    expect(defaultSetup('gas_station').fuel).toBe(true);
  });

  it('starts an office on weekday hours with no fuel', () => {
    expect(defaultSetup('office')).toMatchObject({ open24h: false, opensAt: '09:00', closesAt: '18:00', fuel: false });
    expect(defaultSetup('shipping').opensAt).toBe('08:00');
  });

  it('tidies times and orders the shifts', () => {
    const parsed = StoreSetupSchema.parse({ ...open24(), shifts: [{ name: ' Night ', start: '22:00' }, { name: 'Morning', start: '6:00' }] });
    expect(parsed.shifts).toEqual([{ name: 'Morning', start: '06:00' }, { name: 'Night', start: '22:00' }]);
  });

  it('forgets opening hours for a store that is open 24 hours', () => {
    const parsed = StoreSetupSchema.parse({ ...open24(), opensAt: '08:00', closesAt: '20:00' });
    expect(parsed.opensAt).toBeNull();
    expect(parsed.closesAt).toBeNull();
  });

  const bad = (over: Record<string, unknown>) => StoreSetupSchema.safeParse({ ...defaultSetup('convenience'), ...over });
  const messageOf = (r: ReturnType<typeof bad>) => (r.success ? '' : r.error.issues.map((i) => i.message).join('; '));

  it('rejects mistakes in plain words', () => {
    expect(messageOf(bad({ shifts: [] }))).toMatch(/at least one shift/);
    expect(messageOf(bad({ shifts: [{ name: 'A', start: '06:00' }, { name: 'B', start: '06:00' }] }))).toMatch(/same time/);
    expect(messageOf(bad({ shifts: [{ name: '', start: '06:00' }] }))).toMatch(/name each shift/);
    expect(messageOf(bad({ shifts: [{ name: 'A', start: 'soon' }] }))).toMatch(/time like/);
    expect(messageOf(bad({ opensAt: null, closesAt: null }))).toMatch(/opens and closes/);
    expect(messageOf(bad({ opensAt: '22:00', closesAt: '06:00', shifts: [{ name: 'A', start: '22:30' }] }))).toMatch(/open 24 hours/);
    expect(messageOf(bad({ shifts: [{ name: 'Night', start: '23:00' }] }))).toMatch(/Night shift starts when the store is closed/);
    expect(bad({ shifts: Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, start: `0${i + 5}:00` })) }).success).toBe(false);
    expect(bad({ storeType: 'bank' }).success).toBe(false);
  });

  it('reads a saved setup, and treats a damaged one as not set up', () => {
    expect(readStoredSetup(defaultSetup('gas_station'))?.storeType).toBe('gas_station');
    expect(readStoredSetup(null)).toBeNull();
    expect(readStoredSetup({ storeType: 'seven_eleven' })).toBeNull();
    expect(readStoredSetup('junk')).toBeNull();
  });
});

describe('placing the starter tasks around the shifts', () => {
  it('puts a morning routine in the first shift and an evening routine in the second', () => {
    const setup = StoreSetupSchema.parse({ ...open24(), shifts: [{ name: 'Early', start: '05:00' }, { name: 'Late', start: '13:00' }, { name: 'Night', start: '21:00' }] });
    const hands = pick(setup, 'fs14-handwashing').template; // 11:30 on a 6am morning: 5.5 hours in
    expect(hands.startTime).toBe('10:30');
    expect(hands.shift).toBe('Early');
    const restock = pick(setup, 'own-restock').template; // 3pm on a 2pm second shift: 1 hour in
    expect(restock.startTime).toBe('14:00');
    expect(restock.shift).toBe('Late');
  });

  it('puts night routines in the last shift, past midnight when the shift runs that long', () => {
    const toilets = pick(open24(), 'ic-restrooms').template;
    expect(toilets.startTime).toBe('01:00');
    expect(toilets.shift).toBe('Night');
    expect(pick(open24(), 'v2-vault-racks').template.startTime).toBe('22:00');
  });

  it('keeps the time of a shift-less routine for a store open all day', () => {
    expect(pick(open24(), 'boh3-work-orders').template.startTime).toBe('10:15');
    expect(pick(open24(), 'fs5-cold-holding').template).toMatchObject({ startTime: '07:00', endTime: '23:00', repeatEveryMinutes: 240 });
  });

  it('uses the one shift for everything when a store has only one', () => {
    const one = StoreSetupSchema.parse({ ...defaultSetup('convenience'), shifts: [{ name: 'All day', start: '06:00' }] });
    expect(pick(one, 'own-restock').template.shift).toBe('All day');
    expect(pick(one, 'ic-floors').template.shift).toBe('All day');
  });

  it('keeps every task inside opening hours, and repeating tasks on one day', () => {
    const sevenDay = StoreSetupSchema.parse({ ...open24(), open24h: false, opensAt: '08:00', closesAt: '20:00', shifts: [{ name: 'Open', start: '08:00' }, { name: 'Close', start: '14:00' }], fuel: true });
    for (const setup of [open24(), sevenDay, daytime(), daytime({ opensAt: '10:00', closesAt: '16:00', shifts: [{ name: 'Day', start: '10:00' }] })]) {
      for (const s of suggestTasks(setup)) {
        const start = minutes(s.template.startTime);
        if (!setup.open24h) {
          expect(start).toBeGreaterThanOrEqual(minutes(setup.opensAt as string) + 30);
          expect(start).toBeLessThanOrEqual(minutes(setup.closesAt as string) - 30);
        }
        if (s.template.endTime) {
          expect(minutes(s.template.endTime)).toBeGreaterThan(start);
          expect(s.template.repeatEveryMinutes).not.toBeNull();
          expect(minutes(s.template.endTime) - start).toBeGreaterThanOrEqual(s.template.repeatEveryMinutes as number);
          if (!setup.open24h) expect(minutes(s.template.endTime)).toBeLessThanOrEqual(minutes(setup.closesAt as string) - 30);
        } else {
          expect(s.template.repeatEveryMinutes).toBeNull();
        }
      }
    }
  });

  it('moves a night routine into the evening for a store that closes at night', () => {
    const toilets = pick({ ...daytime(), storeType: 'seven_eleven' }, 'ic-restrooms').template; // Night -> the last shift (2pm): 3 hours in
    expect(toilets.startTime).toBe('17:00');
    expect(toilets.shift).toBe('Close');
  });

  it('asks once instead of repeating when a short day leaves no room to repeat', () => {
    const short = StoreSetupSchema.parse({ ...open24(), open24h: false, opensAt: '10:00', closesAt: '12:00', shifts: [{ name: 'Day', start: '10:00' }] });
    const milk = pick(short, 'fs6-milk-labels').template;
    expect(milk.endTime).toBeNull();
    expect(milk.repeatEveryMinutes).toBeNull();
  });

  it('keeps how often a task comes round (monthly, every 2 weeks, weekly)', () => {
    expect(pick(open24(), 'boh2-pest-report').template).toMatchObject({ frequency: 'monthly', monthDays: [1] });
    expect(pick(open24(), 'own-utility-bill').template).toMatchObject({ category: 'bills', frequency: 'monthly', monthDays: [1] });
    expect(pick(open24(), 'own-insurance').template).toMatchObject({ category: 'bills', frequency: 'monthly', monthDays: [1] });
    expect(pick(open24(), 'own-cooler-deep-clean').template).toMatchObject({ frequency: 'interval', intervalDays: 14 });
    expect(pick(open24(), 'boh3-work-orders').template.daysOfWeek).toEqual([1]);
  });

  it('gives back a valid task for every starter task and every kind of store', () => {
    for (const type of STORE_TYPES) {
      for (const fuel of [false, true]) {
        const list = suggestTasks({ ...defaultSetup(type), fuel });
        const min = type === 'seven_eleven' ? 20 : type === 'office' || type === 'shipping' || type === 'real_estate' || type === 'appointments' || type === 'personal' || type === 'other' ? 1 : 6;
        expect(list.length).toBeGreaterThan(min);
        for (const s of list) {
          expect(s.title.length).toBeGreaterThan(0);
          expect(s.scheduleText.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('which starter tasks are ticked', () => {
  const ticked = (setup: StoreSetup) => suggestTasks(setup).filter((s) => s.recommended).map((s) => s.presetId);

  it('ticks the heavily weighted standards for a 7-Eleven, not the whole list', () => {
    const ids = ticked(open24());
    expect(ids).toEqual(expect.arrayContaining(['own-daily-close', 'own-deposit', 'fs6-milk-labels', 'af1-sanitizer', 'fs5-cold-holding']));
    expect(ids).not.toContain('own-restock');
    expect(ids).not.toContain('boh3-work-orders'); // not weighted heavily
    const all = TASK_PRESETS.filter((p) => !p.requires).length;
    expect(ids.length).toBeLessThan(all);
  });

  it('adds the fuel standard only for a store with fuel pumps', () => {
    expect(suggestTasks(open24()).map((s) => s.presetId)).not.toContain('ec2-fuel-islands');
    const withFuel = suggestTasks({ ...open24(), fuel: true });
    expect(withFuel.find((s) => s.presetId === 'ec2-fuel-islands')?.recommended).toBe(true);
  });

  it('ticks the everyday routines for a store that is not a 7-Eleven', () => {
    const ids = ticked(defaultSetup('convenience'));
    expect(ids).toEqual(expect.arrayContaining(['own-daily-close', 'own-deposit', 'own-opening', 'own-coffee-station', 'own-restock', 'own-safe-drop']));
    expect(ids).not.toContain('fs6-milk-labels');
    expect(ids).not.toContain('own-competitor-prices');
  });

  it('does not offer the 7Clean inspection standards to a store that is not a 7-Eleven', () => {
    for (const type of ['convenience', 'gas_station', 'office', 'shipping', 'real_estate', 'appointments', 'personal', 'other'] as const) {
      const list = suggestTasks({ ...defaultSetup(type), fuel: true });
      expect(list.filter((s) => s.source === 'report')).toEqual([]);
      expect(list.some((s) => s.template.standardId)).toBe(false);
    }
  });

  it('gives a gas station simple pump and forecourt tasks, only when it has pumps', () => {
    const withPumps = suggestTasks(defaultSetup('gas_station')).filter((s) => s.recommended).map((s) => s.presetId);
    expect(withPumps).toEqual(expect.arrayContaining(['own-daily-close', 'own-deposit', 'own-competitor-prices', 'own-fuel-islands', 'own-pump-check', 'own-spill-kit', 'own-coffee-station', 'own-restroom-check']));
    const noPumps = suggestTasks({ ...defaultSetup('gas_station'), fuel: false }).map((s) => s.presetId);
    expect(noPumps).not.toEqual(expect.arrayContaining(['own-fuel-islands']));
    expect(noPumps).toContain('own-restroom-check');
  });

  it('keeps the simple list to reports and everyday routines, no inspection tasks', () => {
    const list = suggestTasks(defaultSetup('convenience'));
    const tickedIds = list.filter((s) => s.recommended).map((s) => s.presetId).sort();
    expect(tickedIds).toEqual([
      'ic-floors', 'own-coffee-station', 'own-daily-close', 'own-deposit', 'own-fire-safety', 'own-opening',
      'own-restock', 'own-restroom-check', 'own-safe-drop', 'own-trash',
    ].sort());
    expect(list.map((s) => s.presetId)).toEqual(expect.arrayContaining(['own-lottery', 'own-invoice-photo', 'own-cooler-temp']));
    expect(list.find((s) => s.presetId === 'own-lottery')?.recommended).toBe(false);
    expect(list.every((s) => s.source === 'suggested')).toBe(true);
    expect(list.some((s) => s.bucket === 'daily_reports')).toBe(true);
  });

  it('gives an office, shipping counter, and real-estate team a short day-one list, not a till close', () => {
    expect(ticked(defaultSetup('office')).sort()).toEqual(['own-coverage', 'own-insurance', 'own-lock-up', 'own-meetings', 'own-utility-bill']);
    expect(ticked(defaultSetup('office'))).not.toContain('own-daily-close');
    expect(suggestTasks(defaultSetup('office')).map((s) => s.presetId)).toEqual(expect.arrayContaining(['own-open-desk', 'own-mail']));
    expect(suggestTasks(defaultSetup('office')).map((s) => s.presetId)).not.toContain('own-coffee-station');
    expect(ticked(defaultSetup('shipping')).sort()).toEqual(['own-cutoff', 'own-insurance', 'own-packages', 'own-utility-bill', 'own-who-on']);
    expect(ticked(defaultSetup('real_estate')).sort()).toEqual(['own-insurance', 'own-keys', 'own-lock-up', 'own-showings', 'own-utility-bill']);
  });

  it('gives a salon or clinic the book, rooms, and a till close', () => {
    const ids = ticked(defaultSetup('appointments'));
    expect(ids.sort()).toEqual(['own-appointments-today', 'own-confirm-tomorrow', 'own-daily-close', 'own-insurance', 'own-rooms-ready', 'own-utility-bill']);
    expect(ids).not.toContain('own-coffee-station');
    expect(suggestTasks(defaultSetup('appointments')).map((s) => s.presetId)).toEqual(expect.arrayContaining(['own-open-desk', 'own-lock-up']));
  });

  it('gives personal/solo use a daily plan, not a shop close', () => {
    const ids = ticked(defaultSetup('personal'));
    expect(ids.sort()).toEqual(['own-follow-ups', 'own-insurance', 'own-today-plan', 'own-utility-bill', 'own-wrap-up']);
    expect(ids).not.toContain('own-daily-close');
  });

  it('gives an unknown other business open, lock-up, and monthly bills, not a c-store pack', () => {
    const ids = ticked(defaultSetup('other'));
    expect(ids.sort()).toEqual(['own-insurance', 'own-lock-up', 'own-open-desk', 'own-utility-bill']);
    const offered = suggestTasks(defaultSetup('other')).map((s) => s.presetId);
    expect(offered).toEqual(expect.arrayContaining(['own-today-plan', 'own-wrap-up', 'own-utility-bill', 'own-insurance']));
    expect(offered).not.toContain('own-daily-close');
    expect(offered).not.toContain('own-restock');
    expect(offered).not.toContain('own-coffee-station');
    expect(offered).not.toContain('own-lottery');
  });

  it('offers monthly utility and insurance reminders to every kind of store', () => {
    for (const type of STORE_TYPES) {
      const list = suggestTasks(defaultSetup(type));
      expect(list.map((s) => s.presetId)).toEqual(expect.arrayContaining(['own-utility-bill', 'own-insurance']));
      const bills = list.filter((s) => s.presetId === 'own-utility-bill' || s.presetId === 'own-insurance');
      expect(bills.every((s) => s.bucket === 'weekly_monthly')).toBe(true);
      const shop = type === 'seven_eleven' || type === 'convenience' || type === 'gas_station';
      expect(bills.every((s) => s.recommended === !shop)).toBe(true);
    }
  });

  it('lets a salon or other business add cooler and shelves without inheriting the c-store pack', () => {
    const salon = suggestTasks(
      StoreSetupSchema.parse({ ...defaultSetup('appointments'), features: ['till', 'restroom', 'cooler', 'shelves'] })
    ).map((s) => s.presetId);
    expect(salon).toEqual(expect.arrayContaining(['own-restock', 'own-cooler-temp', 'own-restroom-check', 'own-daily-close']));
    expect(salon).not.toContain('own-coffee-station');
    const ups = suggestTasks(defaultSetup('shipping')).map((s) => s.presetId);
    expect(ups).toEqual(expect.arrayContaining(['own-who-on', 'own-packages', 'own-cutoff', 'own-utility-bill']));
    expect(ups).not.toContain('own-restock');
    expect(ups).not.toContain('own-daily-close');
    const upsWithFloor = suggestTasks(
      StoreSetupSchema.parse({ ...defaultSetup('shipping'), features: ['shelves', 'cooler'] })
    ).map((s) => s.presetId);
    expect(upsWithFloor).toEqual(expect.arrayContaining(['own-restock', 'own-cooler-temp']));
  });

  it('does not give a 7-Eleven the simple routines written for other stores (it has the inspection list)', () => {
    const ids = suggestTasks({ ...open24(), fuel: true }).map((s) => s.presetId);
    expect(ids).not.toContain('own-restroom-check');
    expect(ids).not.toContain('own-fuel-islands');
    expect(ids).toContain('ec2-fuel-islands');
  });
});

describe('setup buckets', () => {
  it('puts close and deposit in daily reports, milk labels in photo proofs, fire safety in weekly', () => {
    const list = suggestTasks(defaultSetup('gas_station'));
    expect(list.find((s) => s.presetId === 'own-daily-close')?.bucket).toBe('daily_reports');
    expect(list.find((s) => s.presetId === 'own-competitor-prices')?.bucket).toBe('daily_reports');
    expect(list.find((s) => s.presetId === 'own-fire-safety')?.bucket).toBe('weekly_monthly');
    expect(suggestTasks(open24()).find((s) => s.presetId === 'fs6-milk-labels')?.bucket).toBe('photo_proofs');
  });
});

describe('which kinds of store get the inspection', () => {
  it('shows the 7Clean standards and the inspection to a 7-Eleven, or to a store not set up yet', () => {
    expect(inspectionApplies('seven_eleven')).toBe(true);
    expect(inspectionApplies(null)).toBe(true);
    expect(presetsForStore(null)).toBe(TASK_PRESETS);
    expect(presetsForStore('seven_eleven').some((p) => p.source === 'report')).toBe(true);
  });

  it('keeps it away from every other kind of store', () => {
    for (const type of ['convenience', 'gas_station', 'office', 'shipping', 'real_estate', 'appointments', 'personal', 'other'] as const) {
      expect(inspectionApplies(type)).toBe(false);
      expect(presetsForStore(type).every((p) => p.source === 'suggested')).toBe(true);
    }
  });
});

describe('starter tasks already on a store', () => {
  it('matches a saved daily close even if the apostrophe differs', () => {
    const close = getPreset('own-daily-close');
    expect(close).toBeDefined();
    expect(presetIsOnStore(close!, [{ title: 'Send the daily close report', standardId: null }])).toBe(true);
    expect(presetIsOnStore(close!, [{ title: 'Photo of today’s vendor invoices', standardId: null }])).toBe(false);
  });

  it('matches a 7Clean standard by id even if the title was edited', () => {
    const milk = getPreset('fs6-milk-labels');
    expect(milk).toBeDefined();
    expect(presetIsOnStore(milk!, [{ title: 'Milk labels (our wording)', standardId: 'FS6' }])).toBe(true);
  });
});
