import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarDays, Info, Sparkles, X } from 'lucide-react';
import { validateSettings, type SalarySettings } from '../lib/salary';
import { describeDesktopError } from '../lib/desktop-error';
import './settings.css';

interface SettingsModalProps {
  settings: SalarySettings;
  onSave: (settings: SalarySettings) => Promise<void> | void;
  onClose: () => void;
}

export default function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const saveErrorRef = useRef<HTMLParagraphElement>(null);
  const [draft, setDraft] = useState<SalarySettings>(() => ({ ...settings, dayOverrides: { ...settings.dayOverrides } }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, []);

  function update<K extends keyof SalarySettings>(key: K, value: SalarySettings[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setErrors(previous => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setSaveError('');
  }

  function errorFor(key: keyof SalarySettings) {
    return errors[key] ? <span className="settings-error" id={`settings-${key}-error`} role="alert">{errors[key]}</span> : null;
  }

  function fieldAccessibility(key: keyof SalarySettings) {
    return { 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `settings-${key}-error` : undefined };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors = validateSettings(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (['lunchEnabled', 'lunchStart', 'lunchEnd', 'payday'].some(key => nextErrors[key]) && advancedRef.current) {
        advancedRef.current.open = true;
      }
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    submitting.current = true;
    setBusy(true);
    setSaveError('');
    try {
      await onSave({ ...draft, dayOverrides: { ...draft.dayOverrides } });
      onClose();
    } catch (error) {
      setSaveError(describeDesktopError(error, 'save') + ' 你的输入已保留。');
      requestAnimationFrame(() => saveErrorRef.current?.focus());
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
      onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}
      onClick={event => { if (event.target === event.currentTarget && !submitting.current) onClose(); }}
    >
      <form className="settings-form" onSubmit={handleSubmit} noValidate>
        <header className="settings-header">
          <div className="settings-eyebrow"><Sparkles size={14} aria-hidden="true" /> YOUR WORK, YOUR WORTH</div>
          <button className="settings-close" type="button" aria-label="关闭设置" onClick={onClose} disabled={busy}><X size={20} /></button>
          <h2 id="settings-title">一天的努力，值多少？</h2>
          <p id="settings-description">填好日薪和上下班时间，剩下的交给我们。</p>
        </header>

        <div className="settings-body">
          <fieldset className="settings-section" disabled={busy}>
            <legend><span>01</span> 每日工资</legend>
            <div className="settings-grid settings-salary-grid">
              <div className="settings-field">
                <label htmlFor="settings-dailySalary">日薪</label>
                <input id="settings-dailySalary" autoFocus type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" value={Number.isFinite(draft.dailySalary) ? draft.dailySalary : ''} onChange={event => update('dailySalary', event.target.valueAsNumber)} {...fieldAccessibility('dailySalary')} />
                {errorFor('dailySalary')}
              </div>
              <div className="settings-field">
                <label htmlFor="settings-currency">币种</label>
                <select id="settings-currency" value={draft.currency} onChange={event => update('currency', event.target.value as SalarySettings['currency'])} {...fieldAccessibility('currency')}>
                  <option value="CNY">CNY · 人民币</option><option value="HKD">HKD · 港币</option><option value="USD">USD · 美元</option>
                </select>
                {errorFor('currency')}
              </div>
            </div>
          </fieldset>

          <fieldset className="settings-section" disabled={busy}>
            <legend><span>02</span> 上班节奏</legend>
            <div className="settings-grid">
              <div className="settings-field">
                <label htmlFor="settings-startTime">上班时间</label>
                <input id="settings-startTime" type="time" value={draft.startTime} onChange={event => update('startTime', event.target.value)} {...fieldAccessibility('startTime')} />
                {errorFor('startTime')}
              </div>
              <div className="settings-field">
                <label htmlFor="settings-endTime">下班时间</label>
                <input id="settings-endTime" type="time" value={draft.endTime} onChange={event => update('endTime', event.target.value)} {...fieldAccessibility('endTime')} />
                {errorFor('endTime')}
              </div>
            </div>
            <div className="settings-field settings-payday">
              <label htmlFor="settings-region">节假日地区</label>
              <select id="settings-region" value={draft.region} onChange={event => update('region', event.target.value as SalarySettings['region'])} {...fieldAccessibility('region')}>
                <option value="CN">中国大陆</option><option value="HK">中国香港</option>
              </select>
              {errorFor('region')}
            </div>
            <p className="schedule-summary">周一至周五自动计薪，公共假日休息。周末（含调休补班）默认不开启，需要时在首页点「今天上班」。</p>
            <div className="settings-lunch">
              <label className="settings-toggle-label" htmlFor="settings-autoWidget">
                <span><strong>上班自动出现浮窗</strong><small>应用在后台运行时生效，下班自动收起</small></span>
                <input id="settings-autoWidget" className="settings-switch-input" type="checkbox" role="switch" checked={draft.autoWidget} onChange={event => update('autoWidget', event.target.checked)} {...fieldAccessibility('autoWidget')} />
                <span className="settings-switch" aria-hidden="true" />
              </label>
              {errorFor('autoWidget')}
            </div>
          </fieldset>

          <details ref={advancedRef} className="advanced-settings">
            <summary>更多偏好 · 午休与发薪日</summary>
            <fieldset className="settings-section" disabled={busy}>
              <legend className="sr-only">午休与发薪日</legend>
              <div className="settings-lunch">
                <label className="settings-toggle-label" htmlFor="settings-lunchEnabled">
                  <span><strong>午休暂停增长</strong><small>日薪不变，分摊到午休以外的工作时间</small></span>
                  <input id="settings-lunchEnabled" className="settings-switch-input" type="checkbox" role="switch" checked={draft.lunchEnabled} onChange={event => update('lunchEnabled', event.target.checked)} {...fieldAccessibility('lunchEnabled')} />
                  <span className="settings-switch" aria-hidden="true" />
                </label>
                {errorFor('lunchEnabled')}
                {(draft.lunchEnabled || errors.lunchStart || errors.lunchEnd) && <div className="settings-grid settings-lunch-times">
                  <div className="settings-field"><label htmlFor="settings-lunchStart">午休开始</label><input id="settings-lunchStart" type="time" value={draft.lunchStart} onChange={event => update('lunchStart', event.target.value)} {...fieldAccessibility('lunchStart')} />{errorFor('lunchStart')}</div>
                  <div className="settings-field"><label htmlFor="settings-lunchEnd">午休结束</label><input id="settings-lunchEnd" type="time" value={draft.lunchEnd} onChange={event => update('lunchEnd', event.target.value)} {...fieldAccessibility('lunchEnd')} />{errorFor('lunchEnd')}</div>
                </div>}
              </div>
              <div className="settings-field settings-payday">
                <label htmlFor="settings-payday"><CalendarDays size={15} aria-hidden="true" /> 每月发薪日</label>
                <div className="settings-payday-input"><span>每月</span><input id="settings-payday" type="number" inputMode="numeric" min="1" max="31" step="1" value={Number.isFinite(draft.payday) ? draft.payday : ''} onChange={event => update('payday', event.target.valueAsNumber)} {...fieldAccessibility('payday')} /><span>日</span></div>
                {errorFor('payday')}
                <span className="settings-hint">仅用于发薪倒计时；当月没有这一天时按月末计算。</span>
              </div>
              <p className="settings-hint settings-shift-hint">下班早于上班时，按跨夜班次计算。时间跟随电脑本地时区。</p>
            </fieldset>
          </details>

          <div className="settings-note"><Info size={16} aria-hidden="true" /><p>节假日日历联网更新并缓存。暂缺当年日历时，按周一至周五估算并在首页提示，可手动改为今天休息。收入为鼓励用途的估算。</p></div>
          {saveError && <p ref={saveErrorRef} tabIndex={-1} className="settings-save-error" role="alert">{saveError}</p>}
        </div>
        <footer className="settings-footer"><button type="button" className="settings-cancel" onClick={onClose} disabled={busy}>先不改了</button><button type="submit" className="settings-submit" disabled={busy}>{busy ? '正在保存…' : '保存并开始计薪'}{!busy && <ArrowUpRight size={18} aria-hidden="true" />}</button></footer>
      </form>
    </dialog>
  );
}
