import { ImageAnnotatorClient } from '@google-cloud/vision';
import { logger } from '../utils/logger';

let visionClient: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (!visionClient) {
    visionClient = new ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      ...(process.env.GOOGLE_VISION_API_KEY && {
        apiKey: process.env.GOOGLE_VISION_API_KEY,
      }),
    });
  }
  return visionClient;
}

/**
 * Extract text from image using Google Cloud Vision OCR
 */
export async function extractTextFromImage(imageUrl: string): Promise<string> {
  try {
    const client = getVisionClient();
    const [result] = await client.textDetection(imageUrl);
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      logger.warn('No text detected in image', { imageUrl });
      return '';
    }

    // First detection is the entire text block
    const fullText = detections[0].description || '';
    logger.info('OCR extraction completed', {
      imageUrl,
      textLength: fullText.length,
    });

    return fullText;
  } catch (error: any) {
    logger.error('OCR extraction failed', {
      error: error.message,
      imageUrl,
    });
    throw new Error(`OCR failed: ${error.message}`);
  }
}

/**
 * Extract text from image buffer (for downloaded images)
 */
export async function extractTextFromBuffer(imageBuffer: Buffer): Promise<string> {
  try {
    const client = getVisionClient();
    const [result] = await client.textDetection({
      image: { content: imageBuffer },
    });
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      logger.warn('No text detected in image buffer');
      return '';
    }

    const fullText = detections[0].description || '';
    logger.info('OCR extraction from buffer completed', {
      textLength: fullText.length,
    });

    return fullText;
  } catch (error: any) {
    logger.error('OCR extraction from buffer failed', {
      error: error.message,
    });
    throw new Error(`OCR failed: ${error.message}`);
  }
}

