import type { VercelRequest, VercelResponse } from '@vercel/node';

type LogData = Record<string, unknown>;

type LastRequest = { fn: string; method: string; path: string; started: number };

let lastRequest: LastRequest | null = null;
let hooked = false;

const SECRET = /authorization|cookie|token|password|secret|api[-_]?key|bearer/i;

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: LogData = {};
  for (const [key, item] of Object.entries(value as LogData)) {
    out[key] = SECRET.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

/** Stack, Axios status/body, and cause — never tokens or passwords. */
export function serializeError(error: unknown): LogData {
  if (error == null) return { message: 'unknown error' };
  if (!(error instanceof Error)) return { message: String(error) };

  const axiosResponse = (error as Error & { response?: { status?: number; data?: unknown } }).response;
  const cause = (error as Error & { cause?: unknown }).cause;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(axiosResponse
      ? { httpStatus: axiosResponse.status, httpBody: redact(axiosResponse.data) }
      : {}),
    ...(cause != null ? { cause: serializeError(cause) } : {}),
  };
}

function line(event: string, data: LogData): string {
  return JSON.stringify({
    src: 'opsai',
    event,
    t: new Date().toISOString(),
    ...(lastRequest
      ? { fn: lastRequest.fn, method: lastRequest.method, path: lastRequest.path, ranMs: Date.now() - lastRequest.started }
      : {}),
    ...data,
  });
}

/** One JSON line in Vercel Runtime Logs. Never put tokens, passwords, or message bodies here. */
export function logApp(event: string, data: LogData = {}): void {
  console.log(line(event, data));
}

export function logAppError(event: string, data: LogData = {}): void {
  console.error(line(event, data));
}

/** Log crashes that Vercel otherwise only shows as a bare EXIT. */
export function hookProcessErrors(): void {
  if (hooked) return;
  hooked = true;

  process.on('uncaughtException', (error) => {
    logAppError('process.uncaughtException', serializeError(error));
  });
  process.on('unhandledRejection', (reason) => {
    logAppError('process.unhandledRejection', serializeError(reason));
  });
  process.on('beforeExit', (code) => {
    if (code === 0) return;
    logAppError('process.beforeExit', { code });
  });
  process.on('exit', (code) => {
    // Sync only. Skip code 0 — Vercel isolates exit after every request.
    if (code === 0) return;
    console.error(line('process.exit', { code, detail: 'abnormal' }));
  });
}

hookProcessErrors();

export function maskPhone(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

/** Call at the top of a Vercel handler so each invocation shows start and status. */
export function attachRequestLog(fn: string, req: VercelRequest, res: VercelResponse): void {
  hookProcessErrors();
  const started = Date.now();
  const method = req.method || '?';
  const path = String(req.url || '').split('?')[0];
  lastRequest = { fn, method, path, started };
  logApp('http.start', { fn, method, path });
  const done = () => {
    const status = res.statusCode;
    const payload = { fn, method, path, status, ms: Date.now() - started };
    if (status >= 500) logAppError('http.done', payload);
    else logApp('http.done', payload);
  };
  if (typeof res.once === 'function') res.once('finish', done);
}

type ApiHandler = (req: VercelRequest, res: VercelResponse) => void | Promise<void>;

/** Wrap a handler so thrown errors get a stack in logs instead of a blank EXIT. */
export function loggedHandler(fn: string, handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    attachRequestLog(fn, req, res);
    try {
      await handler(req, res);
    } catch (error) {
      logAppError('http.crash', { fn, method: req.method, path: String(req.url || '').split('?')[0], ...serializeError(error) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
  };
}
