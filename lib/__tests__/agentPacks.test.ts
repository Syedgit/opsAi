import { STORE_TYPES } from '../tasks/storeSetup';
import { catalogForPack, packForStoreType, PACK_BOOKS_TOOL_IDS, PACK_LABEL } from '../agents/packs';
import { agentsBoardPayload, resolveAgentPack, withAgentPack } from '../agents/crew';
import { toolsForSupervisor } from '../agents/tools/catalog';

describe('vertical agent packs', () => {
  it('maps every store type to a pack', () => {
    const expected: Record<(typeof STORE_TYPES)[number], string> = {
      seven_eleven: 'c_store_gas',
      convenience: 'c_store_gas',
      gas_station: 'c_store_gas',
      appointments: 'appointments',
      office: 'desk',
      shipping: 'desk',
      real_estate: 'real_estate',
      personal: 'personal',
      other: 'generic',
    };
    for (const type of STORE_TYPES) {
      expect(packForStoreType(type)).toBe(expected[type]);
      expect(PACK_LABEL[packForStoreType(type)]).toBeTruthy();
      expect(catalogForPack(packForStoreType(type)).map((c) => c.id)).toEqual([
        'close',
        'finance',
        'followup',
        'staff',
        'books',
      ]);
    }
  });

  it('uses setup storeType over a stale profile pack', () => {
    const profile = withAgentPack({}, 'c_store_gas');
    expect(resolveAgentPack(profile, 'real_estate')).toBe('real_estate');
    expect(resolveAgentPack(profile, null)).toBe('c_store_gas');
  });

  it('limits Books tools for desk / real estate vs c-store', () => {
    const shop = toolsForSupervisor({ booksEnrolled: true, pack: 'c_store_gas' }).map((t) => t.id);
    const desk = toolsForSupervisor({ booksEnrolled: true, pack: 'desk' }).map((t) => t.id);
    expect(shop).toEqual(expect.arrayContaining(['standing_report', 'open_invoices', 'missing_closes']));
    expect(desk).toContain('help_capabilities');
    expect(desk).not.toContain('standing_report');
    expect(PACK_BOOKS_TOOL_IDS.real_estate).toEqual([
      'staff_schedule',
      'ops_today',
      'help_capabilities',
    ]);
    expect(desk).toContain('staff_schedule');
    expect(desk).toContain('ops_today');
    expect(shop).toContain('staff_schedule');
    expect(shop).toContain('ops_today');
  });

  it('board payload shows pack-specific Close job for appointments', () => {
    const board = agentsBoardPayload({}, 'appointments');
    expect(board.pack).toBe('appointments');
    expect(board.packLabel).toMatch(/Appointments/i);
    expect(board.catalog.find((c) => c.id === 'close')?.job).toMatch(/day sheet|till/i);
    expect(board.catalog.find((c) => c.id === 'staff')?.job).toMatch(/rooms|confirm/i);
  });
});
