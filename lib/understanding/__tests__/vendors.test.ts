import { matchOrderVendor, matchVendorName, SUGGESTED_VENDORS } from '../vendors';

const catalog = SUGGESTED_VENDORS;

describe('matchOrderVendor', () => {
  it('matches HLA by name for a cigarette order', () => {
    const hit = matchOrderVendor(
      { vendorHint: 'HLA', items: [{ description: 'Marlboro Red King' }, { description: 'Newport' }] },
      catalog
    );
    expect(hit).toEqual({ matched: { name: 'HLA', category: 'cigarettes' }, how: 'name' });
  });

  it('matches ABC from drink products when the sheet does not name a vendor', () => {
    const hit = matchOrderVendor(
      { vendorHint: null, items: [{ description: 'Pepsi 12oz' }, { description: 'Gatorade' }] },
      catalog
    );
    expect(hit).toEqual({ matched: { name: 'ABC', category: 'drinks' }, how: 'category' });
  });

  it('matches RPS for auto products', () => {
    const hit = matchOrderVendor(
      { vendorHint: null, items: [{ description: 'motor oil' }, { description: 'wiper fluid' }] },
      catalog
    );
    expect(hit).toEqual({ matched: { name: 'RPS', category: 'auto' }, how: 'category' });
  });

  it('does not guess when two vendors could fit', () => {
    const twoCig = [
      { name: 'HLA', category: 'cigarettes' as const },
      { name: 'Core-Mark', category: 'cigarettes' as const },
    ];
    expect(matchOrderVendor({ items: [{ description: 'Marlboro' }] }, twoCig).matched).toBeNull();
  });

  it('returns nothing when the store has no vendors yet', () => {
    expect(matchOrderVendor({ vendorHint: 'HLA', items: [{ description: 'Marlboro' }] }, []).matched).toBeNull();
  });
});

describe('matchVendorName', () => {
  it('matches a unique start, like FIX vendor hl', () => {
    expect(matchVendorName('hl', catalog)?.name).toBe('HLA');
  });

  it('refuses an empty name', () => {
    expect(matchVendorName('  ', catalog)).toBeNull();
  });
});
