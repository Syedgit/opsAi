import { isMissingTable } from '../prismaMissing';

describe('isMissingTable', () => {
  it('recognizes Prisma P2021', () => {
    expect(isMissingTable({ code: 'P2021', message: 'The table `public.store_whatsapp_groups` does not exist in the current database.' })).toBe(
      true
    );
  });

  it('does not swallow other Prisma errors', () => {
    expect(isMissingTable({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isMissingTable(new Error('db down'))).toBe(false);
  });
});
