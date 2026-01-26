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
    logger.warn('WHATSAPP_APP_SECRET not configured');
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

  if (providedSignature !== expectedSignature) {
    logger.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};

