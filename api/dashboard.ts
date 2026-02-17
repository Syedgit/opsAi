import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  try {
    const html = readFileSync(join(process.cwd(), 'public', 'dashboard.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    // Allow inline scripts for dashboard
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
    );
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send('Error loading dashboard');
  }
}
