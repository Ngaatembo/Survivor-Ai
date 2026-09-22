export interface FinivexConfig {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface FinivexStatus {
  provider: 'FINIVEX';
  configured: boolean;
  canCreatePaymentLinks: boolean;
  canCheckStatus: boolean;
  note: string;
}

export interface FinivexPaymentLinkInput {
  amount: number;
  currency: 'USD' | 'ZWG';
  description?: string;
  customerEmail?: string;
  customerPhone?: string;
  redirectUrl?: string;
  expiresInMinutes?: number;
}

export interface FinivexPaymentLinkResult {
  ok: boolean;
  httpStatus: number;
  body: unknown;
}

const DEFAULT_BASE_URL = 'https://gateway.finivex.online/api/pg';

export function finivexStatus(config: FinivexConfig): FinivexStatus {
  const configured = Boolean(config.apiKey && config.apiSecret);
  return {
    provider: 'FINIVEX',
    configured,
    canCreatePaymentLinks: configured,
    canCheckStatus: configured,
    note: configured
      ? 'Finivex server-side credentials are configured. Payment-link creation remains human-approved; Survivor never transfers funds.'
      : 'Create/approve a Finivex merchant account, then configure FINIVEX_API_KEY and FINIVEX_API_SECRET as Worker secrets.',
  };
}

function headers(config: FinivexConfig): HeadersInit {
  if (!config.apiKey || !config.apiSecret) throw new Error('Finivex API credentials are incomplete');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-Key': config.apiKey,
    'X-API-Secret': config.apiSecret,
  };
}

async function readBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return await response.text(); }
}

export async function createFinivexPaymentLink(
  config: FinivexConfig,
  input: FinivexPaymentLinkInput,
): Promise<FinivexPaymentLinkResult> {
  if (!input.amount || !Number.isFinite(input.amount) || input.amount <= 0) throw new Error('amount must be greater than 0');
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/payments/payment-link`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(input),
  });
  return { ok: response.ok, httpStatus: response.status, body: await readBody(response) };
}

export async function getFinivexPaymentStatus(
  config: FinivexConfig,
  transactionId: string,
): Promise<FinivexPaymentLinkResult> {
  if (!transactionId.trim()) throw new Error('transactionId is required');
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/payments/status?transactionId=${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    headers: headers(config),
  });
  return { ok: response.ok, httpStatus: response.status, body: await readBody(response) };
}
