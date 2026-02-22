import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import axios from 'axios';

const router = Router();

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

/**
 * List available phone numbers from Meta Business Account
 * GET /api/admin/phone-numbers
 */
router.get('/phone-numbers', async (_req: Request, res: Response) => {
  try {
    if (!ACCESS_TOKEN || !BUSINESS_ACCOUNT_ID) {
      return res.status(400).json({
        error: 'WhatsApp configuration missing',
        details: 'WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID must be set',
      });
    }

    const response = await axios.get(
      `${WHATSAPP_API_URL}/${BUSINESS_ACCOUNT_ID}/phone_numbers`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        params: {
          fields: 'id,display_phone_number,verified_name,code_verification_status',
        },
      }
    );

    const phoneNumbers = response.data.data || [];

    res.json({
      success: true,
      phoneNumbers: phoneNumbers.map((pn: any) => ({
        phoneNumberId: pn.id,
        displayNumber: pn.display_phone_number,
        verifiedName: pn.verified_name,
        verificationStatus: pn.code_verification_status,
      })),
    });
    return;
  } catch (error: any) {
    logger.error('Failed to list phone numbers', {
      error: error.message,
      response: error.response?.data,
    });
    res.status(500).json({
      error: 'Failed to list phone numbers',
      details: error.response?.data?.error?.message || error.message,
    });
    return;
  }
});

/**
 * Assign a phone number to a store
 * POST /api/admin/stores/:storeId/phone-number
 * Body: { phoneNumberId: string, displayNumber?: string }
 */
router.post('/stores/:storeId/phone-number', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;
    const { phoneNumberId, displayNumber } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({
        error: 'phoneNumberId is required',
      });
    }

    // Verify store exists
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
    });

    if (!store) {
      return res.status(404).json({
        error: 'Store not found',
      });
    }

    // Check if phone number is already assigned to another store
    const existingStore = await prisma.storeConfig.findFirst({
      where: {
        whatsappPhoneNumberId: phoneNumberId,
        storeId: { not: storeId },
      },
    });

    if (existingStore) {
      return res.status(400).json({
        error: 'Phone number already assigned',
        details: `Phone number is already assigned to store ${existingStore.storeId}`,
      });
    }

    // Get display number from Meta API if not provided
    let finalDisplayNumber = displayNumber;
    if (!finalDisplayNumber && ACCESS_TOKEN) {
      try {
        const response = await axios.get(
          `${WHATSAPP_API_URL}/${phoneNumberId}`,
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
            params: {
              fields: 'display_phone_number',
            },
          }
        );
        finalDisplayNumber = response.data.display_phone_number;
      } catch (error: any) {
        logger.warn('Could not fetch display number from Meta', {
          error: error.message,
        });
      }
    }

    // Update store with phone number
    const updatedStore = await prisma.storeConfig.update({
      where: { storeId },
      data: {
        whatsappPhoneNumberId: phoneNumberId,
        whatsappDisplayNumber: finalDisplayNumber,
      },
    });

    logger.info('Phone number assigned to store', {
      storeId,
      phoneNumberId,
      displayNumber: finalDisplayNumber,
    });

    res.json({
      success: true,
      store: {
        storeId: updatedStore.storeId,
        storeName: updatedStore.storeName,
        whatsappPhoneNumberId: updatedStore.whatsappPhoneNumberId,
        whatsappDisplayNumber: updatedStore.whatsappDisplayNumber,
      },
    });
    return;
  } catch (error: any) {
    logger.error('Failed to assign phone number', {
      error: error.message,
      storeId: req.params.storeId,
    });
    res.status(500).json({
      error: 'Failed to assign phone number',
      details: error.message,
    });
    return;
  }
});

/**
 * Remove phone number assignment from a store
 * DELETE /api/admin/stores/:storeId/phone-number
 */
router.delete('/stores/:storeId/phone-number', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
    });

    if (!store) {
      return res.status(404).json({
        error: 'Store not found',
      });
    }

    const updatedStore = await prisma.storeConfig.update({
      where: { storeId },
      data: {
        whatsappPhoneNumberId: null,
        whatsappDisplayNumber: null,
      },
    });

    logger.info('Phone number removed from store', {
      storeId,
    });

    res.json({
      success: true,
      store: {
        storeId: updatedStore.storeId,
        storeName: updatedStore.storeName,
        whatsappPhoneNumberId: updatedStore.whatsappPhoneNumberId,
        whatsappDisplayNumber: updatedStore.whatsappDisplayNumber,
      },
    });
    return;
  } catch (error: any) {
    logger.error('Failed to remove phone number', {
      error: error.message,
      storeId: req.params.storeId,
    });
    res.status(500).json({
      error: 'Failed to remove phone number',
      details: error.message,
    });
    return;
  }
});

/**
 * Get store phone number assignment
 * GET /api/admin/stores/:storeId/phone-number
 */
router.get('/stores/:storeId/phone-number', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;

    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: {
        storeId: true,
        storeName: true,
        whatsappPhoneNumberId: true,
        whatsappDisplayNumber: true,
      },
    });

    if (!store) {
      return res.status(404).json({
        error: 'Store not found',
      });
    }

    res.json({
      success: true,
      store,
    });
    return;
  } catch (error: any) {
    logger.error('Failed to get store phone number', {
      error: error.message,
      storeId: req.params.storeId,
    });
    res.status(500).json({
      error: 'Failed to get store phone number',
      details: error.message,
    });
    return;
  }
});

/**
 * Create a new store (with optional auto-link to user)
 * POST /api/admin/stores
 * Body: { storeId, storeName, sheetId, timezone?, userId?, role? }
 */
router.post('/stores', async (req: Request, res: Response) => {
  try {
    const { storeId, storeName, sheetId, timezone = 'America/New_York', userId, role = 'OWNER' } = req.body;

    if (!storeId || !storeName || !sheetId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['storeId', 'storeName', 'sheetId'],
      });
    }

    // Create store
    const store = await prisma.storeConfig.create({
      data: {
        storeId: storeId.toUpperCase(),
        storeName,
        sheetId,
        timezone,
        active: true,
      },
    });

    // Auto-link to user if userId provided (onboarding flow)
    if (userId) {
      try {
        await prisma.userStore.create({
          data: {
            userId,
            storeId: store.storeId,
            role: role as any, // OWNER, MANAGER, or STAFF
          },
        });
        logger.info('Store created and linked to user', {
          storeId: store.storeId,
          userId,
          role,
        });
      } catch (linkError: any) {
        // If link fails, store is still created
        logger.warn('Failed to auto-link store to user', {
          error: linkError.message,
          storeId: store.storeId,
          userId,
        });
      }
    }

    res.json({
      success: true,
      store: {
        storeId: store.storeId,
        storeName: store.storeName,
        sheetId: store.sheetId,
        timezone: store.timezone,
        linkedToUser: !!userId,
      },
    });
    return;
  } catch (error: any) {
    if (error.code === 'P2002') {
      // Unique constraint violation
      return res.status(400).json({
        error: 'Store ID already exists',
        details: `Store ${req.body.storeId} is already registered`,
      });
    }
    logger.error('Failed to create store', {
      error: error.message,
    });
    res.status(500).json({
      error: 'Failed to create store',
      details: error.message,
    });
    return;
  }
});

export default router;
