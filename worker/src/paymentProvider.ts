export interface PaymentProviderStatus {
  provider: 'ECOCASH';
  configured: boolean;
  mode: 'SANDBOX' | 'PRODUCTION' | 'NOT_CONFIGURED';
  canReceive: boolean;
  canSend: boolean;
  note: string;
}

export interface EcoCashConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  merchantCode?: string;
  merchantPin?: string;
  merchantNumber?: string;
  webhookSecret?: string;
}

export interface EcoCashChargeInput {
  clientCorrelator: string;
  referenceCode: string;
  endUserId: string;
  amount: number;
  currency: string;
  description: string;
  notifyUrl: string;
}

export interface EcoCashChargeResult {
  ok: boolean;
  httpStatus: number;
  body: unknown;
}

const DEFAULT_BASE_URL = 'https://developers.ecocash.co.zw';

export function ecoCashStatus(config: EcoCashConfig): PaymentProviderStatus {
  const configured = Boolean(
    config.baseUrl &&
      config.username &&
      config.password &&
      config.merchantCode &&
      config.merchantPin &&
      config.merchantNumber,
  );
  const mode = !configured
    ? 'NOT_CONFIGURED'
    : /sandbox|test|developers\.ecocash\.co\.zw/i.test(config.baseUrl ?? '')
      ? 'SANDBOX'
      : 'PRODUCTION';

  return {
    provider: 'ECOCASH',
    configured,
    mode,
    // The confirmed EIP sandbox endpoint is a merchant collection/charge
    // flow. It can receive customer payments; it is not an outbound vendor
    // disbursement API.
    canReceive: configured && mode === 'SANDBOX',
    // Never infer outbound payment capability from the charge endpoint.
    canSend: false,
    note: configured
      ? mode === 'SANDBOX'
        ? 'EcoCash Instant Payment sandbox collection is configured. Real-money execution remains disabled.'
        : 'Production credentials are configured, but Survivor does not enable production execution from this adapter.'
      : 'Configure EcoCash EIP sandbox credentials as Worker secrets.',
  };
}

function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

/**
 * Calls the documented EIP sandbox charge endpoint shown in the EcoCash
 * Developer Portal. This function intentionally refuses production URLs.
 */
export async function createEcoCashSandboxCharge(
  config: EcoCashConfig,
  input: EcoCashChargeInput,
): Promise<EcoCashChargeResult> {
  if (!config.username || !config.password || !config.merchantCode || !config.merchantPin || !config.merchantNumber) {
    throw new Error('EcoCash sandbox credentials are incomplete');
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  if (!/sandbox|test|developers\.ecocash\.co\.zw/i.test(baseUrl)) {
    throw new Error('EcoCash payment execution is restricted to the sandbox endpoint');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/sandbox/payment/v1/transactions/amount/`;
  const payload = {
    clientCorrelator: input.clientCorrelator,
    referenceCode: input.referenceCode,
    tranType: 'MER',
    endUserId: input.endUserId,
    paymentAmount: {
      chargingInformation: {
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description: input.description,
      },
      chargeMetaData: { channel: 'WEB' },
    },
    merchantCode: config.merchantCode,
    merchantPin: config.merchantPin,
    merchantNumber: config.merchantNumber,
    countryCode: 'ZW',
    terminalID: 'TERM001',
    location: 'Harare',
    superMerchantName: 'EcoCash Sandbox',
    merchantName: 'Test Merchant',
    transactionOperationStatus: 'Charged',
    remarks: input.description,
    notifyUrl: input.notifyUrl,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(config.username, config.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }

  return { ok: response.ok, httpStatus: response.status, body };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * EcoCash terms require HTTPS webhook endpoints and HMAC validation.
 * The portal screenshot does not expose the exact signature header/encoding,
 * so we support common header names and both hex/base64 SHA-256 signatures.
 * If EcoCash documents a different header/encoding, only this adapter needs
 * to change.
 */
export async function verifyEcoCashWebhook(
  rawBody: string,
  headers: Headers,
  secret?: string,
): Promise<boolean> {
  if (!secret) return false;
  const signature =
    headers.get('x-ecocash-signature') ||
    headers.get('x-webhook-signature') ||
    headers.get('x-signature') ||
    headers.get('x-hmac-signature');
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const normalized = signature.replace(/^sha256=/i, '').trim();

  const expectedHex = Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (constantTimeEqual(digest, hexToBytes(normalized) ?? new Uint8Array())) return true;

  let expectedBase64 = '';
  // btoa() accepts a binary string in Workers.
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  expectedBase64 = btoa(binary);
  return constantTimeEqual(new TextEncoder().encode(expectedBase64), new TextEncoder().encode(normalized));
}
