import type { VercelRequest, VercelResponse } from '@vercel/node';

// Import the same helper function from mock-data
function getStoreMockData(storeId: string, type: string): any[] {
  const storeData: Record<string, Record<string, any[]>> = {
    S001: {
      sales: [
        { id: '1', date: new Date('2026-01-14'), data: { cash: 2100, card: 5400, tax: 320, total_inside: 7820, notes: 'Busy day, high card transactions' }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { cash: 1950, card: 5200, tax: 300, total_inside: 7450, notes: 'Normal operations' }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { cash: 2200, card: 5800, tax: 350, total_inside: 8350, notes: 'Weekend rush' }, confidence: 0.9 },
        { id: '4', date: new Date('2026-01-11'), data: { cash: 1800, card: 4900, tax: 280, total_inside: 6980, notes: 'Quiet day' }, confidence: 0.9 },
        { id: '5', date: new Date('2026-01-10'), data: { cash: 2050, card: 5600, tax: 330, total_inside: 7980, notes: 'Steady sales' }, confidence: 0.9 },
        { id: '6', date: new Date('2026-01-09'), data: { cash: 1920, card: 5100, tax: 295, total_inside: 7315, notes: 'Regular day' }, confidence: 0.9 },
        { id: '7', date: new Date('2026-01-08'), data: { cash: 2150, card: 5900, tax: 340, total_inside: 8390, notes: 'High traffic' }, confidence: 0.9 },
      ],
      invoices: [
        { id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1290, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-001', due_date: '2026-01-28', notes: 'Monthly cigarette order' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { vendor: 'Pepsi', amount: 850, category: 'Beverages', paid: 'N', invoice_number: 'INV-2026-002', due_date: '2026-01-27', notes: 'Beverage restock' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { vendor: 'Coca-Cola', amount: 920, category: 'Beverages', paid: 'Y', invoice_number: 'INV-2026-003', due_date: '2026-01-26', notes: 'Coke products delivery' }, confidence: 0.85 },
        { id: '4', date: new Date('2026-01-11'), data: { vendor: 'Frito-Lay', amount: 650, category: 'Snacks', paid: 'Y', invoice_number: 'INV-2026-004', due_date: '2026-01-25', notes: 'Snack inventory' }, confidence: 0.85 },
        { id: '5', date: new Date('2026-01-10'), data: { vendor: 'HLA', amount: 1450, category: 'Cigarettes', paid: 'N', invoice_number: 'INV-2026-005', due_date: '2026-01-24', notes: 'Additional cigarette order' }, confidence: 0.85 },
        { id: '6', date: new Date('2026-01-09'), data: { vendor: 'Red Bull', amount: 720, category: 'Beverages', paid: 'Y', invoice_number: 'INV-2026-006', due_date: '2026-01-23', notes: 'Energy drinks' }, confidence: 0.85 },
      ],
      expenses: [
        { id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 450, description: 'Electricity bill', paid: 'Y', receipt: 'REC-001' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { category: 'Maintenance', amount: 320, description: 'Equipment repair', paid: 'Y', receipt: 'REC-002' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { category: 'Supplies', amount: 180, description: 'Cleaning supplies', paid: 'Y', receipt: 'REC-003' }, confidence: 0.85 },
        { id: '4', date: new Date('2026-01-11'), data: { category: 'Marketing', amount: 250, description: 'Local advertising', paid: 'N', receipt: 'REC-004' }, confidence: 0.85 },
        { id: '5', date: new Date('2026-01-10'), data: { category: 'Rent', amount: 2500, description: 'Monthly rent', paid: 'Y', receipt: 'REC-005' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: new Date('2026-01-14'), data: { gallons: 3200, fuel_sales: 11000, fuel_gp: 450 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { gallons: 3100, fuel_sales: 10800, fuel_gp: 420 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { gallons: 3400, fuel_sales: 11500, fuel_gp: 480 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: new Date('2026-01-14'), data: { amount: 60, reason: 'Cleaning supplies', employee: 'John' }, confidence: 0.8 },
        { id: '2', date: new Date('2026-01-13'), data: { amount: 45, reason: 'Office supplies', employee: 'Sarah' }, confidence: 0.8 },
        { id: '3', date: new Date('2026-01-12'), data: { amount: 80, reason: 'Refund', employee: 'Mike' }, confidence: 0.8 },
        { id: '4', date: new Date('2026-01-11'), data: { amount: 35, reason: 'Misc', employee: 'John' }, confidence: 0.8 },
      ],
      orders: [
        { id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-001', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 3, unit: 'carton' }, { name: 'Camel Blue', qty: 2, unit: 'carton' }] }, { vendor: 'Pepsi', items: [{ name: 'Pepsi 12oz', qty: 10, unit: 'case' }, { name: 'Mountain Dew', qty: 5, unit: 'case' }] }] }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { order_batch_id: 'order-002', vendor_groups: [{ vendor: 'Coca-Cola', items: [{ name: 'Coke 12oz', qty: 8, unit: 'case' }, { name: 'Sprite', qty: 6, unit: 'case' }] }] }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { order_batch_id: 'order-003', vendor_groups: [{ vendor: 'Frito-Lay', items: [{ name: 'Lays Classic', qty: 15, unit: 'case' }, { name: 'Doritos', qty: 10, unit: 'case' }] }] }, confidence: 0.9 },
      ],
    },
    S002: {
      sales: [
        { id: '1', date: new Date('2026-01-14'), data: { cash: 3200, card: 8200, tax: 480, total_inside: 11880 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { cash: 3100, card: 7900, tax: 460, total_inside: 11460 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { cash: 3400, card: 8500, tax: 510, total_inside: 12410 }, confidence: 0.9 },
        { id: '4', date: new Date('2026-01-11'), data: { cash: 2900, card: 7200, tax: 420, total_inside: 10520 }, confidence: 0.9 },
        { id: '5', date: new Date('2026-01-10'), data: { cash: 3300, card: 8100, tax: 490, total_inside: 11890 }, confidence: 0.9 },
        { id: '6', date: new Date('2026-01-09'), data: { cash: 2800, card: 6800, tax: 400, total_inside: 10000 }, confidence: 0.9 },
      ],
      invoices: [
        { id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1890, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-101', due_date: '2026-01-28', notes: 'Large cigarette order' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { vendor: 'Pepsi', amount: 1250, category: 'Beverages', paid: 'Y', invoice_number: 'INV-2026-102', due_date: '2026-01-27', notes: 'Beverage restock' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { vendor: 'Coca-Cola', amount: 1320, category: 'Beverages', paid: 'N', invoice_number: 'INV-2026-103', due_date: '2026-01-26', notes: 'Coke delivery' }, confidence: 0.85 },
        { id: '4', date: new Date('2026-01-11'), data: { vendor: 'Frito-Lay', amount: 980, category: 'Snacks', paid: 'Y', invoice_number: 'INV-2026-104', due_date: '2026-01-25', notes: 'Snack inventory' }, confidence: 0.85 },
        { id: '5', date: new Date('2026-01-10'), data: { vendor: 'HLA', amount: 2100, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-105', due_date: '2026-01-24', notes: 'Premium cigarettes' }, confidence: 0.85 },
        { id: '6', date: new Date('2026-01-09'), data: { vendor: 'Red Bull', amount: 750, category: 'Beverages', paid: 'N', invoice_number: 'INV-2026-106', due_date: '2026-01-23', notes: 'Energy drinks' }, confidence: 0.85 },
      ],
      expenses: [
        { id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 680, description: 'Electricity bill', paid: 'Y', receipt: 'REC-101' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { category: 'Maintenance', amount: 520, description: 'HVAC repair', paid: 'Y', receipt: 'REC-102' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { category: 'Supplies', amount: 240, description: 'Cleaning supplies', paid: 'Y', receipt: 'REC-103' }, confidence: 0.85 },
        { id: '4', date: new Date('2026-01-11'), data: { category: 'Marketing', amount: 380, description: 'Promotional materials', paid: 'N', receipt: 'REC-104' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: new Date('2026-01-14'), data: { gallons: 4500, fuel_sales: 15200, fuel_gp: 680 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { gallons: 4200, fuel_sales: 14200, fuel_gp: 620 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { gallons: 4800, fuel_sales: 16200, fuel_gp: 720 }, confidence: 0.9 },
        { id: '4', date: new Date('2026-01-11'), data: { gallons: 4100, fuel_sales: 13800, fuel_gp: 590 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: new Date('2026-01-14'), data: { amount: 85, reason: 'Cleaning supplies', employee: 'Maria' }, confidence: 0.8 },
        { id: '2', date: new Date('2026-01-13'), data: { amount: 120, reason: 'Equipment repair', employee: 'Tom' }, confidence: 0.8 },
        { id: '3', date: new Date('2026-01-12'), data: { amount: 55, reason: 'Office supplies', employee: 'Lisa' }, confidence: 0.8 },
        { id: '4', date: new Date('2026-01-11'), data: { amount: 95, reason: 'Refund', employee: 'Maria' }, confidence: 0.8 },
        { id: '5', date: new Date('2026-01-10'), data: { amount: 40, reason: 'Misc', employee: 'Tom' }, confidence: 0.8 },
      ],
      orders: [
        { id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-101', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 5, unit: 'carton' }, { name: 'Newport', qty: 3, unit: 'carton' }] }, { vendor: 'Pepsi', items: [{ name: 'Pepsi 12oz', qty: 15, unit: 'case' }, { name: 'Mountain Dew', qty: 8, unit: 'case' }] }] }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { order_batch_id: 'order-102', vendor_groups: [{ vendor: 'Red Bull', items: [{ name: 'Red Bull 8oz', qty: 12, unit: 'case' }] }] }, confidence: 0.9 },
      ],
    },
    S003: {
      sales: [
        { id: '1', date: new Date('2026-01-14'), data: { cash: 1500, card: 3800, tax: 220, total_inside: 5520 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { cash: 1400, card: 3600, tax: 210, total_inside: 5210 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { cash: 1600, card: 4000, tax: 240, total_inside: 5840 }, confidence: 0.9 },
      ],
      invoices: [
        { id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 890, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-201', due_date: '2026-01-28', notes: 'Small cigarette order' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { vendor: 'Pepsi', amount: 650, category: 'Beverages', paid: 'Y', invoice_number: 'INV-2026-202', due_date: '2026-01-27', notes: 'Beverage restock' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { vendor: 'Frito-Lay', amount: 480, category: 'Snacks', paid: 'N', invoice_number: 'INV-2026-203', due_date: '2026-01-26', notes: 'Snack inventory' }, confidence: 0.85 },
      ],
      expenses: [
        { id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 320, description: 'Electricity bill', paid: 'Y', receipt: 'REC-201' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { category: 'Supplies', amount: 120, description: 'Office supplies', paid: 'Y', receipt: 'REC-202' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: new Date('2026-01-14'), data: { gallons: 2200, fuel_sales: 7500, fuel_gp: 320 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { gallons: 2100, fuel_sales: 7100, fuel_gp: 300 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: new Date('2026-01-14'), data: { amount: 40, reason: 'Cleaning supplies', employee: 'Alex' }, confidence: 0.8 },
        { id: '2', date: new Date('2026-01-13'), data: { amount: 30, reason: 'Office supplies', employee: 'Jordan' }, confidence: 0.8 },
      ],
      orders: [
        { id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-201', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 2, unit: 'carton' }] }] }, confidence: 0.9 },
      ],
    },
    S004: {
      sales: [
        { id: '1', date: new Date('2026-01-14'), data: { cash: 2800, card: 7200, tax: 420, total_inside: 10420 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { cash: 2700, card: 6900, tax: 400, total_inside: 10000 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { cash: 2900, card: 7400, tax: 430, total_inside: 10730 }, confidence: 0.9 },
        { id: '4', date: new Date('2026-01-11'), data: { cash: 2600, card: 6700, tax: 390, total_inside: 9690 }, confidence: 0.9 },
      ],
      invoices: [
        { id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1650, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-301', due_date: '2026-01-28', notes: 'Cigarette order' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { vendor: 'Pepsi', amount: 1100, category: 'Beverages', paid: 'Y', invoice_number: 'INV-2026-302', due_date: '2026-01-27', notes: 'Beverage restock' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { vendor: 'Coca-Cola', amount: 980, category: 'Beverages', paid: 'N', invoice_number: 'INV-2026-303', due_date: '2026-01-26', notes: 'Coke delivery' }, confidence: 0.85 },
        { id: '4', date: new Date('2026-01-11'), data: { vendor: 'Frito-Lay', amount: 820, category: 'Snacks', paid: 'Y', invoice_number: 'INV-2026-304', due_date: '2026-01-25', notes: 'Snack inventory' }, confidence: 0.85 },
      ],
      expenses: [
        { id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 520, description: 'Electricity bill', paid: 'Y', receipt: 'REC-301' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { category: 'Maintenance', amount: 280, description: 'Equipment service', paid: 'Y', receipt: 'REC-302' }, confidence: 0.85 },
        { id: '3', date: new Date('2026-01-12'), data: { category: 'Supplies', amount: 200, description: 'Cleaning supplies', paid: 'Y', receipt: 'REC-303' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: new Date('2026-01-14'), data: { gallons: 3800, fuel_sales: 12800, fuel_gp: 550 }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { gallons: 3600, fuel_sales: 12100, fuel_gp: 520 }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { gallons: 3900, fuel_sales: 13100, fuel_gp: 570 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: new Date('2026-01-14'), data: { amount: 70, reason: 'Cleaning supplies', employee: 'Chris' }, confidence: 0.8 },
        { id: '2', date: new Date('2026-01-13'), data: { amount: 50, reason: 'Office supplies', employee: 'Pat' }, confidence: 0.8 },
        { id: '3', date: new Date('2026-01-12'), data: { amount: 90, reason: 'Refund', employee: 'Chris' }, confidence: 0.8 },
        { id: '4', date: new Date('2026-01-11'), data: { amount: 60, reason: 'Misc', employee: 'Pat' }, confidence: 0.8 },
      ],
      orders: [
        { id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-301', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 4, unit: 'carton' }, { name: 'Camel Blue', qty: 3, unit: 'carton' }] }, { vendor: 'Pepsi', items: [{ name: 'Pepsi 12oz', qty: 12, unit: 'case' }] }] }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { order_batch_id: 'order-302', vendor_groups: [{ vendor: 'Coca-Cola', items: [{ name: 'Coke 12oz', qty: 10, unit: 'case' }] }] }, confidence: 0.9 },
      ],
    },
  };

  return storeData[storeId]?.[type] || storeData.S001?.[type] || [];
}

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const storeId = (req.query.storeId as string) || 'S001';
  const type = (req.query.type as string) || 'sales';
  const id = (req.query.id as string) || '';

  if (!id) {
    res.status(400).json({ error: 'Missing id parameter' });
    return;
  }

  const mockData = getStoreMockData(storeId, type);
  const item = mockData.find((i: any) => i.id === id);

  if (!item) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }

  // Serialize date to ISO string
  const serializedItem = {
    ...item,
    date: item.date instanceof Date ? item.date.toISOString() : item.date,
  };

  res.json({ item: serializedItem });
}
