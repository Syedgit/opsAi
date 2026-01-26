import { Router } from 'express';
import { verifyWebhook, handleWebhook } from '../controllers/whatsappController';
import { verifySignature } from '../middleware/verifySignature';

export const whatsappRouter = Router();

// Webhook verification (GET) - Meta sends GET request to verify
whatsappRouter.get('/whatsapp', verifyWebhook);

// Webhook message handler (POST) - Meta sends POST requests with messages
whatsappRouter.post('/whatsapp', verifySignature, handleWebhook);

