import type { PrismaClient } from '@prisma/client';
import { buildDefaultProfile } from '../profile';
import { applyStoredProfile, clearDepositRule, parseStoredProfile, saveDepositRule, savePictureTemplate, deletePictureTemplate } from '../profileStore';
import { loadStoreProfiles } from '../storeProfiles';

const rule = { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 };

function prismaWith(profileJson: unknown, exists = true) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    storeConfig: {
      findUnique: jest.fn().mockResolvedValue(exists ? { profileJson } : null),
      update,
    },
  } as unknown as PrismaClient;
  return { prisma, update };
}

describe('parseStoredProfile', () => {
  it('treats nothing as an empty profile', () => {
    expect(parseStoredProfile(null)).toEqual({
      aliases: [],
      depositRule: null,
      labelAliases: {},
      vendorAliases: {},
      messageSamples: {},
      pictureTemplates: [],
      vendors: [],
    });
  });

  it('keeps what was taught and fills the rest with defaults', () => {
    const parsed = parseStoredProfile({ depositRule: rule, vendorAliases: { lays: 'Empire Snacks LLC' } });
    expect(parsed.depositRule).toEqual(rule);
    expect(parsed.vendorAliases).toEqual({ lays: 'Empire Snacks LLC' });
    expect(parsed.aliases).toEqual([]);
  });

  it('ignores corrupt data instead of breaking message handling', () => {
    expect(parseStoredProfile({ depositRule: 'yes please' }).depositRule).toBeNull();
    expect(parseStoredProfile('garbage').depositRule).toBeNull();
  });
});

describe('applyStoredProfile', () => {
  it('overlays the owner settings on the defaults', () => {
    const base = buildDefaultProfile({ storeId: 'S001', storeName: 'Rockaway' });
    const profile = applyStoredProfile(base, { depositRule: rule, labelAliases: { 'store credit': 'card_sales' } });
    expect(profile.storeName).toBe('Rockaway');
    expect(profile.depositRule).toEqual(rule);
    expect(profile.labelAliases['store credit']).toBe('card_sales');
    expect(profile.labelAliases['cash acceptor cash']).toBe('cash_sales');
  });

  it('keeps the usual gas-station labels when the owner has not taught any', () => {
    const base = buildDefaultProfile({ storeId: 'S001', storeName: 'Rockaway' });
    const profile = applyStoredProfile(base, null);
    expect(profile.labelAliases['store credit']).toBe('card_sales');
    expect(profile.labelAliases['store cash']).toBe('cash_sales');
    expect(profile.labelAliases['cash acceptor cash']).toBe('cash_sales');
  });

  it('keeps owner picture maps on the store', () => {
    const base = buildDefaultProfile({ storeId: 'S002', storeName: 'Denville' });
    const map = {
      id: 'pic_exxon',
      kind: 'daily_close' as const,
      title: 'Exxon Store Close (fuel page)',
      fields: [{ label: 'Total Fuel Sales', purpose: 'fuel' as const }],
    };
    const profile = applyStoredProfile(base, { pictureTemplates: [map] });
    expect(profile.pictureTemplates).toEqual([map]);
  });
});

describe('saveDepositRule / clearDepositRule', () => {
  it('saves the rule and keeps other settings', async () => {
    const { prisma, update } = prismaWith({ vendorAliases: { lays: 'Empire Snacks LLC' } });
    await saveDepositRule(prisma, 'S001', rule);
    const data = update.mock.calls[0][0].data.profileJson;
    expect(data.depositRule).toEqual(rule);
    expect(data.vendorAliases).toEqual({ lays: 'Empire Snacks LLC' });
  });

  it('clears only the rule', async () => {
    const { prisma, update } = prismaWith({ depositRule: rule, aliases: ['Rock Mart'] });
    await clearDepositRule(prisma, 'S001');
    const data = update.mock.calls[0][0].data.profileJson;
    expect(data.depositRule).toBeNull();
    expect(data.aliases).toEqual(['Rock Mart']);
  });

  it('does nothing for a store that does not exist', async () => {
    const { prisma, update } = prismaWith(null, false);
    await saveDepositRule(prisma, 'S404', rule);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a malformed rule', async () => {
    const { prisma } = prismaWith(null);
    await expect(saveDepositRule(prisma, 'S001', { ...rule, floatLeftInRegister: -5 })).rejects.toThrow();
  });
});

describe('savePictureTemplate / deletePictureTemplate', () => {
  it('saves a map and keeps other settings', async () => {
    const { prisma, update } = prismaWith({ vendors: [{ name: 'HLA', category: 'cigarettes' }] });
    const saved = await savePictureTemplate(prisma, 'S002', {
      kind: 'daily_close',
      title: 'Exxon tender page',
      note: 'Cash is the acceptor line.',
      fields: [{ label: 'Cash Acceptor Cash', purpose: 'cash' }, { label: 'Credit CRIND', purpose: 'ignore' }],
    });
    expect(saved.id).toMatch(/^pic_/);
    const data = update.mock.calls[0][0].data.profileJson;
    expect(data.pictureTemplates).toEqual([saved]);
    expect(data.vendors).toEqual([{ name: 'HLA', category: 'cigarettes' }]);
  });

  it('refuses a map with no lines', async () => {
    const { prisma, update } = prismaWith(null);
    await expect(savePictureTemplate(prisma, 'S002', { kind: 'daily_close', title: 'Empty', fields: [] })).rejects.toThrow(/at least one line/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('removes a map by id', async () => {
    const existing = {
      id: 'pic_old',
      kind: 'daily_close',
      title: 'Old map',
      fields: [{ label: 'Total Fuel Sales', purpose: 'fuel' }],
    };
    const { prisma, update } = prismaWith({ pictureTemplates: [existing] });
    await deletePictureTemplate(prisma, 'S002', 'pic_old');
    expect(update.mock.calls[0][0].data.profileJson.pictureTemplates).toEqual([]);
  });
});

describe('loadStoreProfiles with saved settings', () => {
  const stores = [{ storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', profileJson: { depositRule: rule } }];

  it('applies the saved deposit rule', async () => {
    const prisma = {
      userStore: { findMany: jest.fn().mockResolvedValue([]) },
      storeConfig: { findMany: jest.fn().mockResolvedValue(stores) },
    } as unknown as PrismaClient;
    const [profile] = await loadStoreProfiles(prisma, 'S001');
    expect(profile.depositRule).toEqual(rule);
  });

  it('keeps working with defaults when the profile_json column has not been added yet', async () => {
    const findMany = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('column does not exist'), { code: 'P2022' }))
      .mockResolvedValueOnce([{ storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York' }]);
    const prisma = {
      userStore: { findMany: jest.fn().mockResolvedValue([]) },
      storeConfig: { findMany: findMany },
    } as unknown as PrismaClient;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [profile] = await loadStoreProfiles(prisma, 'S001');
    warn.mockRestore();
    expect(profile.storeName).toBe('Rockaway');
    expect(profile.depositRule).toBeNull();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('does not hide other database errors', async () => {
    const prisma = {
      userStore: { findMany: jest.fn().mockResolvedValue([]) },
      storeConfig: { findMany: jest.fn().mockRejectedValue(new Error('connection lost')) },
    } as unknown as PrismaClient;
    await expect(loadStoreProfiles(prisma, 'S001')).rejects.toThrow('connection lost');
  });
});
