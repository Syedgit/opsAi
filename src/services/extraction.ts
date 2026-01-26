import { ExtractionResult, ClassificationType } from '../types';
import { logger } from '../utils/logger';
import { extractTextFromImage, extractTextFromBuffer } from './ocr';
import { extractWithAI } from './aiExtraction';

/**
 * Extract structured data from text and/or images
 * Combines OCR (for images) and AI extraction
 */
export async function extractData(
  classificationType: ClassificationType,
  text: string,
  imageUrl?: string,
  imageBuffer?: Buffer
): Promise<ExtractionResult> {
  logger.info('Extracting data', {
    classificationType,
    hasImage: !!imageUrl || !!imageBuffer,
  });

  let fullText = text;
  let ocrText = '';

  // If image provided, run OCR first
  if (imageBuffer) {
    try {
      ocrText = await extractTextFromBuffer(imageBuffer);
      fullText = `${text}\n\n${ocrText}`.trim();
      logger.info('OCR completed', { ocrTextLength: ocrText.length });
    } catch (error: any) {
      logger.warn('OCR failed, continuing with text only', {
        error: error.message,
      });
    }
  } else if (imageUrl) {
    try {
      ocrText = await extractTextFromImage(imageUrl);
      fullText = `${text}\n\n${ocrText}`.trim();
      logger.info('OCR completed', { ocrTextLength: ocrText.length });
    } catch (error: any) {
      logger.warn('OCR failed, continuing with text only', {
        error: error.message,
      });
    }
  }

  // Use AI extraction for structured data
  try {
    const aiResult = await extractWithAI(
      classificationType,
      fullText,
      imageUrl,
      imageBuffer
    );

    return {
      ...aiResult,
      raw_text: text, // Keep original text
      extraction_notes: ocrText
        ? `OCR + AI extraction. OCR text: ${ocrText.substring(0, 100)}...`
        : 'AI extraction from text',
    };
  } catch (error: any) {
    logger.error('AI extraction failed', { error: error.message });
    // Fallback: return basic structure
    return {
      fields: {},
      confidence: 0.0,
      raw_text: text,
      source_media_url: imageUrl,
      extraction_notes: `Extraction failed: ${error.message}`,
    };
  }
}

