import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '../../api/utils/auth';
import { generateBusinessSummary, BusinessSummary } from '../services/aiSummarization';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns';

const router = Router();
const prisma = new PrismaClient();

/**
 * Get mock data for a store
 */
function getStoreMockData(storeId: string): Record<string, any[]> {
  // Generate mock data for the past 30 days to cover any date range
  const today = new Date();
  const generateDate = (daysAgo: number) => {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date;
  };

  const storeData: Record<string, Record<string, any[]>> = {
    S001: {
      sales: [
        // Today and recent days
        { id: '1', date: generateDate(0), data: { cash: 2100, card: 5400, tax: 320, total_inside: 7820, notes: 'Busy day, high card transactions' }, confidence: 0.9 },
        { id: '2', date: generateDate(1), data: { cash: 1950, card: 5200, tax: 300, total_inside: 7450, notes: 'Normal operations' }, confidence: 0.9 },
        { id: '3', date: generateDate(2), data: { cash: 2200, card: 5800, tax: 350, total_inside: 8350, notes: 'Weekend rush' }, confidence: 0.9 },
        { id: '4', date: generateDate(3), data: { cash: 1800, card: 4900, tax: 280, total_inside: 6980, notes: 'Quiet day' }, confidence: 0.9 },
        { id: '5', date: generateDate(4), data: { cash: 2050, card: 5600, tax: 330, total_inside: 7980, notes: 'Steady sales' }, confidence: 0.9 },
        { id: '6', date: generateDate(5), data: { cash: 1920, card: 5100, tax: 295, total_inside: 7315, notes: 'Regular day' }, confidence: 0.9 },
        { id: '7', date: generateDate(6), data: { cash: 2150, card: 5900, tax: 340, total_inside: 8390, notes: 'High traffic' }, confidence: 0.9 },
        // More days for week/month views
        { id: '8', date: generateDate(7), data: { cash: 2000, card: 5500, tax: 310, total_inside: 7810, notes: 'Steady' }, confidence: 0.9 },
        { id: '9', date: generateDate(8), data: { cash: 1900, card: 5000, tax: 290, total_inside: 7190, notes: 'Regular' }, confidence: 0.9 },
        { id: '10', date: generateDate(9), data: { cash: 2250, card: 6000, tax: 360, total_inside: 8610, notes: 'Busy' }, confidence: 0.9 },
        { id: '11', date: generateDate(10), data: { cash: 1850, card: 4800, tax: 270, total_inside: 6920, notes: 'Normal' }, confidence: 0.9 },
        { id: '12', date: generateDate(11), data: { cash: 2100, card: 5400, tax: 320, total_inside: 7820, notes: 'Good day' }, confidence: 0.9 },
        { id: '13', date: generateDate(12), data: { cash: 1950, card: 5200, tax: 300, total_inside: 7450, notes: 'Steady' }, confidence: 0.9 },
        { id: '14', date: generateDate(13), data: { cash: 2200, card: 5800, tax: 350, total_inside: 8350, notes: 'Weekend' }, confidence: 0.9 },
        { id: '15', date: generateDate(14), data: { cash: 1800, card: 4900, tax: 280, total_inside: 6980, notes: 'Quiet' }, confidence: 0.9 },
        { id: '16', date: generateDate(15), data: { cash: 2050, card: 5600, tax: 330, total_inside: 7980, notes: 'Normal' }, confidence: 0.9 },
        { id: '17', date: generateDate(16), data: { cash: 1920, card: 5100, tax: 295, total_inside: 7315, notes: 'Regular' }, confidence: 0.9 },
        { id: '18', date: generateDate(17), data: { cash: 2150, card: 5900, tax: 340, total_inside: 8390, notes: 'Busy' }, confidence: 0.9 },
        { id: '19', date: generateDate(18), data: { cash: 2000, card: 5500, tax: 310, total_inside: 7810, notes: 'Steady' }, confidence: 0.9 },
        { id: '20', date: generateDate(19), data: { cash: 1900, card: 5000, tax: 290, total_inside: 7190, notes: 'Normal' }, confidence: 0.9 },
        { id: '21', date: generateDate(20), data: { cash: 2250, card: 6000, tax: 360, total_inside: 8610, notes: 'High sales' }, confidence: 0.9 },
        { id: '22', date: generateDate(21), data: { cash: 1850, card: 4800, tax: 270, total_inside: 6920, notes: 'Regular' }, confidence: 0.9 },
        { id: '23', date: generateDate(22), data: { cash: 2100, card: 5400, tax: 320, total_inside: 7820, notes: 'Good' }, confidence: 0.9 },
        { id: '24', date: generateDate(23), data: { cash: 1950, card: 5200, tax: 300, total_inside: 7450, notes: 'Steady' }, confidence: 0.9 },
        { id: '25', date: generateDate(24), data: { cash: 2200, card: 5800, tax: 350, total_inside: 8350, notes: 'Weekend' }, confidence: 0.9 },
        { id: '26', date: generateDate(25), data: { cash: 1800, card: 4900, tax: 280, total_inside: 6980, notes: 'Quiet' }, confidence: 0.9 },
        { id: '27', date: generateDate(26), data: { cash: 2050, card: 5600, tax: 330, total_inside: 7980, notes: 'Normal' }, confidence: 0.9 },
        { id: '28', date: generateDate(27), data: { cash: 1920, card: 5100, tax: 295, total_inside: 7315, notes: 'Regular' }, confidence: 0.9 },
        { id: '29', date: generateDate(28), data: { cash: 2150, card: 5900, tax: 340, total_inside: 8390, notes: 'Busy' }, confidence: 0.9 },
        { id: '30', date: generateDate(29), data: { cash: 2000, card: 5500, tax: 310, total_inside: 7810, notes: 'Steady' }, confidence: 0.9 },
      ],
      expenses: [
        { id: '1', date: generateDate(0), data: { category: 'Utilities', amount: 450, description: 'Electricity bill', paid: 'Y', receipt: 'REC-001' }, confidence: 0.85 },
        { id: '2', date: generateDate(1), data: { category: 'Maintenance', amount: 320, description: 'Equipment repair', paid: 'Y', receipt: 'REC-002' }, confidence: 0.85 },
        { id: '3', date: generateDate(2), data: { category: 'Supplies', amount: 180, description: 'Cleaning supplies', paid: 'Y', receipt: 'REC-003' }, confidence: 0.85 },
        { id: '4', date: generateDate(3), data: { category: 'Marketing', amount: 250, description: 'Local advertising', paid: 'N', receipt: 'REC-004' }, confidence: 0.85 },
        { id: '5', date: generateDate(4), data: { category: 'Rent', amount: 2500, description: 'Monthly rent', paid: 'Y', receipt: 'REC-005' }, confidence: 0.85 },
        { id: '6', date: generateDate(7), data: { category: 'Utilities', amount: 420, description: 'Water bill', paid: 'Y', receipt: 'REC-006' }, confidence: 0.85 },
        { id: '7', date: generateDate(10), data: { category: 'Maintenance', amount: 280, description: 'HVAC service', paid: 'Y', receipt: 'REC-007' }, confidence: 0.85 },
        { id: '8', date: generateDate(14), data: { category: 'Supplies', amount: 150, description: 'Office supplies', paid: 'Y', receipt: 'REC-008' }, confidence: 0.85 },
        { id: '9', date: generateDate(21), data: { category: 'Marketing', amount: 300, description: 'Promotional materials', paid: 'N', receipt: 'REC-009' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: generateDate(0), data: { gallons: 3200, fuel_sales: 11000, fuel_gp: 450 }, confidence: 0.9 },
        { id: '2', date: generateDate(1), data: { gallons: 3100, fuel_sales: 10800, fuel_gp: 420 }, confidence: 0.9 },
        { id: '3', date: generateDate(2), data: { gallons: 3400, fuel_sales: 11500, fuel_gp: 480 }, confidence: 0.9 },
        { id: '4', date: generateDate(3), data: { gallons: 3000, fuel_sales: 10500, fuel_gp: 400 }, confidence: 0.9 },
        { id: '5', date: generateDate(4), data: { gallons: 3300, fuel_sales: 11200, fuel_gp: 460 }, confidence: 0.9 },
        { id: '6', date: generateDate(5), data: { gallons: 3150, fuel_sales: 10900, fuel_gp: 430 }, confidence: 0.9 },
        { id: '7', date: generateDate(6), data: { gallons: 3250, fuel_sales: 11100, fuel_gp: 440 }, confidence: 0.9 },
        { id: '8', date: generateDate(7), data: { gallons: 3050, fuel_sales: 10600, fuel_gp: 410 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: generateDate(0), data: { amount: 60, reason: 'Cleaning supplies', employee: 'John' }, confidence: 0.8 },
        { id: '2', date: generateDate(1), data: { amount: 45, reason: 'Office supplies', employee: 'Sarah' }, confidence: 0.8 },
        { id: '3', date: generateDate(2), data: { amount: 80, reason: 'Refund', employee: 'Mike' }, confidence: 0.8 },
        { id: '4', date: generateDate(5), data: { amount: 50, reason: 'Misc expenses', employee: 'John' }, confidence: 0.8 },
        { id: '5', date: generateDate(8), data: { amount: 35, reason: 'Supplies', employee: 'Sarah' }, confidence: 0.8 },
      ],
    },
  };

  return storeData[storeId] || storeData.S001;
}

/**
 * Generate mock business summary from mock data
 */
function generateMockSummary(
  storeId: string,
  period: 'today' | 'week' | 'month'
): BusinessSummary {
  const date = new Date();
  let start: Date, end: Date, periodLabel: string;

  switch (period) {
    case 'today':
      start = startOfDay(date);
      end = endOfDay(date);
      periodLabel = format(date, 'MMMM dd, yyyy');
      break;
    case 'week':
      start = startOfWeek(date);
      end = endOfWeek(date);
      periodLabel = `Week of ${format(start, 'MMM dd')} - ${format(end, 'MMM dd, yyyy')}`;
      break;
    case 'month':
      start = startOfMonth(date);
      end = endOfMonth(date);
      periodLabel = format(date, 'MMMM yyyy');
      break;
  }

  const mockData = getStoreMockData(storeId);

  // Filter data by period - normalize dates for comparison
  const normalizeDate = (d: Date) => {
    const normalized = new Date(d);
    normalized.setHours(0, 0, 0, 0);
    return normalized.getTime();
  };
  
  const startTime = normalizeDate(start);
  const endTime = normalizeDate(end);

  const sales = mockData.sales.filter((s) => {
    const saleTime = normalizeDate(s.date);
    return saleTime >= startTime && saleTime <= endTime;
  });
  const expenses = mockData.expenses.filter((e) => {
    const expenseTime = normalizeDate(e.date);
    return expenseTime >= startTime && expenseTime <= endTime;
  });
  const fuel = mockData.fuel.filter((f) => {
    const fuelTime = normalizeDate(f.date);
    return fuelTime >= startTime && fuelTime <= endTime;
  });

  // Calculate stats
  const salesData = sales.map((s) => s.data);
  const totalSales = salesData.reduce((sum, s) => sum + (s.total_inside || 0), 0);
  const cashSales = salesData.reduce((sum, s) => sum + (s.cash || 0), 0);
  const cardSales = salesData.reduce((sum, s) => sum + (s.card || 0), 0);

  const expenseData = expenses.map((e) => e.data);
  const totalExpenses = expenseData.reduce((sum, e) => sum + (e.amount || 0), 0);

  const fuelData = fuel.map((f) => f.data);
  const totalFuelSales = fuelData.reduce((sum, f) => sum + (f.fuel_sales || 0), 0);
  const totalGallons = fuelData.reduce((sum, f) => sum + (f.gallons || 0), 0);
  const avgFuelGp = fuelData.length > 0
    ? fuelData.reduce((sum, f) => sum + (f.fuel_gp || 0), 0) / fuelData.length
    : 0;

  // Calculate expense categories
  const categoryMap = new Map<string, number>();
  expenseData.forEach((e) => {
    const cat = e.category || 'Other';
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + (e.amount || 0));
  });
  const topCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Get previous period for comparison
  const prevStart = new Date(start);
  const prevEnd = new Date(end);
  const periodDiff = end.getTime() - start.getTime();
  prevStart.setTime(prevStart.getTime() - periodDiff);
  prevEnd.setTime(prevEnd.getTime() - periodDiff);

  const prevStartTime = normalizeDate(prevStart);
  const prevEndTime = normalizeDate(prevEnd);
  
  const prevSales = mockData.sales.filter((s) => {
    const saleTime = normalizeDate(s.date);
    return saleTime >= prevStartTime && saleTime <= prevEndTime;
  });
  const prevExpenses = mockData.expenses.filter((e) => {
    const expenseTime = normalizeDate(e.date);
    return expenseTime >= prevStartTime && expenseTime <= prevEndTime;
  });

  const prevSalesTotal = prevSales.reduce(
    (sum, s) => sum + (s.data.total_inside || 0),
    0
  );
  const prevExpensesTotal = prevExpenses.reduce(
    (sum, e) => sum + (e.data.amount || 0),
    0
  );

  // Determine trends
  const salesTrend =
    totalSales > prevSalesTotal * 1.05 ? 'up' : totalSales < prevSalesTotal * 0.95 ? 'down' : 'stable';
  const expenseTrend =
    totalExpenses > prevExpensesTotal * 1.05 ? 'up' : totalExpenses < prevExpensesTotal * 0.95 ? 'down' : 'stable';

  // Generate insights and recommendations
  const insights: string[] = [];
  const recommendations: string[] = [];

  if (sales.length > 0) {
    const avgSale = totalSales / sales.length;
    if (avgSale > 100) {
      insights.push(`Average transaction value is $${avgSale.toFixed(2)}, indicating strong customer spending`);
    }
    
    const cardRatio = cardSales / totalSales;
    if (cardRatio > 0.6) {
      insights.push(`Card payments represent ${(cardRatio * 100).toFixed(0)}% of sales, showing modern payment preferences`);
    }
  }

  if (salesTrend === 'up') {
    insights.push('Sales are trending upward compared to the previous period');
    recommendations.push('Maintain current strategies that are driving growth');
  } else if (salesTrend === 'down') {
    insights.push('Sales have decreased compared to the previous period');
    recommendations.push('Review marketing and promotional strategies to boost sales');
  }

  if (topCategories.length > 0) {
    const topCategory = topCategories[0];
    insights.push(`Top expense category is ${topCategory.category} at $${topCategory.amount.toFixed(2)}`);
    recommendations.push(`Review ${topCategory.category} expenses for potential cost optimization`);
  }

  if (expenseTrend === 'up') {
    recommendations.push('Monitor expense increases and identify areas for cost control');
  }

  if (totalFuelSales > 0 && avgFuelGp > 0) {
    insights.push(`Fuel operations show an average GP of $${avgFuelGp.toFixed(2)} per transaction`);
    if (avgFuelGp < 0.15) {
      recommendations.push('Consider reviewing fuel pricing strategy to improve margins');
    }
  }

  if (insights.length === 0) {
    insights.push('Review sales patterns for optimization opportunities');
  }
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring daily performance metrics');
    recommendations.push('Focus on maintaining consistent operations');
  }

  return {
    period: periodLabel,
    sales: {
      total: totalSales,
      cash: cashSales,
      card: cardSales,
      count: sales.length,
      average: sales.length > 0 ? totalSales / sales.length : 0,
    },
    expenses: {
      total: totalExpenses,
      count: expenses.length,
      topCategories,
    },
    fuel: {
      totalSales: totalFuelSales,
      totalGallons: totalGallons,
      averageGp: avgFuelGp,
    },
    insights,
    recommendations,
    trends: {
      salesTrend,
      expenseTrend,
    },
  };
}

/**
 * List stores
 * GET /api/stores?mock=true
 */
router.get('/', async (req: Request, res: Response) => {
  const useMock = req.query.mock === 'true';

  if (useMock) {
    res.json({
      stores: [
        { id: '1', storeId: 'S001', storeName: 'Main Street Store', timezone: 'America/New_York', active: true },
        { id: '2', storeId: 'S002', storeName: 'Highway 101 Store', timezone: 'America/New_York', active: true },
        { id: '3', storeId: 'S003', storeName: 'Downtown Plaza Store', timezone: 'America/Chicago', active: true },
        { id: '4', storeId: 'S004', storeName: 'Riverside Convenience', timezone: 'America/Los_Angeles', active: true },
      ],
    });
    return;
  }

  try {
    const authUser = getAuthUser(req as any);
    if (authUser) {
      const userStores = await prisma.userStore.findMany({
        where: { userId: authUser.userId },
        include: { store: { select: { storeId: true, storeName: true, timezone: true, active: true } } },
      });
      const stores = userStores
        .filter((us: any) => us.store.active)
        .map((us: any) => ({
          storeId: us.store.storeId,
          storeName: us.store.storeName,
          timezone: us.store.timezone,
          active: us.store.active,
          role: us.role,
        }));
      res.json({ stores });
    } else {
      res.json({ stores: [] });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Dashboard stats
 * GET /api/stores/dashboard?storeId=S001&mock=true
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  const storeId = (req.query.storeId as string) || 'S001';
  const useMock = req.query.mock === 'true';

  if (useMock) {
    const storeStats: Record<string, any> = {
      S001: { storeId: 'S001', today: { sales: 3, invoices: 2, orders: 1 }, month: { sales: 15, invoices: 12 }, pending: 1 },
      S002: { storeId: 'S002', today: { sales: 5, invoices: 3, orders: 2 }, month: { sales: 28, invoices: 18 }, pending: 2 },
      S003: { storeId: 'S003', today: { sales: 2, invoices: 1, orders: 0 }, month: { sales: 12, invoices: 8 }, pending: 0 },
      S004: { storeId: 'S004', today: { sales: 4, invoices: 4, orders: 1 }, month: { sales: 22, invoices: 20 }, pending: 3 },
    };
    res.json(storeStats[storeId] || storeStats.S001);
    return;
  }

  try {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);

    const [todaySales, todayInvoices, todayOrders, monthSales, monthInvoices, pendingCount] = await Promise.all([
      prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.pendingActions.count({ where: { storeId, type: 'ORDER_REQUEST', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
      prisma.pendingActions.count({ where: { storeId, status: 'PENDING' } }),
    ]);

    res.json({
      storeId,
      today: { sales: todaySales, invoices: todayInvoices, orders: todayOrders },
      month: { sales: monthSales, invoices: monthInvoices },
      pending: pendingCount,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get data by type
 * GET /api/stores/data?storeId=S001&type=sales&mock=true
 */
router.get('/data', async (req: Request, res: Response) => {
  const storeId = (req.query.storeId as string) || 'S001';
  const type = (req.query.type as string) || 'sales';
  const useMock = req.query.mock === 'true';

  if (useMock) {
    // Import mock data helper from data.ts logic
    const mockData = getStoreMockData(storeId);
    const typeMap: Record<string, string> = {
      sales: 'sales',
      invoices: 'invoices',
      expenses: 'expenses',
      fuel: 'fuel',
      paidouts: 'paidouts',
      orders: 'orders',
    };
    const dataKey = typeMap[type] || 'sales';
    const items = (mockData[dataKey] || []).map((item: any) => ({
      id: item.id,
      date: item.date,
      data: item.data,
      confidence: item.confidence,
    }));
    res.json({ [type]: items });
    return;
  }

  try {
    let dbType: string;
    switch (type) {
      case 'sales':
        dbType = 'STORE_SALES';
        break;
      case 'invoices':
        dbType = 'INVOICE_EXPENSE';
        break;
      case 'fuel':
        dbType = 'FUEL_SALES';
        break;
      case 'paidouts':
        dbType = 'PAID_OUT';
        break;
      case 'orders':
        dbType = 'ORDER_REQUEST';
        break;
      default:
        res.status(400).json({ error: 'Invalid type' });
        return;
    }

    const data = await prisma.pendingActions.findMany({
      where: {
        storeId,
        type: dbType as 'STORE_SALES' | 'INVOICE_EXPENSE' | 'FUEL_SALES' | 'PAID_OUT' | 'ORDER_REQUEST',
        status: 'CONFIRMED',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = data.map((item) => ({
      id: item.actionId,
      date: item.createdAt,
      data: item.payloadJson,
      confidence: item.confidence,
    }));

    res.json({ [type]: formatted });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get item detail
 * GET /api/stores/detail?storeId=S001&type=sales&id=xxx
 */
router.get('/detail', async (req: Request, res: Response) => {
  const storeId = req.query.storeId as string;
  const type = req.query.type as string;
  const id = req.query.id as string;

  if (!storeId || !type || !id) {
    res.status(400).json({ error: 'Missing required parameters: storeId, type, id' });
    return;
  }

  try {
    const dbTypeMap: Record<string, string> = {
      sales: 'STORE_SALES',
      invoices: 'INVOICE_EXPENSE',
      fuel: 'FUEL_SALES',
      paidouts: 'PAID_OUT',
      orders: 'ORDER_REQUEST',
    };
    const dbType = dbTypeMap[type];
    if (!dbType) {
      res.status(400).json({ error: 'Invalid type' });
      return;
    }

    const item = await prisma.pendingActions.findFirst({
      where: { actionId: id, storeId, type: dbType as any },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json({
      item: {
        id: item.actionId,
        date: item.createdAt,
        data: item.payloadJson,
        confidence: item.confidence,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get AI-powered business summary
 * GET /api/stores/summary?storeId=S001&period=today|week|month&mock=true
 */
router.get('/summary', async (req: Request, res: Response) => {
  const storeId = req.query.storeId as string;
  const period = (req.query.period as 'today' | 'week' | 'month') || 'today';
  const useMock = req.query.mock === 'true';

  if (!storeId) {
    res.status(400).json({ error: 'Store ID required (?storeId=S001)' });
    return;
  }

  // Optional: Verify user has access to this store
  const authUser = getAuthUser(req as any);
  if (authUser) {
    // Could add store access check here
  }

  try {
    let summary: BusinessSummary;
    
    if (useMock) {
      // Use mock data (local development only)
      summary = generateMockSummary(storeId, period);
    } else {
      // Use real database data
      summary = await generateBusinessSummary(storeId, period);
    }

    res.status(200).json({
      success: true,
      summary,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to generate summary', { error: errorMessage, storeId, period });
    res.status(500).json({
      error: 'Failed to generate summary',
      details: errorMessage,
    });
  }
});

/**
 * Link current user to a store
 * POST /api/stores/:storeId/link
 * Requires: Authentication (JWT token)
 */
router.post('/:storeId/link', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;
    const { role = 'OWNER' } = req.body;

    const authUser = getAuthUser(req as any);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    // Verify store exists
    const store = await prisma.storeConfig.findUnique({
      where: { storeId: storeId.toUpperCase() },
    });

    if (!store) {
      return res.status(404).json({
        error: 'Store not found',
      });
    }

    // Check if already linked
    const existingLink = await prisma.userStore.findUnique({
      where: {
        userId_storeId: {
          userId: authUser.userId,
          storeId: store.storeId,
        },
      },
    });

    if (existingLink) {
      return res.status(400).json({
        error: 'Already linked',
        message: `You are already linked to store ${store.storeId} as ${existingLink.role}`,
      });
    }

    // Create link
    await prisma.userStore.create({
      data: {
        userId: authUser.userId,
        storeId: store.storeId,
        role: role as any,
      },
    });

    res.json({
      success: true,
      message: `Successfully linked to store ${store.storeName}`,
      store: {
        storeId: store.storeId,
        storeName: store.storeName,
        role,
      },
    });
    return;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to link store',
      details: errorMessage,
    });
    return;
  }
});

/**
 * Unlink current user from a store
 * DELETE /api/stores/:storeId/link
 * Requires: Authentication (JWT token)
 */
router.delete('/:storeId/link', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;

    const authUser = getAuthUser(req as any);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    // Remove link
    await prisma.userStore.delete({
      where: {
        userId_storeId: {
          userId: authUser.userId,
          storeId: storeId.toUpperCase(),
        },
      },
    });

    res.json({
      success: true,
      message: `Successfully unlinked from store ${storeId.toUpperCase()}`,
    });
    return;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const { storeId } = req.params;
    if (errorMessage.includes('Record to delete does not exist')) {
      return res.status(404).json({
        error: 'Link not found',
        message: `You are not linked to store ${storeId.toUpperCase()}`,
      });
    }
    res.status(500).json({
      error: 'Failed to unlink store',
      details: errorMessage,
    });
    return;
  }
});

export { router as storesRouter };
