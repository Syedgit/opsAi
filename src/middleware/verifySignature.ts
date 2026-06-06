import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export const verifySignature = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('WHATSAPP_APP_SECRET is required in production');
      return res.status(500).json({ error: 'Webhook verification not configured' });
    }
    logger.warn('WHATSAPP_APP_SECRET not configured (dev only)');
    return next();
  }

  if (!signature) {
    logger.warn('Missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const providedBuf = Buffer.from(providedSignature, 'utf8');
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    logger.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};

