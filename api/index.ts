import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url || '/';
  
  // Serve static HTML files
  if (path === '/' || path === '/index.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      return res.json({ 
        message: 'opsAi API',
        endpoints: {
          webhook: '/api/webhook/whatsapp',
          health: '/api/health'
        }
      });
    }
  }
  
  if (path === '/privacy-policy.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'privacy-policy.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      return res.status(404).send('Privacy Policy not found');
    }
  }
  
  if (path === '/terms-of-service.html') {
    try {
      const html = readFileSync(join(process.cwd(), 'public', 'terms-of-service.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      return res.status(404).send('Terms of Service not found');
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

