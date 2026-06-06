/**
 * SYNC: keep in sync with /lib/metaWhatsAppGroups.ts
 */
import axios from 'axios';

const V = 'v22.0';

export type CreateWhatsAppGroupParams = {
  phoneNumberId: string;
  accessToken: string;
  subject: string;
  description?: string;
  joinApprovalMode?: 'auto_approve' | 'approval_required';
};

export async function createWhatsAppGroup(
  params: CreateWhatsAppGroupParams
): Promise<{ requestId: string | null; raw: unknown }> {
  const url = `https://graph.facebook.com/${V}/${params.phoneNumberId}/groups`;
  const { data } = await axios.post<Record<string, unknown>>(
    url,
    {
      messaging_product: 'whatsapp',
      subject: params.subject.trim(),
      ...(params.description?.trim() ? { description: params.description.trim() } : {}),
      join_approval_mode: params.joinApprovalMode ?? 'auto_approve',
    },
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const requestId =
    (typeof data?.request_id === 'string' && data.request_id) ||
    (typeof (data as { data?: { request_id?: string } })?.data?.request_id === 'string' &&
      (data as { data: { request_id: string } }).data.request_id) ||
    null;

  return { requestId, raw: data };
}
