import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { whatsappRouter } from './routes/whatsapp';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/webhook', whatsappRouter);
// Also support /whatsapp for backward compatibility
app.use('/whatsapp', whatsappRouter);

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 Webhook endpoint: http://localhost:${PORT}/api/webhook/whatsapp`);
  logger.info(`✅ Ready to receive WhatsApp webhooks!`);
});

export default app;

