import { flattenFuelSales, fuelFigures } from '../fuelSalesRows';

describe('fuelFigures', () => {
  it('reads gas from a daily close payload', () => {
    expect(
      fuelFigures({
        _kind: 'daily_close',
        report_date: '2026-11-07',
        fuel_sales: 6086.32,
        gallons: 1455.226,
        report: { fuelSales: 6086.32, fuelGallons: 1455.226, reportDate: '2026-11-07' },
      })
    ).toEqual({
      sales: 6086.32,
      gallons: 1455.226,
      gp: null,
      reportDate: '2026-11-07',
    });
  });

  it('skips an inside-only close', () => {
    expect(fuelFigures({ _kind: 'daily_close', cash: 106, card: 334, fuel_sales: 0 })).toBeNull();
  });
});

describe('flattenFuelSales', () => {
  it('keeps typed fuel rows and closes that have gas', () => {
    const rows = flattenFuelSales([
      {
        actionId: 'close',
        type: 'STORE_SALES',
        createdAt: new Date('2026-11-08T01:00:00Z'),
        payloadJson: { _kind: 'daily_close', report_date: '2026-11-07', fuel_sales: 6086.32, gallons: 1455.226 },
        confidence: 0.9,
      },
      {
        actionId: 'inside',
        type: 'STORE_SALES',
        createdAt: new Date('2026-11-08T01:01:00Z'),
        payloadJson: { _kind: 'daily_close', cash: 100, card: 200, fuel_sales: 0 },
        confidence: 0.9,
      },
      {
        actionId: 'typed',
        type: 'FUEL_SALES',
        createdAt: new Date('2026-11-08T01:02:00Z'),
        payloadJson: { fuel_sales: 1440, gallons: 400, fuel_gp: 0.18 },
        confidence: 0.8,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['close', 'typed']);
    expect(rows[0].data.fuel_sales).toBe(6086.32);
    expect(rows[0].data.report_date).toBe('2026-11-07');
  });
});
