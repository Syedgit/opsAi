/** Prisma P2021: the table is in schema.prisma but was never created on this database. */
export function isMissingTable(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'P2021') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /table `[^`]+` does not exist in the current database/i.test(message);
}
