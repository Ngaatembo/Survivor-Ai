export interface PaymentProviderStatus {
  provider: 'ECOCASH';
  configured: boolean;
  mode: 'SANDBOX' | 'PRODUCTION' | 'NOT_CONFIGURED';
  canReceive: boolean;
  canSend: boolean;
  note: string;
}

/**
 * Provider-neutral payment boundary.
 *
 * Treasury owns authorization and accounting. This adapter is deliberately
 * conservative: until the exact production API contract and merchant
 * permissions are configured, it never sends money.
 */
export interface PaymentProvider {
  status(): PaymentProviderStatus;
  receivePayment?(): Promise<never>;
  sendPayment?(): Promise<never>;
}

export function ecoCashStatus(config: {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
}): PaymentProviderStatus {
  const configured = Boolean(config.baseUrl && config.clientId && config.clientSecret);
  const mode = !configured
    ? 'NOT_CONFIGURED'
    : /sandbox|test/i.test(config.baseUrl ?? '')
      ? 'SANDBOX'
      : 'PRODUCTION';

  return {
    provider: 'ECOCASH',
    configured,
    mode,
    // Receiving can be wired once the merchant collection endpoint and
    // account permissions are confirmed from the developer account.
    canReceive: false,
    // Sending is intentionally disabled until outbound payment permissions
    // and the exact API contract are verified.
    canSend: false,
    note: configured
      ? 'Credentials are present in the Worker, but payment execution is disabled until the EcoCash API contract and merchant permissions are verified.'
      : 'Register/configure the EcoCash Developer Portal credentials as Worker secrets.',
  };
}
