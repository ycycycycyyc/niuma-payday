import type { CSSProperties } from 'react';
import { calculateSalary, type SalarySettings } from '../lib/salary';
import { currencySymbol, money, useClock } from '../lib/clock';
import type { CalendarCache } from '../../shared/calendar.mjs';
export default function LiveAmount({ settings, demo, privacy = false, compact = false, calendar = {} }: { settings: SalarySettings; demo: boolean; privacy?: boolean; compact?: boolean; calendar?: CalendarCache }) {
  const now = useClock(demo, 150);
  const salary = calculateSalary(settings, now, calendar);
  const [integer, decimal] = money(salary.todayEarned).split('.');
  return <div className={`live-amount ${compact ? 'compact' : ''}`} style={{ '--amount-chars': privacy ? 4 : integer.length } as CSSProperties} aria-label={privacy ? '金额已隐藏' : `今日预估收入 ${currencySymbol(settings.currency)} ${money(salary.todayEarned)}`}>
    <span className="currency">{currencySymbol(settings.currency)}</span>
    <span className="amount-integer">{privacy ? '••••' : integer}</span>
    {!privacy && <span className="amount-decimal">.{decimal}</span>}
  </div>;
}
