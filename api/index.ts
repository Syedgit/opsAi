import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  try {
    const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send('Error loading page');
  }
}
