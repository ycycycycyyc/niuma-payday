import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SAVINGS_CENTS, localMonthKey, netSavings, normalizeSavingsLedger, recordSavingsEntry,
  removeSavingsEntry, savingsLedgerCSV,
  type SavingsEntry, type SavingsLedger,
} from '../shared/savings.mjs';

const monthEnd = new Date(2026, 11, 31, 23, 59);
const january = new Date(2027, 0, 1);
const entry: SavingsEntry = { month: '2026-12', currency: 'CNY', salaryCents: 1_000_000, rentCents: 400_000, livingCents: 200_001 };

test('monthly snapshots keep exact cents, including overspending, across a local year boundary', () => {
  assert.equal(localMonthKey(monthEnd), '2026-12');
  assert.equal(netSavings(entry), 399_999);
  const december = recordSavingsEntry({ configured: true }, entry, null, monthEnd);
  const overBudget = { ...entry, month: '2027-01', rentCents: 1_000_001 };
  assert.throws(() => recordSavingsEntry({ configured: true, savings: december }, overBudget, null, monthEnd), /SAVINGS_FUTURE/);
  const both = recordSavingsEntry({ configured: true, savings: december }, overBudget, null, january);
  assert.equal(netSavings(both[overBudget.month]), -200_002);
  assert.equal(netSavings(both[entry.month]), 399_999);
  assert.deepEqual(Object.keys(december), [entry.month]);
});

test('the same month supports idempotent retries and rejects stale corrections', () => {
  const saved = recordSavingsEntry({ configured: true }, entry, null, monthEnd);
  const state = { configured: true, savings: saved };
  assert.equal(recordSavingsEntry(state, entry, null, monthEnd), saved);
  const changed = { ...entry, livingCents: 0 };
  assert.throws(() => recordSavingsEntry(state, changed, null, monthEnd), /SAVINGS_CONFLICT/);
  const corrected = recordSavingsEntry(state, changed, entry, monthEnd);
  assert.deepEqual(corrected, { [entry.month]: changed });
  assert.throws(() => recordSavingsEntry({ configured: true, savings: corrected }, { ...changed, rentCents: 0 }, entry, monthEnd), /SAVINGS_CONFLICT/);
});

test('invalid entries and future dates cannot write, damaged stored rows do not discard other months', () => {
  const invalid = [{ month: '2026-2' }, { month: '2026-13' }, { month: '0000-01' }, { currency: 'EUR' },
    { salaryCents: 0 }, { salaryCents: Infinity }, { rentCents: 100.1 }, { livingCents: -1 }, { livingCents: MAX_SAVINGS_CENTS + 1 }];
  for (const patch of invalid) {
    assert.throws(() => recordSavingsEntry({ configured: true }, { ...entry, ...patch } as SavingsEntry, null, monthEnd), /SAVINGS_INVALID/);
  }
  assert.throws(() => recordSavingsEntry(null, entry, null, monthEnd), /SAVINGS_UNCONFIGURED/);
  const stored: SavingsLedger = { [entry.month]: entry, '2026-10': entry, '2026-11': { ...entry, month: '2026-11', salaryCents: -1 } };
  assert.deepEqual(normalizeSavingsLedger(stored), { [entry.month]: entry });
  assert.deepEqual(normalizeSavingsLedger(undefined), {});
});

test('withdrawal is idempotent, immutable, and rejects a changed monthly snapshot', () => {
  const prior = { ...entry, month: '2026-11' };
  const ledger = { [entry.month]: entry, [prior.month]: prior };
  const deleted = removeSavingsEntry({ configured: true, savings: ledger }, entry);
  assert.deepEqual(deleted, { [prior.month]: prior });
  assert.equal(ledger[entry.month], entry);
  assert.equal(removeSavingsEntry({ configured: true, savings: deleted }, entry), deleted);
  assert.throws(() => removeSavingsEntry({ configured: true, savings: ledger }, { ...entry, livingCents: 0 }), /SAVINGS_CONFLICT/);
  assert.throws(() => removeSavingsEntry(null, entry), /SAVINGS_UNCONFIGURED/);
  assert.throws(() => removeSavingsEntry({ configured: true, savings: ledger }, { ...entry, month: 'invalid' }), /SAVINGS_INVALID/);
});

test('undo restores only an empty month and cannot overwrite a newer entry', () => {
  const original = { [entry.month]: entry };
  const removed = removeSavingsEntry({ configured: true, savings: original }, entry);
  assert.deepEqual(recordSavingsEntry({ configured: true, savings: removed }, entry, null, monthEnd), original);
  const replacement = { ...entry, salaryCents: 99_999 };
  const newer = recordSavingsEntry({ configured: true, savings: removed }, replacement, null, monthEnd);
  assert.throws(() => recordSavingsEntry({ configured: true, savings: newer }, entry, null, monthEnd), /SAVINGS_CONFLICT/);
});

test('CSV contains a BOM, explicit currencies, exact signed cents and only recorded eligible months', () => {
  const overdrawn = { ...entry, month: '2026-10', currency: 'HKD' as const, salaryCents: 100, rentCents: 101, livingCents: 0 };
  const future = { ...entry, month: '2027-01' };
  const ledger = { [entry.month]: entry, [overdrawn.month]: overdrawn, [future.month]: future };
  const csv = savingsLedgerCSV(ledger, '2026-12');
  assert.equal(csv, '\uFEFF月份,币种,月薪,房租,生活费,存入金额\r\n2026-10,HKD,1.00,1.01,0.00,-0.01\r\n2026-12,CNY,10000.00,4000.00,2000.01,3999.99\r\n');
  assert.equal(savingsLedgerCSV(ledger, '2026-12', 'CNY').includes('HKD'), false);
  assert.equal(savingsLedgerCSV({}, '2026-12'), '\uFEFF月份,币种,月薪,房租,生活费,存入金额\r\n');
});
