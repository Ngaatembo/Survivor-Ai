import type { Transaction, TransactionType } from '../types';

export type TreasurySpendDecision = 'AUTO' | 'APPROVAL' | 'BLOCKED';

export interface TreasuryPolicy {
  currency: string;
  protectedReserve: number;
  autonomousDailyLimit: number;
  autonomousPerTransactionLimit: number;
  approvalPerTransactionLimit: number;
  allowedVendors: string[];
  blockedCategories: string[];
  realMoneyExecutionEnabled: boolean;
  emergencyFrozen: boolean;
}

export interface TreasurySnapshot {
  balance: number;
  ownerCapital: number;
  revenue: number;
  expenses: number;
  refunds: number;
  profit: number;
  protectedReserve: number;
  availableToSpend: number;
  autonomousSpentToday: number;
  autonomousRemainingToday: number;
  policy: TreasuryPolicy;
}

export interface SpendRequest {
  id: string;
  vendor: string;
  amount: number;
  purpose: string;
  category: string;
  opportunityId?: string;
  expectedRevenue?: number;
  maxLoss?: number;
  evidence?: string;
  decision: TreasurySpendDecision;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECORDED';
  createdAt: number;
  reviewedAt?: number;
  note?: string;
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  currency: 'USD',
  protectedReserve: 25,
  autonomousDailyLimit: 5,
  autonomousPerTransactionLimit: 2,
  approvalPerTransactionLimit: 10,
  allowedVendors: [
    'openai',
    'anthropic',
    'tavily',
    'brave',
    'cloudflare',
    'vercel',
    'github',
    'namecheap',
    'porkbun',
    'google',
    'meta',
  ],
  blockedCategories: ['gambling', 'crypto', 'weapons', 'adult', 'money-transfer', 'speculative-trading'],
  realMoneyExecutionEnabled: false,
  emergencyFrozen: false,
};

export function calculateTreasurySnapshot(
  transactions: Transaction[],
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
  now = Date.now(),
): TreasurySnapshot {
  const balance = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const ownerCapital = transactions
    .filter((tx) => tx.type === 'DEPOSIT')
    .reduce((sum, tx) => sum + Math.max(0, tx.amount), 0);
  const revenue = transactions
    .filter((tx) => tx.type === 'REVENUE')
    .reduce((sum, tx) => sum + Math.max(0, tx.amount), 0);
  const expenses = transactions
    .filter((tx) => tx.type === 'EXPENSE')
    .reduce((sum, tx) => sum + Math.max(0, -tx.amount), 0);
  const refunds = transactions
    .filter((tx) => tx.type === 'REFUND')
    .reduce((sum, tx) => sum + Math.max(0, tx.amount), 0);
  const profit = revenue + refunds - expenses;
  const today = new Date(now);
  const dayKey = today.toISOString().slice(0, 10);
  const autonomousSpentToday = transactions
    .filter((tx) => tx.type === 'EXPENSE' && new Date(tx.createdAt).toISOString().slice(0, 10) === dayKey && tx.description.includes('[AUTO]'))
    .reduce((sum, tx) => sum + Math.max(0, -tx.amount), 0);

  return {
    balance,
    ownerCapital,
    revenue,
    expenses,
    refunds,
    profit,
    protectedReserve: policy.protectedReserve,
    availableToSpend: Math.max(0, balance - policy.protectedReserve),
    autonomousSpentToday,
    autonomousRemainingToday: Math.max(0, policy.autonomousDailyLimit - autonomousSpentToday),
    policy,
  };
}

export function authorizeSpend(
  request: Pick<SpendRequest, 'vendor' | 'amount' | 'category'>,
  snapshot: TreasurySnapshot,
): TreasurySpendDecision {
  const vendor = request.vendor.trim().toLowerCase();
  const category = request.category.trim().toLowerCase();

  if (snapshot.policy.emergencyFrozen || !snapshot.policy.realMoneyExecutionEnabled) return 'BLOCKED';
  if (snapshot.balance - request.amount < snapshot.protectedReserve) return 'BLOCKED';
  if (snapshot.policy.blockedCategories.some((x) => category.includes(x))) return 'BLOCKED';
  if (request.amount <= 0 || !Number.isFinite(request.amount)) return 'BLOCKED';

  const vendorAllowed = snapshot.policy.allowedVendors.some((x) => vendor === x || vendor.includes(x));
  if (
    vendorAllowed &&
    request.amount <= snapshot.policy.autonomousPerTransactionLimit &&
    request.amount <= snapshot.autonomousRemainingToday
  ) {
    return 'AUTO';
  }

  if (request.amount <= snapshot.policy.approvalPerTransactionLimit) return 'APPROVAL';
  return 'BLOCKED';
}

/**
 * During Treasury v1, no code path sends money. This helper only creates an
 * auditable EXPENSE ledger entry after an already-authorized real-world payment
 * has been confirmed by the operator/provider.
 */
export function createConfirmedExpense(
  request: SpendRequest,
  transactions: Transaction[],
  now = Date.now(),
): Transaction {
  if (request.status !== 'APPROVED') throw new Error('spend request must be approved before recording an expense');
  if (request.amount <= 0) throw new Error('expense amount must be positive');
  const balanceBefore = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const balanceAfter = balanceBefore - request.amount;
  return {
    id: `tx_${crypto.randomUUID()}`,
    type: 'EXPENSE' as TransactionType,
    amount: -request.amount,
    description: `[TREASURY] [${request.decision}] ${request.vendor}: ${request.purpose}`,
    relatedExperimentId: request.opportunityId,
    balanceAfter,
    createdAt: now,
  };
}
