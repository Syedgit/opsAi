import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';
import { format } from 'date-fns';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

/**
 * Download media from WhatsApp using media ID
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  try {
    // Get media URL from WhatsApp API
    const urlResponse = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
      }
    );

    const mediaUrl = urlResponse.data.url;

    // Download the actual media file
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      responseType: 'arraybuffer',
    });

    return Buffer.from(mediaResponse.data);
  } catch (error: any) {
    logger.error('Failed to download WhatsApp media', {
      error: error.message,
      mediaId,
    });
    throw new Error(`Media download failed: ${error.message}`);
  }
}

/**
 * Upload image to S3 and return public URL
 */
export async function uploadToS3(
  buffer: Buffer,
  storeId: string,
  messageId: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  try {
    const client = getS3Client();
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME not configured');
    }

    const now = new Date();
    const year = format(now, 'yyyy');
    const month = format(now, 'MM');
    const day = format(now, 'dd');
    const extension = mimeType.includes('png') ? 'png' : 'jpg';

    const key = `${storeId}/${year}/${month}/${day}/${messageId}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });

    await client.send(command);

    // Construct public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    logger.info('Image uploaded to S3', { storeId, key, publicUrl });
    return publicUrl;
  } catch (error: any) {
    logger.error('Failed to upload to S3', {
      error: error.message,
      storeId,
    });
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Process WhatsApp media: download and store
 */
export async function processWhatsAppMedia(
  mediaId: string,
  storeId: string,
  messageId: string,
  mimeType?: string
): Promise<{ buffer: Buffer; s3Url: string }> {
  const buffer = await downloadWhatsAppMedia(mediaId);
  const s3Url = await uploadToS3(buffer, storeId, messageId, mimeType);
  return { buffer, s3Url };
}

