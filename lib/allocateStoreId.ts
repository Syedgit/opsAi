import type { PrismaClient } from '@prisma/client';

/** Next available `S001`–`S999` style id (best-effort; callers should retry create on P2002). */
export async function allocateSequentialStoreId(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.storeConfig.findMany({ select: { storeId: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^S(\d{1,3})$/i.exec(r.storeId.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  if (next > 999) {
    throw new Error('Store ID space exhausted (S001–S999)');
  }
  return `S${String(next).padStart(3, '0')}`;
}
