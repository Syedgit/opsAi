import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from './utils/logger';
import { whatsappRouter } from './routes/whatsapp';
import { storesRouter } from './routes/stores';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve HTML pages
app.get('/', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving index.html', error);
    res.status(500).send('Error loading page');
  }
});

app.get('/privacy-policy.html', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'privacy-policy.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving privacy-policy.html', error);
    res.status(500).send('Error loading privacy policy');
  }
});

app.get('/terms-of-service.html', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'terms-of-service.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving terms-of-service.html', error);
    res.status(500).send('Error loading terms of service');
  }
});

app.get('/dashboard', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving dashboard.html', error);
    res.status(500).send('Error loading dashboard');
  }
});

// Routes
app.use('/api/webhook', whatsappRouter);
// Also support /whatsapp for backward compatibility
app.use('/whatsapp', whatsappRouter);
// Stores API routes (for dashboard)
app.use('/api/stores', storesRouter);

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

