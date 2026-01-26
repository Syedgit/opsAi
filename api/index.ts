import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const path = req.url || '/';
  
  // Serve static HTML files
  if (path === '/' || path === '/index.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
      return;
    } catch (error) {
      res.json({ 
        message: 'opsAi API',
        endpoints: {
          webhook: '/api/webhook/whatsapp',
          health: '/api/health'
        }
      });
      return;
    }
  }
  
  if (path === '/privacy-policy.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'privacy-policy.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
      return;
    } catch (error) {
      res.status(404).send('Privacy Policy not found');
      return;
    }
  }
  
  if (path === '/terms-of-service.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'terms-of-service.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
      return;
    } catch (error) {
      res.status(404).send('Terms of Service not found');
      return;
    }
  }
  
  res.json({ 
    message: 'opsAi API',
    endpoints: {
      webhook: '/api/webhook/whatsapp',
      health: '/api/health'
    }
  });
}

