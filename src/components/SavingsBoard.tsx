import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, NotebookPen, Pencil, PiggyBank, Plus, X } from 'lucide-react';
import { MAX_SAVINGS_CENTS, netSavings, type SavingsEntry } from '../../shared/savings.mjs';
import { currencySymbol, money } from '../lib/clock';
import { describeDesktopError } from '../lib/desktop-error';
import type { AppState } from '../lib/store';
import './savings.css';

type Currency = SavingsEntry['currency'];
type AllocationField = 'living' | 'saving';
type BoardProps = {
  state: AppState;
  currentMonth: string;
  onConfigure: () => void;
  onSave: (entry: SavingsEntry, previous: SavingsEntry | null) => Promise<void>;
};
const currencyNames: Record<Currency, string> = { CNY: '人民币', HKD: '港币', USD: '美元' };
const hiddenAmount = '••••';
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const amountLabel = (cents: number, currency: Currency) => `${cents < 0 ? '−' : ''}${currencySymbol(currency)}${money(Math.abs(cents) / 100)}`;
// Earlier profiles can contain fractional cents. Use decimal rounding before snapshotting a monthly salary.
const salaryInput = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });

function previousBudget(ledger: AppState['savings'], month: string, currency: Currency) {
  return Object.values(ledger).filter(entry => entry.month < month && entry.currency === currency)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
}

function blankDraft(state: AppState, month: string) {
  const previous = state.savings[month] ?? null;
  const currency = previous?.currency ?? state.settings.currency;
  const budget = previous ?? previousBudget(state.savings, month, currency);
  return {
    month, previous, currency,
    salary: previous ? String(previous.salaryCents / 100) : salaryInput.format(state.settings.monthlySalary),
    rent: budget ? String(budget.rentCents / 100) : '',
    allocationField: 'living' as AllocationField,
    allocation: budget ? String(budget.livingCents / 100) : '',
  };
}

function parseCents(value: string, min: number) {
  const match = /^(-?)(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/.exec(value.trim());
  if (!match) return null;
  const absolute = Number(match[2] ?? 0) * 100 + Number((match[3] ?? match[4] ?? '').padEnd(2, '0'));
  const cents = match[1] === '-' ? -absolute : absolute;
  return Number.isSafeInteger(cents) && cents >= min && cents <= MAX_SAVINGS_CENTS ? cents : null;
}

function EntryDialog({ state, currentMonth, initialMonth, chooseMonth, onSave, onClose }: Omit<BoardProps, 'onConfigure'> & {
  initialMonth: string; chooseMonth: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [draft, setDraft] = useState(() => blankDraft(state, initialMonth));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNewCurrent = !draft.previous && draft.month === currentMonth;
  const currency = draft.currency;
  const salaryCents = parseCents(draft.salary, 1);
  const rentCents = parseCents(draft.rent, 0);
  const editingLiving = draft.allocationField === 'living';
  const entered = parseCents(draft.allocation, editingLiving ? 0 : -2 * MAX_SAVINGS_CENTS);
  const calculated = salaryCents !== null && rentCents !== null && entered !== null
    ? salaryCents - rentCents - entered : null;
  const livingCents = editingLiving ? entered : calculated;
  const allocationError = !editingLiving && calculated !== null && calculated < 0 ? '本月可存不能超过月薪扣除房租后的金额。'
    : !editingLiving && calculated !== null && calculated > MAX_SAVINGS_CENTS ? '按此金额计算的生活费超过 10 亿元。' : '';
  const calculatedText = calculated === null || allocationError ? '' : String(calculated / 100);
  const entry = salaryCents !== null && rentCents !== null && livingCents !== null && !allocationError
    ? { month: draft.month, currency, salaryCents, rentCents, livingCents } : null;
  const savings = entry ? netSavings(entry) : null;

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  function selectMonth(month: string) {
    setDraft(blankDraft(state, month));
    setError('');
  }
  function changeCurrency(next: Currency) {
    const budget = draft.previous?.currency === next ? draft.previous : previousBudget(state.savings, draft.month, next);
    const salary = budget ? String(budget.salaryCents / 100)
      : next === state.settings.currency ? salaryInput.format(state.settings.monthlySalary) : '';
    setDraft({ ...draft, currency: next, salary, rent: budget ? String(budget.rentCents / 100) : '',
      allocationField: 'living', allocation: budget ? String(budget.livingCents / 100) : '' });
    setError('');
  }
  function changeAmount(field: 'salary' | 'rent', value: string) {
    setDraft({ ...draft, [field]: value });
    setError('');
  }
  function changeAllocation(field: AllocationField, value: string) {
    setDraft({ ...draft, allocationField: field, allocation: value });
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month) || draft.month > currentMonth) {
      setError('请选择本月或更早的月份。');
      return;
    }
    if (isNewCurrent && salaryCents === null) {
      setError('当前月薪四舍五入后不足 0.01，请在工资设置中更新月薪。');
      return;
    }
    if (!entry) {
      if (!allocationError) setError('请填写有效金额，最多保留两位小数。月薪须大于 0，房租和生活费可为 0、上限 10 亿元。');
      return;
    }
    if (isNewCurrent && (currency !== state.settings.currency || draft.salary !== salaryInput.format(state.settings.monthlySalary))) {
      setError('工资设置已更新，请关闭此窗口并重新记入本月。');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      await onSave(entry, draft.previous);
      onClose();
    } catch (reason) {
      setError(describeDesktopError(reason, '存钱记录保存'));
      submitting.current = false;
      setBusy(false);
    }
  }

  const title = draft.previous ? '更正月度记录' : chooseMonth || draft.month < currentMonth ? '补记月份' : '记入本月';
  return <dialog className="savings-dialog" ref={dialog} aria-labelledby="savings-entry-title"
    onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <form onSubmit={submit}>
      <header>
        <div className="savings-dialog-title"><NotebookPen size={23} aria-hidden="true" /><h2 id="savings-entry-title">{title}</h2></div>
        <button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="关闭存钱记录"><X size={19} /></button>
      </header>
      <fieldset className="savings-fields" disabled={busy}>
        <label>月份<input type="month" value={draft.month} max={currentMonth} required readOnly={!chooseMonth}
          onChange={event => selectMonth(event.target.value)} /></label>
        <label>币种<select aria-label="币种" value={currency} disabled={isNewCurrent} onChange={event => changeCurrency(event.target.value as Currency)}>
          {Object.entries(currencyNames).map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}
        </select></label>
        <label>月薪<input type="number" value={draft.salary} min="0.01" step="0.01" max="1000000000"
          inputMode="decimal" required readOnly={isNewCurrent} onChange={event => changeAmount('salary', event.target.value)} /></label>
        <label>房租<input type="number" inputMode="decimal" value={draft.rent} min="0" step="0.01" max="1000000000"
          required placeholder="填写金额" onChange={event => changeAmount('rent', event.target.value)} /></label>
        <div className="savings-allocation">
          <label>生活费<input type="text" inputMode="decimal" value={editingLiving ? draft.allocation : calculatedText}
            placeholder="填写金额" onChange={event => changeAllocation('living', event.target.value)} /></label>
          <label>本月可存<input type="text" inputMode="decimal" value={editingLiving ? calculatedText : draft.allocation}
            placeholder="填写金额" aria-invalid={Boolean(allocationError)} aria-describedby={allocationError ? 'savings-error' : undefined}
            onChange={event => changeAllocation('saving', event.target.value)} /></label>
        </div>
      </fieldset>
      {savings !== null && savings < 0 && <p className="savings-overspend" role="status">本月超支 <strong>{amountLabel(-savings, currency)}</strong></p>}
      {(allocationError || error) && <p id="savings-error" role="alert" className="savings-error">{allocationError || error}</p>}
      <footer><button className="button secondary" type="button" onClick={onClose} disabled={busy}>取消</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? '保存中…' : draft.previous ? '保存更正' : '确认记入'}<ArrowUpRight size={16} /></button></footer>
    </form>
  </dialog>;
}

function SavingsBoard({ state, currentMonth, onConfigure, onSave }: BoardProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const [editor, setEditor] = useState<{ month: string; chooseMonth: boolean } | null>(null);
  const [details, setDetails] = useState(false);
  const sorted = Object.values(state.savings).filter(entry => entry.month <= currentMonth)
    .sort((a, b) => b.month.localeCompare(a.month));
  const current = state.savings[currentMonth];
  const budgetCurrency = current?.currency ?? state.settings.currency;
  const currencies = Array.from(new Set([budgetCurrency, state.settings.currency, ...sorted.map(entry => entry.currency)]));
  const currency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : budgetCurrency;
  const currencyMonths = sorted.filter(entry => entry.currency === currency);
  const total = currencyMonths.reduce((sum, entry) => sum + netSavings(entry), 0);
  const budget = current ?? previousBudget(state.savings, currentMonth, budgetCurrency);
  const salary = current?.salaryCents ?? (state.configured ? parseCents(salaryInput.format(state.settings.monthlySalary), 0) : null);
  const net = salary !== null && budget ? salary - budget.rentCents - budget.livingCents : null;
  const label = (cents: number | null | undefined, code: Currency) => state.privacy ? hiddenAmount
    : cents == null ? '—' : amountLabel(cents, code);
  const monthCount = currencyMonths.length;
  const canEdit = state.configured && !state.privacy;
  useEffect(() => { if (!canEdit) setEditor(null); }, [canEdit]);
  function openHistoryEditor() {
    const [year, month] = currentMonth.split('-').map(Number);
    const lastMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    setEditor({ month: lastMonth, chooseMonth: true });
  }
  async function save(entry: SavingsEntry, previous: SavingsEntry | null) {
    await onSave(entry, previous);
    setSelectedCurrency(entry.currency);
  }

  return <section id="savings-board" className="savings-board" aria-labelledby="savings-title">
    <header className="savings-board-header">
      <h2 id="savings-title"><span className="savings-icon"><PiggyBank size={22} strokeWidth={1.7} aria-hidden="true" /></span>存钱记录板</h2>
      {currencies.length > 1 ? <select className="savings-currency" aria-label="累计币种" value={currency}
        onChange={event => setSelectedCurrency(event.target.value as Currency)}>
        {currencies.map(code => <option key={code} value={code}>{currencyNames[code]} · {code}</option>)}
      </select> : <span className="savings-currency-code">{currencyNames[currency]} · {currency}</span>}
    </header>
    <div className="savings-summary">
      <div className="savings-balance"><p>累计已存</p>
        <strong data-testid="savings-total">{label(total, currency)}</strong>
        <small>{monthCount ? `已记 ${monthCount} 个月 · 最近一笔 ${monthLabel(currencyMonths[0].month)}` : '尚无入账记录'}</small>
      </div>
      <div className="savings-budget">
        <div className="savings-budget-head"><h3>{monthLabel(currentMonth)}预算</h3>
          <span>{budgetCurrency}{current ? ' · 已入账' : ' · 待入账'}</span></div>
        <dl className="savings-breakdown">
          <div><dt>房租</dt><dd>{label(budget?.rentCents, budgetCurrency)}</dd></div>
          <div><dt>生活费</dt><dd>{label(budget?.livingCents, budgetCurrency)}</dd></div>
          <div className="savings-net"><dt>{!state.privacy && net !== null && net < 0 ? '本月超支' : '本月可存'}</dt>
            <dd>{label(net === null ? null : Math.abs(net), budgetCurrency)}</dd></div>
        </dl>
        <div className="savings-budget-footer"><small>{state.privacy ? '显示金额后可记账。'
          : !state.configured ? '设置月薪后即可记账。' : `月薪 ${label(salary, budgetCurrency)}`}</small>
          {!state.privacy && <button className="button primary" onClick={() => state.configured ? setEditor({ month: currentMonth, chooseMonth: false }) : onConfigure()}>
            {state.configured ? current ? '更正本月' : '记入本月' : '前往工资设置'}<ArrowUpRight size={15} /></button>}
        </div>
      </div>
    </div>
    <div className="savings-history">
      <button type="button" className="savings-disclosure" aria-expanded={details} aria-controls="savings-history-content" onClick={() => setDetails(!details)}>
        <ChevronDown size={16} aria-hidden="true" />月度明细</button>
      {details && <div id="savings-history-content">
        {canEdit && <button className="savings-backfill" onClick={openHistoryEditor}><Plus size={14} aria-hidden="true" />补记月份</button>}
        {sorted.length ? <table className="savings-table"><thead><tr>
          <th>月份</th><th>月薪</th><th>房租</th><th>生活费</th><th>存入金额</th>{canEdit && <th><span className="sr-only">操作</span></th>}
        </tr></thead><tbody>{sorted.map(entry => <tr key={entry.month}>
          <th scope="row">{monthLabel(entry.month)}<small>{entry.currency}</small></th>
          <td data-label="月薪">{label(entry.salaryCents, entry.currency)}</td>
          <td data-label="房租">{label(entry.rentCents, entry.currency)}</td>
          <td data-label="生活费">{label(entry.livingCents, entry.currency)}</td>
          <td data-label="存入金额" className="savings-row-net">{label(netSavings(entry), entry.currency)}</td>
          {canEdit && <td className="savings-row-action"><button className="icon-button" onClick={() => setEditor({ month: entry.month, chooseMonth: false })}
            aria-label={`更正 ${monthLabel(entry.month)}的记录`}><Pencil size={15} /></button></td>}
        </tr>)}</tbody></table> : <p className="savings-history-empty">暂无月度记录。</p>}
      </div>}
    </div>
    {canEdit && editor && <EntryDialog state={state} currentMonth={currentMonth} initialMonth={editor.month} chooseMonth={editor.chooseMonth}
      onSave={save} onClose={() => setEditor(null)} />}
  </section>;
}

export default memo(SavingsBoard);
