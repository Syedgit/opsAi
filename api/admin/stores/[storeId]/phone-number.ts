import { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { storeId } = req.query;

  if (req.method === 'POST') {
    // Assign phone number to store
    try {
      const { phoneNumberId, displayNumber } = req.body;

      if (!phoneNumberId) {
        return res.status(400).json({
          error: 'phoneNumberId is required',
        });
      }

      const store = await prisma.storeConfig.findUnique({
        where: { storeId: storeId as string },
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
          storeId: { not: storeId as string },
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
          // Ignore error, use provided displayNumber
        }
      }

      // Update store with phone number
      const updatedStore = await prisma.storeConfig.update({
        where: { storeId: storeId as string },
        data: {
          whatsappPhoneNumberId: phoneNumberId,
          whatsappDisplayNumber: finalDisplayNumber,
        },
      });

      return res.json({
        success: true,
        store: {
          storeId: updatedStore.storeId,
          storeName: updatedStore.storeName,
          whatsappPhoneNumberId: updatedStore.whatsappPhoneNumberId,
          whatsappDisplayNumber: updatedStore.whatsappDisplayNumber,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to assign phone number',
        details: error.message,
      });
    }
  } else if (req.method === 'GET') {
    // Get store phone number assignment
    try {
      const store = await prisma.storeConfig.findUnique({
        where: { storeId: storeId as string },
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

      return res.json({
        success: true,
        store,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to get store phone number',
        details: error.message,
      });
    }
  } else if (req.method === 'DELETE') {
    // Remove phone number assignment
    try {
      const store = await prisma.storeConfig.findUnique({
        where: { storeId: storeId as string },
      });

      if (!store) {
        return res.status(404).json({
          error: 'Store not found',
        });
      }

      const updatedStore = await prisma.storeConfig.update({
        where: { storeId: storeId as string },
        data: {
          whatsappPhoneNumberId: null,
          whatsappDisplayNumber: null,
        },
      });

      return res.json({
        success: true,
        store: {
          storeId: updatedStore.storeId,
          storeName: updatedStore.storeName,
          whatsappPhoneNumberId: updatedStore.whatsappPhoneNumberId,
          whatsappDisplayNumber: updatedStore.whatsappDisplayNumber,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to remove phone number',
        details: error.message,
      });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
