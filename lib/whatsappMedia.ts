import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

/** Photos and voice notes from WhatsApp are far smaller than this; the cap protects the function. */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Download a media file (photo, voice note) that WhatsApp delivered by id.
 * Meta's media links expire quickly, so this is done as soon as the message arrives.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string | undefined = process.env.WHATSAPP_ACCESS_TOKEN
): Promise<DownloadedMedia> {
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN not configured');
  }
  const headers = { Authorization: `Bearer ${accessToken}` };

  const meta = await axios.get<{ url?: string; mime_type?: string; file_size?: number }>(
    `${WHATSAPP_API_URL}/${encodeURIComponent(mediaId)}`,
    { headers, timeout: 15000 }
  );
  const url = meta.data.url;
  if (!url) {
    throw new Error('WhatsApp did not return a media URL');
  }
  if (typeof meta.data.file_size === 'number' && meta.data.file_size > MAX_MEDIA_BYTES) {
    throw new Error('Media file is too large');
  }

  const file = await axios.get<ArrayBuffer>(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: MAX_MEDIA_BYTES,
  });

  return {
    buffer: Buffer.from(file.data),
    mimeType: meta.data.mime_type || String(file.headers['content-type'] || 'application/octet-stream'),
  };
}
