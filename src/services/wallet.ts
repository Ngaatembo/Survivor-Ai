/* ============================================================================
 * SURVIVE AI — Simulated wallet service
 * ----------------------------------------------------------------------------
 * Balance is NEVER stored or mutated directly. It is always derived from the
 * transaction ledger (starting DEPOSIT + sum of signed amounts). Every balance
 * change appends an immutable transaction record with balanceAfter.
 *
 * This is a SIMULATION: no payment connector exists (see connectors.ts).
 * ========================================================================== */

import type { Transaction, TransactionType } from '../types';
import { uid } from '../lib/format';

export function balanceFrom(transactions: Transaction[]): number {
  return Math.round(transactions.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;
}

export interface LedgerEntry {
  type: TransactionType;
  amount: number; // signed: positive into wallet, negative out
  description: string;
  relatedExperimentId?: string;
}

/** Append a transaction, computing balanceAfter from the ledger. */
export function record(
  transactions: Transaction[],
  entry: LedgerEntry,
  createdAt: number = Date.now(),
): Transaction[] {
  const balanceAfter =
    Math.round((balanceFrom(transactions) + entry.amount) * 100) / 100;
  const tx: Transaction = {
    id: uid('tx'),
    type: entry.type,
    amount: entry.amount,
    description: entry.description,
    relatedExperimentId: entry.relatedExperimentId,
    balanceAfter,
    createdAt,
  };
  return [...transactions, tx];
}

/** Opening deposit that seeds the simulated wallet. */
export function openingLedger(startingCapital: number): Transaction[] {
  const tx: Transaction = {
    id: 'tx-opening-deposit',
    type: 'DEPOSIT',
    amount: startingCapital,
    description: 'Initial simulated capital grant (no real money)',
    balanceAfter: startingCapital,
    createdAt: Date.now(),
  };
  return [tx];
}

export function totals(transactions: Transaction[]) {
  let revenue = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (t.amount > 0 && t.type !== 'DEPOSIT') revenue += t.amount;
    if (t.amount < 0) expenses += Math.abs(t.amount);
  }
  return {
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    profit: Math.round((revenue - expenses) * 100) / 100,
  };
}
