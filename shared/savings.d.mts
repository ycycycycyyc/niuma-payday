export type SavingsEntry = {
  month: string;
  currency: 'CNY' | 'HKD' | 'USD';
  salaryCents: number;
  rentCents: number;
  livingCents: number;
};
export type SavingsLedger = Record<string, SavingsEntry>;

export const MAX_SAVINGS_CENTS: number;
export function localMonthKey(date?: Date): string;
export function isSavingsEntry(value: unknown): value is SavingsEntry;
export function normalizeSavingsLedger(value: unknown): SavingsLedger;
export function sameSavingsEntry(left: SavingsEntry | null, right: SavingsEntry | null): boolean;
export function netSavings(entry: SavingsEntry): number;
export function recordSavingsEntry(
  state: { configured: boolean; savings?: SavingsLedger } | null,
  entry: SavingsEntry, previous: SavingsEntry | null, now?: Date,
): SavingsLedger;
export function removeSavingsEntry(
  state: { configured: boolean; savings?: SavingsLedger } | null,
  previous: SavingsEntry,
): SavingsLedger;
export function savingsLedgerCSV(ledger: SavingsLedger, currentMonth?: string, currency?: SavingsEntry['currency']): string;
