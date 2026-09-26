/* ============================================================================
 * SURVIVE AI — independent real-revenue verification.
 *
 * A human-entered revenue record is evidence, not proof. This module defines
 * the stricter proof boundary used when a provider can independently confirm
 * the payment. It never creates or changes revenue.
 * ========================================================================== */

export type RevenueVerificationStatus = 'VERIFIED' | 'REJECTED' | 'PENDING';
export type RevenueVerificationMethod = 'FINIVEX_PROVIDER';

export interface RevenueVerificationInput {
  claimedAmount: number;
  claimedCurrency: string;
  providerStatus: string;
  providerAmount?: number;
  providerCurrency?: string;
}

export interface RevenueVerificationDecision {
  status: RevenueVerificationStatus;
  reason: string;
  verifiedAmount?: number;
  verifiedCurrency?: string;
}

export function normalizeCurrency(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function normalizeProviderStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function decideFinivexVerification(input: RevenueVerificationInput): RevenueVerificationDecision {
  const claimedAmount = Number(input.claimedAmount);
  const providerAmount = input.providerAmount;
  const claimedCurrency = normalizeCurrency(input.claimedCurrency);
  const providerCurrency = normalizeCurrency(input.providerCurrency);
  const status = normalizeProviderStatus(input.providerStatus);

  if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) {
    return { status: 'REJECTED', reason: 'claimed revenue amount must be greater than zero' };
  }

  if (status !== 'COMPLETED' && status !== 'SUCCESS' && status !== 'SUCCESSFUL' && status !== 'PAID' && status !== 'CONFIRMED') {
    if (status === 'PENDING' || status === 'PROCESSING' || status === 'INITIATED') {
      return { status: 'PENDING', reason: `provider payment is not terminal: ${status}` };
    }
    return { status: 'REJECTED', reason: `provider payment is not confirmed: ${status || 'UNKNOWN'}` };
  }

  if (providerAmount === undefined || !Number.isFinite(providerAmount)) {
    return { status: 'PENDING', reason: 'provider response did not expose a verifiable payment amount' };
  }

  if (!providerCurrency) {
    return { status: 'PENDING', reason: 'provider response did not expose a verifiable payment currency' };
  }

  if (Math.abs(providerAmount - claimedAmount) > 0.01) {
    return {
      status: 'REJECTED',
      reason: `provider amount ${providerAmount} does not match claimed amount ${claimedAmount}`,
      verifiedAmount: providerAmount,
      verifiedCurrency: providerCurrency,
    };
  }

  if (providerCurrency !== claimedCurrency) {
    return {
      status: 'REJECTED',
      reason: `provider currency ${providerCurrency} does not match claimed currency ${claimedCurrency}`,
      verifiedAmount: providerAmount,
      verifiedCurrency: providerCurrency,
    };
  }

  return {
    status: 'VERIFIED',
    reason: 'provider independently confirmed a completed payment with matching amount and currency',
    verifiedAmount: providerAmount,
    verifiedCurrency: providerCurrency,
  };
}

/** Extract common Finivex response shapes without assuming one undocumented schema. */
export function extractFinivexFacts(provider: any): {
  status: string;
  amount?: number;
  currency?: string;
} {
  const data = provider?.data ?? provider?.result ?? provider;
  const rawAmount =
    data?.amount ??
    data?.paidAmount ??
    data?.paymentAmount ??
    data?.transaction?.amount ??
    data?.payment?.amount;

  const amount = typeof rawAmount === 'number'
    ? rawAmount
    : typeof rawAmount === 'string' && rawAmount.trim() !== ''
      ? Number(rawAmount)
      : undefined;

  const currency =
    data?.currency ??
    data?.currencyCode ??
    data?.transaction?.currency ??
    data?.payment?.currency;

  const status =
    data?.status ??
    data?.paymentStatus ??
    data?.transaction?.status ??
    provider?.status ??
    '';

  return {
    status: String(status ?? ''),
    amount: Number.isFinite(amount) ? amount : undefined,
    currency: typeof currency === 'string' ? currency : undefined,
  };
}
