export enum ClassificationType {
  ORDER_REQUEST = 'ORDER_REQUEST',
  STORE_SALES = 'STORE_SALES',
  FUEL_SALES = 'FUEL_SALES',
  INVOICE_EXPENSE = 'INVOICE_EXPENSE',
  PAID_OUT = 'PAID_OUT',
  UNKNOWN = 'UNKNOWN',
}

export enum PendingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum UserRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
}

export enum SendMethod {
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

// Extraction schemas
export interface OrderRequestExtraction {
  order_batch_id: string;
  vendor_groups: Array<{
    vendor: string;
    items: Array<{
      name: string;
      qty: number;
      unit: string;
    }>;
  }>;
}

export interface InvoiceExpenseExtraction {
  vendor: string;
  amount: number;
  invoice_date: string;
  invoice_number?: string;
  category: string;
  paid: 'Y' | 'N';
}

export interface StoreSalesExtraction {
  date: string;
  cash: number;
  card: number;
  tax: number;
  total_inside: number;
}

export interface FuelSalesExtraction {
  date: string;
  gallons: number;
  fuel_sales: number;
  fuel_gp: number;
}

export interface PaidOutExtraction {
  date: string;
  amount: number;
  reason: string;
  employee: string;
}

export interface ExtractionResult {
  fields: Record<string, any>;
  confidence: number;
  raw_text: string;
  source_media_url?: string;
  extraction_notes?: string;
}

export interface ClassificationResult {
  type: ClassificationType;
  confidence: number;
}

