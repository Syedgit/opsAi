/** How this store talks to opsAi on WhatsApp. */
export type WhatsAppOpsMode = 'direct' | 'group';

export function readWhatsAppOpsMode(profileJson: unknown): WhatsAppOpsMode {
  if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) return 'direct';
  const mode = (profileJson as Record<string, unknown>).whatsappOpsMode;
  return mode === 'group' ? 'group' : 'direct';
}

export function withWhatsAppOpsMode(profileJson: unknown, mode: WhatsAppOpsMode): Record<string, unknown> {
  const base =
    profileJson && typeof profileJson === 'object' && !Array.isArray(profileJson)
      ? { ...(profileJson as Record<string, unknown>) }
      : {};
  return { ...base, whatsappOpsMode: mode };
}
