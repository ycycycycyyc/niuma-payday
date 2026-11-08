export const MAX_SAVINGS_CENTS = 100_000_000_000;

export function localMonthKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function validCents(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAVINGS_CENTS;
}

export function isSavingsEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.month === 'string' && /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month)
    && ['CNY', 'HKD', 'USD'].includes(value.currency)
    && validCents(value.salaryCents) && value.salaryCents > 0
    && validCents(value.rentCents) && validCents(value.livingCents);
}

function snapshot({ month, currency, salaryCents, rentCents, livingCents }) {
  return { month, currency, salaryCents, rentCents, livingCents };
}

export function normalizeSavingsLedger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ledger = {};
  for (const [month, entry] of Object.entries(value)) {
    if (isSavingsEntry(entry) && month === entry.month) ledger[month] = snapshot(entry);
  }
  return ledger;
}

export function sameSavingsEntry(left, right) {
  if (!left || !right) return left === right;
  return left.month === right.month && left.currency === right.currency
    && left.salaryCents === right.salaryCents && left.rentCents === right.rentCents
    && left.livingCents === right.livingCents;
}

export function netSavings(entry) {
  return entry.salaryCents - entry.rentCents - entry.livingCents;
}

export function recordSavingsEntry(state, entry, previous, now = new Date()) {
  if (!state?.configured) throw new Error('[SAVINGS_UNCONFIGURED] 请先设置真实月薪，再记录存款。');
  if (!isSavingsEntry(entry)) throw new Error('[SAVINGS_INVALID] 请检查月份、币种和金额。');
  if (entry.month > localMonthKey(now)) throw new Error('[SAVINGS_FUTURE] 只能记录本月或以前的月份。');
  if (previous !== null && (!isSavingsEntry(previous) || previous.month !== entry.month)) {
    throw new Error('[SAVINGS_INVALID] 原记录与所选月份不一致。');
  }
  const ledger = state.savings ?? {};
  const current = ledger[entry.month] ?? null;
  if (sameSavingsEntry(current, entry)) return ledger;
  if (!sameSavingsEntry(current, previous)) {
    throw new Error('[SAVINGS_CONFLICT] 这个月的记录已更新，请重新打开该月后修改。');
  }
  return { ...ledger, [entry.month]: snapshot(entry) };
}
