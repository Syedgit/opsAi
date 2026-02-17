import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Get detailed information about a specific record
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = req.query.storeId as string;
  const type = req.query.type as string;
  const id = req.query.id as string;

  if (!storeId || !type || !id) {
    res.status(400).json({ error: 'Missing required parameters: storeId, type, id' });
    return;
  }

  try {
    // Try mock detail endpoint first
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';
    
    const response = await fetch(
      `${baseUrl}/api/stores/mock-detail?storeId=${storeId}&type=${type}&id=${id}`
    ).catch(() => null);

    if (response && response.ok) {
      const data = await response.json() as { item: any };
      res.json(data);
      return;
    }

    // Fallback: Get all data for the type
    const fallbackResponse = await fetch(
      `${baseUrl}/api/stores/mock-data?storeId=${storeId}&type=${type}`
    ).catch(() => null);

    let items: any[] = [];
    if (fallbackResponse && fallbackResponse.ok) {
      const responseData = await fallbackResponse.json() as Record<string, any[]>;
      items = responseData[type] || [];
    }

    // Find the specific item
    const item = items.find((i: any) => i.id === id);

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json({ item });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
