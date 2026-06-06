import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from './utils/logger';
import { whatsappRouter } from './routes/whatsapp';
import { storesRouter } from './routes/stores';
import { authRouter } from './routes/auth';
import { testRouter } from './routes/test';
import adminRouter from './routes/admin';
import onboardingRouter from './routes/onboarding';
import twilioRouter from './routes/twilio';
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

// Serve static files from public directory (for CSS, JS, images, etc.)
app.use(express.static(join(__dirname, '..', 'public')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve HTML pages
app.get('/', (_req, res) => {
  // Redirect to dashboard
  res.redirect('/dashboard');
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

app.get('/login', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'login.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving login.html', error);
    res.status(500).send('Error loading login');
  }
});

app.get('/signup', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'signup.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving signup.html', error);
    res.status(500).send('Error loading signup');
  }
});

app.get('/onboarding', (_req, res) => {
  try {
    const html = readFileSync(join(__dirname, '..', 'public', 'onboarding.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error serving onboarding.html', error);
    res.status(500).send('Error loading onboarding');
  }
});

// Routes
app.use('/api/webhook', whatsappRouter);
// Twilio SMS webhook (for receiving SMS verification codes)
// Test: Mount at separate path first to verify it works
console.log('🔧 Registering Twilio SMS webhook');
app.use('/api/twilio', twilioRouter); // Temporary: test at /api/twilio/twilio-sms
app.use('/api/webhook', twilioRouter); // Also mount at /api/webhook for Twilio
console.log('✅ Twilio SMS webhook registered');
// Also support /whatsapp for backward compatibility
app.use('/whatsapp', whatsappRouter);
// Auth routes (for local development)
app.use('/api/auth', authRouter);
app.use('/api/onboarding', onboardingRouter);
// Stores API routes (for dashboard)
app.use('/api/stores', storesRouter);
// Admin routes (for phone number provisioning)
app.use('/api/admin', adminRouter);
// Test routes (for local testing)
app.use('/api/test', testRouter);

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
  logger.info(`📱 WhatsApp webhook: http://localhost:${PORT}/api/webhook/whatsapp`);
  logger.info(`📨 Twilio SMS webhook: http://localhost:${PORT}/api/webhook/twilio-sms`);
  logger.info(`✅ Ready to receive webhooks!`);
});

export default app;

