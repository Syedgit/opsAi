import { logApp, logAppError, serializeError } from '../requestLog';

export type EmailConfig = {
  apiKey: string;
  from: string;
  ready: boolean;
};

export function emailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const apiKey = env.RESEND_API_KEY?.trim() || '';
  const from = env.EMAIL_FROM?.trim() || '';
  return { apiKey, from, ready: Boolean(apiKey && from) };
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

/** Transactional send via Resend HTTP API (no SDK dependency). */
export async function sendEmail(
  input: SendEmailInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SendEmailResult> {
  const cfg = emailConfig(env);
  if (!cfg.ready) return { ok: false, error: 'Email is not configured (RESEND_API_KEY / EMAIL_FROM).' };
  const to = (Array.isArray(input.to) ? input.to : [input.to])
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.includes('@'));
  if (to.length === 0) return { ok: false, error: 'No recipient email.' };

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: { message?: string } };
    if (!res.ok) {
      const err = body.error?.message || body.message || `Resend HTTP ${res.status}`;
      logAppError('email.send', { error: err, status: res.status });
      return { ok: false, error: err };
    }
    logApp('email.send', { to: to.length, id: body.id || null });
    return { ok: true, id: body.id || null };
  } catch (error: unknown) {
    logAppError('email.send', serializeError(error));
    return { ok: false, error: 'Email send failed.' };
  }
}
