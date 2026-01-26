import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { ClassificationType, ExtractionResult } from '../types';
import { logger } from '../utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extract structured data using AI (OpenAI GPT-4 Vision)
 */
export async function extractWithAI(
  classificationType: ClassificationType,
  text: string,
  imageUrl?: string,
  imageBuffer?: Buffer
): Promise<ExtractionResult> {
  try {
    const prompt = buildExtractionPrompt(classificationType, text);
    const messages: any[] = [
      {
        role: 'system',
        content: 'You are a data extraction assistant. Extract structured data from messages and images. Return only valid JSON.',
      },
      {
        role: 'user',
        content: [],
      },
    ];

    // Add text content
    messages[1].content.push({
      type: 'text',
      text: prompt,
    });

    // Add image if available
    if (imageUrl) {
      messages[1].content.push({
        type: 'image_url',
        image_url: { url: imageUrl },
      });
    } else if (imageBuffer) {
      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');
      messages[1].content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64Image}`,
        },
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages,
      max_tokens: 1000,
      temperature: 0.1, // Low temperature for consistent extraction
    });

    const content = response.choices[0]?.message?.content || '{}';
    const extractedData = parseAIResponse(classificationType, content);

    return {
      fields: extractedData,
      confidence: 0.85, // AI extraction confidence
      raw_text: text,
      source_media_url: imageUrl,
      extraction_notes: 'AI-extracted',
    };
  } catch (error: any) {
    logger.error('AI extraction failed', {
      error: error.message,
      classificationType,
    });
    throw new Error(`AI extraction failed: ${error.message}`);
  }
}

function buildExtractionPrompt(
  type: ClassificationType,
  text: string
): string {
  const basePrompt = `Extract structured data from this message. Return ONLY valid JSON, no other text.\n\nMessage: "${text}"\n\n`;

  switch (type) {
    case ClassificationType.ORDER_REQUEST:
      return (
        basePrompt +
        `Extract order information. Return JSON format:
{
  "order_batch_id": "uuid-string",
  "vendor_groups": [
    {
      "vendor": "vendor-name",
      "items": [
        {"name": "item-name", "qty": number, "unit": "carton|pack|case|box"}
      ]
    }
  ]
}`
      );

    case ClassificationType.INVOICE_EXPENSE:
      return (
        basePrompt +
        `Extract invoice/expense information. Return JSON format:
{
  "vendor": "vendor-name",
  "amount": number,
  "invoice_date": "YYYY-MM-DD",
  "invoice_number": "optional-number",
  "category": "category-name",
  "paid": "Y" or "N"
}`
      );

    case ClassificationType.STORE_SALES:
      return (
        basePrompt +
        `Extract store sales information. Return JSON format:
{
  "date": "YYYY-MM-DD",
  "cash": number,
  "card": number,
  "tax": number,
  "total_inside": number
}`
      );

    case ClassificationType.FUEL_SALES:
      return (
        basePrompt +
        `Extract fuel sales information. Return JSON format:
{
  "date": "YYYY-MM-DD",
  "gallons": number,
  "fuel_sales": number,
  "fuel_gp": number
}`
      );

    case ClassificationType.PAID_OUT:
      return (
        basePrompt +
        `Extract paid-out information. Return JSON format:
{
  "date": "YYYY-MM-DD",
  "amount": number,
  "reason": "reason-text",
  "employee": "employee-name"
}`
      );

    default:
      return basePrompt + 'Extract any relevant structured data as JSON.';
  }
}

function parseAIResponse(
  type: ClassificationType,
  content: string
): Record<string, any> {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                     content.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, content];
    
    const jsonString = jsonMatch[1] || content.trim();
    const parsed = JSON.parse(jsonString);

    // Generate order_batch_id if missing for ORDER_REQUEST
    if (type === ClassificationType.ORDER_REQUEST && !parsed.order_batch_id) {
      parsed.order_batch_id = uuidv4();
    }

    return parsed;
  } catch (error: any) {
    logger.error('Failed to parse AI response', {
      error: error.message,
      content,
    });
    return {};
  }
}

