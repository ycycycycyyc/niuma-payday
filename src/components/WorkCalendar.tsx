import { memo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { classifyDay, dateKey } from '../../shared/calendar.mjs';
import { applyDayOverridePatch, dayOverridePatch, type DayOverridePatch } from '../lib/salary';
import { currencySymbol, money } from '../lib/clock';
import type { AppState } from '../lib/store';
import './work-calendar.css';

type Props = {
  state: AppState;
  onSave: (patch: DayOverridePatch, expected: DayOverridePatch) => Promise<void>;
};
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const fullDate = (date: Date) => date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

function dayCaption(date: Date, state: AppState, overrides: AppState['settings']['dayOverrides']) {
  const key = dateKey(date);
  if (overrides[key]) return overrides[key] === 'work' ? '手动上班' : '手动休息';
  const classification = classifyDay(date, { ...state.settings, dayOverrides: overrides }, state.calendar);
  if (classification.holiday) return classification.holiday;
  const makeup = state.calendar[`${state.settings.region}-${date.getFullYear()}`]?.makeupWorkdays[key];
  if (!classification.working) return makeup ? '调休 · 默认休息' : '休息';
  return classification.known ? '上班' : '上班 · 估算';
}

/** The draft carries only date changes; unrelated or newly synced dates survive saving. */
function WorkCalendar({ state, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [original, setOriginal] = useState(() => ({ ...state.settings.dayOverrides }));
  const [draft, setDraft] = useState(() => ({ ...state.settings.dayOverrides }));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const patch = dayOverridePatch(original, draft);
  const changedDates = Object.keys(patch);
  const merged = open ? applyDayOverridePatch(state.settings.dayOverrides, patch) : state.settings.dayOverrides;
  const settings = { ...state.settings, dayOverrides: merged };
  const todayKey = dateKey(new Date());
  const monthTitle = month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const days = open ? Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)) : [];
  const previewDays = days.filter(date => classifyDay(date, settings, state.calendar).working).length;
  const originalDays = days.filter(date => classifyDay(date, state.settings, state.calendar).working).length;
  const calendarKnown = days.every(date => classifyDay(date, settings, state.calendar).known);
  const dailySalary = previewDays ? state.settings.monthlySalary / previewDays : 0;
  const [year, selectedMonth, day] = selected.split('-').map(Number);
  const selectedDate = new Date(year, selectedMonth - 1, day);
  const selectedOverride = merged[selected] ?? null;
  const selectedClass = classifyDay(selectedDate, settings, state.calendar);
  const originalChanged = JSON.stringify(state.settings.dayOverrides) !== JSON.stringify(original);

  function toggle() {
    if (submitting.current) return;
    if (!open) {
      const now = new Date();
      setMonth(startOfMonth(now));
      setSelected(dateKey(now));
      setOriginal({ ...state.settings.dayOverrides });
      setDraft({ ...state.settings.dayOverrides });
      setError('');
      setMessage('');
    }
    setOpen(!open);
  }

  function selectMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    if (next.getFullYear() < 2000 || next.getFullYear() > 2199) return;
    setMonth(next);
    setSelected(dateKey(next));
  }

  function choose(value: 'work' | 'rest' | null) {
    setDraft(previous => {
      const next = { ...previous };
      if (value === null) delete next[selected];
      else next[selected] = value;
      return next;
    });
    setError('');
  }

  function dayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    if (next.getFullYear() < 2000 || next.getFullYear() > 2199) return;
    setMonth(startOfMonth(next));
    setSelected(dateKey(next));
    requestAnimationFrame(() => dayButtons.current.get(dateKey(next))?.focus());
  }

  async function save() {
    if (submitting.current || !changedDates.length) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const expected = Object.fromEntries(changedDates.map(key => [key, original[key] ?? null])) as DayOverridePatch;
    try {
      await onSave(patch, expected);
      setOpen(false);
      setMessage(`已保存 ${changedDates.length} 天的排班安排。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '排班保存失败，你的修改已保留，请重试。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="work-calendar" aria-labelledby="work-calendar-title">
    <button className="work-calendar-disclosure" type="button" onClick={toggle} disabled={!state.configured || busy}
      aria-expanded={open} aria-controls="work-calendar-content">
      <span><CalendarDays size={17} aria-hidden="true" /><strong id="work-calendar-title">月度排班</strong>
        <small>{!state.configured ? '设置月薪后可安排工作日' : open ? '选择日期，安排上班或休息' : '提前安排补班、请假与休息'}</small></span>
      <span>{open && changedDates.length ? '取消并收起' : open ? '收起' : '查看月历'}<ChevronDown size={16} aria-hidden="true" /></span>
    </button>
    {message && <p className="work-calendar-success" role="status"><Check size={15} aria-hidden="true" />{message}</p>}
    {open && <div id="work-calendar-content" className="work-calendar-content">
      <div className="work-calendar-toolbar">
        <div className="work-calendar-month"><button className="icon-button" type="button" aria-label="上个月" onClick={() => selectMonth(-1)}
          disabled={busy || month.getFullYear() === 2000 && month.getMonth() === 0}><ChevronLeft size={19} /></button>
          <h3 aria-live="polite">{monthTitle}</h3><button className="icon-button" type="button" aria-label="下个月" onClick={() => selectMonth(1)}
            disabled={busy || month.getFullYear() === 2199 && month.getMonth() === 11}><ChevronRight size={19} /></button></div>
        <button className="text-button" type="button" disabled={busy} onClick={() => { const now = new Date(); setMonth(startOfMonth(now)); setSelected(dateKey(now)); }}>回到本月</button>
      </div>
      <p className="work-calendar-summary" aria-live="polite">{previewDays} 个计薪日{previewDays !== originalDays && <span>（原为 {originalDays} 天）</span>}
        <span>参考日薪 {state.privacy ? '••••' : `${currencySymbol(state.settings.currency)}${money(dailySalary)}`}</span>
        {!calendarKnown && <small>假日日历暂缺，按周一至周五估算</small>}</p>
      <div className="work-calendar-layout">
        <div>
          <div className="work-calendar-weekdays" aria-hidden="true">{weekdays.map(label => <span key={label}>{label}</span>)}</div>
          <div className="work-calendar-days" role="group" aria-label={`${monthTitle}每日安排`}>
            {Array.from({ length: (month.getDay() + 6) % 7 }, (_, index) => <span className="work-calendar-blank" key={`blank-${index}`} aria-hidden="true" />)}
            {days.map(date => {
              const key = dateKey(date);
              const classification = classifyDay(date, settings, state.calendar);
              const caption = dayCaption(date, state, merged);
              return <button key={key} ref={node => { if (node) dayButtons.current.set(key, node); else dayButtons.current.delete(key); }}
                type="button" className={`work-calendar-day ${classification.working ? 'is-work' : 'is-rest'} ${merged[key] ? 'is-manual' : ''} ${key === todayKey ? 'is-today' : ''} ${Object.hasOwn(patch, key) ? 'is-changed' : ''}`}
                aria-label={`${fullDate(date)}，${caption}`} aria-pressed={selected === key} aria-current={key === todayKey ? 'date' : undefined}
                disabled={busy} onClick={() => setSelected(key)} onKeyDown={event => dayKeyDown(event, date)}>
                <strong>{date.getDate()}</strong><small>{caption}</small>{Object.hasOwn(patch, key) && <i aria-hidden="true" />}
              </button>;
            })}
          </div>
        </div>
        <div className="work-calendar-selected" aria-label="所选日期安排">
          <p className="work-calendar-selected-date">{fullDate(selectedDate)}</p>
          <strong>{dayCaption(selectedDate, state, merged)}</strong>
          <p>{selectedOverride ? '此日期采用手动安排。' : selectedClass.holiday ? '所选地区的公共假日。' : selectedClass.working ? '按日历安排上班。' : '按日历安排休息。'}</p>
          <div className="work-calendar-choices">
            <button type="button" disabled={busy} aria-pressed={selectedOverride === 'work'} onClick={() => choose('work')}>这天上班</button>
            <button type="button" disabled={busy} aria-pressed={selectedOverride === 'rest'} onClick={() => choose('rest')}>这天休息</button>
            <button type="button" disabled={busy} aria-pressed={selectedOverride === null} onClick={() => choose(null)}><RotateCcw size={14} aria-hidden="true" />恢复日历</button>
          </div>
          <p className="work-calendar-note">周末含调休补班默认休息；需要补班时单独设为上班。跨夜班次归属开始上班的日期。</p>
        </div>
      </div>
      <p className="work-calendar-note">修改排班会重新计算对应月份的参考日薪与预估收入，已记入的月度存钱记录保留原快照。</p>
      {originalChanged && <p className="work-calendar-sync" role="status">排班已从其他窗口更新。未修改的日期会保留最新安排，保存时将核对所改日期。</p>}
      {error && <p className="work-calendar-error" role="alert">{error}</p>}
      <footer className="work-calendar-footer"><span>{changedDates.length ? `已修改 ${changedDates.length} 天，保存后生效` : '选择日期后可调整安排'}</span>
        <div><button className="button secondary" type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>取消修改</button>
          <button className="button primary" type="button" disabled={busy || !changedDates.length} onClick={() => void save()}>{busy ? '保存中…' : '保存排班'}</button></div></footer>
    </div>}
  </section>;
}

export default memo(WorkCalendar);
