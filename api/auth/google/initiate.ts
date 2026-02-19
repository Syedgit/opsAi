import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initiateGoogleAuth } from '../google';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await initiateGoogleAuth(req, res);
}
