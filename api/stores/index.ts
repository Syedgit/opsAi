import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { getAuthUser, requireAuthUser } from '../../lib/apiAuth';
import { requireStoreAccess, isMockRequested } from '../../lib/storeAccess';
import { getGroupSetupMode, isGroupAutoProvisionEnabled } from '../../lib/whatsappGroupConfig';
import { isMissingTable } from '../../lib/prismaMissing';
import { logAppError, loggedHandler, serializeError } from '../../lib/requestLog';
import { readStoredSetup } from '../../lib/tasks/storeSetup';
import { dashboardModules } from '../../lib/businessProfile';
import { flattenTillPaidOuts, sourceActionId } from '../../lib/understanding/tillPaidOuts';
import { utcMonthRange } from '../../lib/billing/plans';
import { summarizeUsage } from '../../lib/understanding/usage';

const prisma = new PrismaClient();

/**
 * Unified stores endpoint
 * GET /api/stores - List stores
 * GET /api/stores/dashboard - Dashboard stats
 * GET /api/stores/data - Get data by type
 * GET /api/stores/detail - Get item detail
 * GET /api/stores/:storeId/whatsapp-group-provision - ops group link status
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = req.url?.split('?')[0] || '';
  const storeId = (req.query.storeId as string) || 'S001';
  const type = (req.query.type as string) || 'sales';
  const id = req.query.id as string;
  const useMock = isMockRequested(req);

  if (path.includes('whatsapp-group-provision')) {
    await sendWhatsAppGroupStatus(req, res, path);
    return;
  }

  // List stores
  if (path.endsWith('/stores') && !path.includes('/dashboard') && !path.includes('/data') && !path.includes('/detail')) {
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
      const authUser = requireAuthUser(req, res);
      if (!authUser) return;

      const userStores = await prisma.userStore.findMany({
        where: { userId: authUser.userId },
        include: { store: { select: { storeId: true, storeName: true, timezone: true, active: true, setupJson: true } } },
      });
      const stores = userStores
        .filter((us) => us.store.active)
        .map((us) => {
          const setup = readStoredSetup(us.store.setupJson);
          return {
            storeId: us.store.storeId,
            storeName: us.store.storeName,
            timezone: us.store.timezone,
            active: us.store.active,
            role: us.role,
            storeType: setup?.storeType ?? null,
            modules: dashboardModules(setup?.storeType ?? null, setup?.fuel),
          };
        });
      res.json({ stores });
    } catch (error: unknown) {
      logAppError('stores', serializeError(error));
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Dashboard stats
  if (path.includes('/dashboard')) {
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
      const access = await requireStoreAccess(req, res, prisma, storeId, useMock);
      if (!useMock && !access) return;

      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);

      const monthWindow = utcMonthRange();
      const [todaySales, todayInvoices, todayOrders, monthSales, monthInvoices, pendingCount, monthLogs] = await Promise.all([
        prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'ORDER_REQUEST', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
        prisma.pendingActions.count({ where: { storeId, status: 'PENDING' } }),
        prisma.messageLog.findMany({
          where: { storeId, createdAt: { gte: monthWindow.from, lt: monthWindow.to } },
          select: { storeId: true, createdAt: true, extractedData: true },
          take: 20000,
        }),
      ]);
      const used = summarizeUsage(monthLogs).total;

      res.json({
        storeId,
        today: { sales: todaySales, invoices: todayInvoices, orders: todayOrders },
        month: { sales: monthSales, invoices: monthInvoices },
        pending: pendingCount,
        usage: {
          month: monthWindow.month,
          aiReadings: used.aiCalls,
        },
      });
    } catch (error: unknown) {
      logAppError('stores', serializeError(error));
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Item detail
  if (path.includes('/detail')) {
    if (!storeId || !type || !id) {
      res.status(400).json({ error: 'Missing required parameters: storeId, type, id' });
      return;
    }

    if (useMock) {
      // Mock data logic (simplified)
      res.status(404).json({ error: 'Mock detail not implemented' });
      return;
    }

    try {
      const access = await requireStoreAccess(req, res, prisma, storeId, useMock);
      if (!useMock && !access) return;

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

      const lookupId = type === 'paidouts' ? sourceActionId(id) : id;
      const item = await prisma.pendingActions.findFirst({
        where:
          type === 'paidouts' || type === 'fuel'
            ? { actionId: lookupId, storeId }
            : { actionId: lookupId, storeId, type: dbType as 'STORE_SALES' | 'INVOICE_EXPENSE' | 'FUEL_SALES' | 'PAID_OUT' | 'ORDER_REQUEST' },
      });

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      if (type === 'paidouts') {
        const flat = flattenTillPaidOuts([item]);
        const hit = flat.find((row) => row.id === id) ?? flat[0];
        if (!hit) {
          res.status(404).json({ error: 'Item not found' });
          return;
        }
        res.json({ item: hit });
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
      logAppError('stores', serializeError(error));
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Data by type — handled by api/stores/data.ts (see vercel.json rewrite)
  if (path.includes('/data')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.status(404).json({ error: 'Not found' });
}

export default loggedHandler('stores', handler);

async function sendWhatsAppGroupStatus(req: VercelRequest, res: VercelResponse, path: string): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const fromPath = path.match(/\/stores\/([^/]+)\/whatsapp-group-provision/i);
  const storeId = String(req.query.storeId || fromPath?.[1] || '').toUpperCase();
  if (!storeId) {
    res.status(400).json({ error: 'storeId required' });
    return;
  }
  const authUser = getAuthUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const member = await prisma.userStore.findFirst({
    where: { userId: authUser.userId, storeId },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this store' });
    return;
  }

  let provision = null;
  let activeGroups: Array<{ id: string; whatsappGroupId: string; createdAt: Date }> = [];
  try {
    provision = await prisma.whatsAppGroupProvision.findFirst({
      where: { storeId },
      orderBy: { updatedAt: 'desc' },
    });
  } catch (error) {
    if (!isMissingTable(error)) logAppError('stores.whatsapp_group.provision', serializeError(error));
  }
  try {
    activeGroups = await prisma.storeWhatsAppGroup.findMany({
      where: { storeId, active: true },
      select: { id: true, whatsappGroupId: true, createdAt: true },
    });
  } catch (error) {
    if (!isMissingTable(error)) logAppError('stores.whatsapp_group.groups', serializeError(error));
  }

  res.json({
    success: true,
    groupSetupMode: getGroupSetupMode(),
    autoProvisionEnabled: isGroupAutoProvisionEnabled(),
    provision: provision
      ? {
          id: provision.id,
          status: provision.status,
          subject: provision.subject,
          description: provision.description,
          metaRequestId: provision.metaRequestId,
          whatsappGroupId: provision.whatsappGroupId,
          inviteLink: provision.inviteLink,
          lastError: provision.lastError,
          updatedAt: provision.updatedAt,
        }
      : null,
    activeGroups,
  });
}
