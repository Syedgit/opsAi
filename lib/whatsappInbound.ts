/**
 * Pull text + media ids out of one Cloud API message object.
 * WhatsApp sends some camera-roll photos as `document` with an image mime type.
 */
export function whatsappInboundParts(message: {
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string };
  /** Tap on a template's quick-reply button. */
  button?: { text?: string; payload?: string };
  /** Tap on a reply button opsAi sent. */
  interactive?: { button_reply?: { id?: string; title?: string } };
}): { messageText: string; mediaId?: string; mediaType?: string } {
  const tapped =
    message.button?.payload || message.button?.text || message.interactive?.button_reply?.id || message.interactive?.button_reply?.title || '';
  const typed = message.text?.body?.trim() || tapped.trim();
  const image = message.image;
  const document = message.document;
  const audio = message.audio;
  const docMime = document?.mime_type || '';
  const documentIsImage = Boolean(document?.id && docMime.startsWith('image/'));

  if (audio?.id) {
    return { messageText: typed, mediaId: audio.id, mediaType: 'audio' };
  }
  if (image?.id) {
    return {
      messageText: typed || image.caption || '',
      mediaId: image.id,
      mediaType: image.mime_type?.startsWith('image/') ? image.mime_type : 'image/jpeg',
    };
  }
  if (documentIsImage && document?.id) {
    return {
      messageText: typed || document.caption || '',
      mediaId: document.id,
      mediaType: docMime,
    };
  }
  return { messageText: typed || image?.caption || document?.caption || '' };
}
