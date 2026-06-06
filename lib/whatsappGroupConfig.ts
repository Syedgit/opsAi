/**
 * Phase 1 (Path A): manual groups — owner creates group in WhatsApp, adds opsAi number, first message auto-links.
 * Phase 2: set WHATSAPP_GROUP_AUTO_PROVISION=true to use Meta Groups API on onboarding.
 */
export function isGroupAutoProvisionEnabled(): boolean {
  const v = (process.env.WHATSAPP_GROUP_AUTO_PROVISION || 'false').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes';
}

export type GroupSetupMode = 'manual' | 'auto';

export function getGroupSetupMode(): GroupSetupMode {
  return isGroupAutoProvisionEnabled() ? 'auto' : 'manual';
}
