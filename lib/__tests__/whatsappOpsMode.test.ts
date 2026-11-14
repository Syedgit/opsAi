import { readWhatsAppOpsMode, withWhatsAppOpsMode } from '../whatsappOpsMode';

describe('whatsappOpsMode', () => {
  it('defaults to direct chat', () => {
    expect(readWhatsAppOpsMode(null)).toBe('direct');
    expect(readWhatsAppOpsMode({})).toBe('direct');
    expect(readWhatsAppOpsMode({ whatsappOpsMode: 'nope' })).toBe('direct');
  });

  it('reads and writes group preference without wiping other profile fields', () => {
    expect(readWhatsAppOpsMode({ whatsappOpsMode: 'group', depositRule: { floatLeftInRegister: 0 } })).toBe('group');
    expect(withWhatsAppOpsMode({ depositRule: { floatLeftInRegister: 50 } }, 'group')).toEqual({
      depositRule: { floatLeftInRegister: 50 },
      whatsappOpsMode: 'group',
    });
  });
});
