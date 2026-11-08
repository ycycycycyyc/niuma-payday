import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SAVINGS_CENTS, localMonthKey, netSavings, normalizeSavingsLedger, recordSavingsEntry,
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
