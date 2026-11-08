import { whatsappInboundParts } from '../whatsappInbound';

describe('whatsappInboundParts', () => {
  it('reads a normal WhatsApp image', () => {
    expect(
      whatsappInboundParts({
        type: 'image',
        image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'close' },
      })
    ).toEqual({ messageText: 'close', mediaId: 'MEDIA1', mediaType: 'image/jpeg' });
  });

  it('treats a camera-roll document with an image mime as a photo', () => {
    expect(
      whatsappInboundParts({
        type: 'document',
        document: { id: 'DOC1', mime_type: 'image/jpeg', caption: 'store sales' },
      })
    ).toEqual({ messageText: 'store sales', mediaId: 'DOC1', mediaType: 'image/jpeg' });
  });

  it('ignores a PDF document', () => {
    expect(
      whatsappInboundParts({
        type: 'document',
        document: { id: 'PDF1', mime_type: 'application/pdf' },
      })
    ).toEqual({ messageText: '' });
  });
});
