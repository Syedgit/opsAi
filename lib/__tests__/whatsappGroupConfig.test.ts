import { getGroupSetupMode, isGroupAutoProvisionEnabled } from '../whatsappGroupConfig';

describe('whatsappGroupConfig', () => {
  const original = process.env.WHATSAPP_GROUP_AUTO_PROVISION;

  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_GROUP_AUTO_PROVISION;
    else process.env.WHATSAPP_GROUP_AUTO_PROVISION = original;
  });

  it('defaults to manual (Path A)', () => {
    delete process.env.WHATSAPP_GROUP_AUTO_PROVISION;
    expect(isGroupAutoProvisionEnabled()).toBe(false);
    expect(getGroupSetupMode()).toBe('manual');
  });

  it('enables auto when env is true', () => {
    process.env.WHATSAPP_GROUP_AUTO_PROVISION = 'true';
    expect(isGroupAutoProvisionEnabled()).toBe(true);
    expect(getGroupSetupMode()).toBe('auto');
  });
});
