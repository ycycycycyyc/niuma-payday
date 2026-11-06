import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronRight, Coffee, Coins, Eye, EyeOff, FlaskConical, Flower2, Heart, LayoutDashboard, Maximize2, Minus, Monitor, MoreHorizontal, Pause, Play, Plus, Settings2, ShieldCheck, Sparkles, Sun, Target, Trophy, Wallet, X, Zap } from 'lucide-react';
import { DEFAULT_SETTINGS, calculateSalary, earningsBetween, type SalarySettings } from './lib/salary';
import { clockDate, currencySymbol, duration, money, useClock } from './lib/clock';
import { DEFAULT_STATE, readState, subscribeState, writePrivacy, writeState, type AppState } from './lib/store';
import SettingsModal from './components/SettingsModal';
import LiveAmount from './components/LiveAmount';
import Mascot from './components/Mascot';
import Widget, { widgetLayoutStyle } from './components/Widget';
import CompanionPet, { type CompanionOrigin } from './components/CompanionPet';
import { companionOrigin } from './lib/companion-origin';
import { classifyDay, dateKey, fetchCalendarYear } from '../shared/calendar.mjs';
import { describeDesktopError, isDesktopHost } from './lib/desktop-error';
import { version } from '../package.json';

type Page = 'dashboard' | 'playground' | 'achievements';
const compactFigure = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumSignificantDigits: 3 });
const cardFigure = (value: number, digits = 0) => value >= 10_000 ? compactFigure.format(value) : money(value, digits);
const quotes = [
  ['今天也在认真生活。', '工作是生活的一部分，快乐也是。'],
  ['可以慢一点，工资会跟上。', '别着急，一秒一秒也能攒出小确幸。'],
  ['你值得的，不止这份工资。', '记得喝水，也记得把时间留给自己。'],
  ['先赚一杯咖啡，再拯救世界。', '大目标太远，就从眼前的小快乐开始。'],
  ['每一秒，都算数。', '有数字在增长，也有你在好好生活。'],
];

function GoalModal({ goal, onSave, onClose }: { goal: AppState['goal']; onSave: (goal: AppState['goal']) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(goal.name);
  const [amount, setAmount] = useState(String(goal.amount));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} className="goal-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="goal-title">
    <form onSubmit={async e => { e.preventDefault(); if (!name.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('请填写目标名称和大于 0 的金额。'); return; } setSaving(true); try { await onSave({ name: name.trim(), amount: Number(amount) }); } catch { setError('保存失败，请重试。'); setSaving(false); } }}>
      <button className="dialog-x icon-button" type="button" onClick={onClose} aria-label="关闭目标设置"><X size={20} /></button>
      <h2 id="goal-title">我的小目标</h2><p className="muted">一杯咖啡，一顿好饭，或者一点点自由。</p>
      <label className="field-label" htmlFor="goal-name">目标名称</label><input autoFocus id="goal-name" maxLength={32} value={name} onChange={e => setName(e.target.value)} required />
      <label className="field-label" htmlFor="goal-amount">目标金额</label><input id="goal-amount" type="number" step="0.01" min="0.01" max="100000000" value={amount} onChange={e => setAmount(e.target.value)} required />
      {error && <p role="alert" className="form-error">{error}</p>}<button className="button primary full" disabled={saving}>{saving ? '保存中…' : '就决定是它了'}<ArrowRight size={17} /></button>
    </form>
  </dialog>;
}

function App() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [page, setPage] = useState<Page>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [browserWidget, setBrowserWidget] = useState(false);
  const [browserCompanion, setBrowserCompanion] = useState<CompanionOrigin | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const setToast = (text: string) => setNotice({ text, error: false });
  const showError = (error: unknown, operation: string) => setNotice({ text: describeDesktopError(error, operation), error: true });
  const [quote, setQuote] = useState(0);
  const [breakStart, setBreakStart] = useState<number | null>(null);
  const [completedBreaks, setCompletedBreaks] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [widgetPosition, setWidgetPosition] = useState({ x: 24, y: 24 });
  const [calendarBusy, setCalendarBusy] = useState(false);
  const calendarJobs = useRef(new Set<string>());
  const [dayBusy, setDayBusy] = useState(false);
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const browserWidgetHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = browserWidgetHost.current;
    if (!browserWidget || !host) return;
    const fit = () => {
      const { width, height } = host.getBoundingClientRect();
      setWidgetPosition(previous => ({ x: Math.max(0, Math.min(previous.x, window.innerWidth - width)), y: Math.max(0, Math.min(previous.y, window.innerHeight - height)) }));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [browserWidget]);
  const demo = !state.configured;
  const settings = demo ? DEFAULT_SETTINGS : state.settings;
  const now = useClock(demo);
  const salary = calculateSalary(settings, now, demo ? {} : state.calendar);
  const realNow = new Date();
  const todayKey = dateKey(realNow);
  const todaySchedule = classifyDay(realNow, settings, state.calendar);
  const cachedYear = state.calendar[`${settings.region}-${realNow.getFullYear()}`];
  const calendarHint = demo ? state.settings.monthlySalary === 0 ? '已保留原有偏好，请补填月薪后开始计薪。' : '只需设置月薪和上下班时间，工作日自动开启。'
    : !calendarBusy ? salary.calendarNotice ?? '' : '';
  const symbol = currencySymbol(settings.currency);
  const isWidget = window.location.hash === '#/widget';
  const amountText = (value: number, digits = 2) => state.privacy ? '••••' : `${symbol}${money(value, digits)}`;

  useEffect(() => {
    let mounted = true;
    readState().then(value => { if (mounted) { setState(value); setLoaded(true); } }).catch(error => { if (mounted) { setLoaded(true); setProfileError(describeDesktopError(error, 'read')); } });
    const unsubscribe = subscribeState(value => { if (mounted) setState(value); });
    const unsubscribeWindow = window.niuma?.onWindowState?.(value => setMaximized(value.maximized));
    return () => { mounted = false; unsubscribe(); unsubscribeWindow?.(); };
  }, []);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), notice.error ? 9000 : 4200); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { document.body.classList.toggle('widget-body', isWidget); return () => document.body.classList.remove('widget-body'); }, [isWidget]);
  const save = async (next: AppState) => { const saved = await writeState(next); setState(saved); return saved; };
  const saveSettings = async (next: SalarySettings) => { await save({ ...state, settings: next, configured: true }); setSettingsOpen(false); setBreakStart(null); setCompletedBreaks(0); setToast('月薪已保存，按当月工作日自动分摊。周末含调休补班默认休息。'); };
  const action = async (fn: () => Promise<void>, operation = 'window') => {
    try { await fn(); } catch (error) { showError(error, operation); }
  };
  const togglePrivacy = async () => {
    const hidden = !state.privacy;
    await writePrivacy(hidden);
    setState(previous => ({ ...previous, privacy: hidden }));
  };
  const openWidget = async () => {
    if (isDesktopHost()) {
      if (!window.niuma?.showWidget) throw new Error('桌面连接未就绪，请从托盘退出并重新打开应用。');
      await window.niuma.showWidget();
    } else {
      setBrowserWidget(true);
    }
  };
  const restAmount = breakStart === null ? 0 : earningsBetween(settings, new Date(breakStart), now, demo ? {} : state.calendar);
  const refreshCalendar = async (manual = false) => {
    const region = settings.region;
    if (calendarJobs.current.has(region)) return;
    calendarJobs.current.add(region);
    setCalendarBusy(true);
    try {
      if (window.niuma) {
        const result = await window.niuma.refreshCalendar();
        setState(previous => ({ ...previous, calendar: { ...previous.calendar, ...result.calendar } }));
        if (manual) setNotice({ text: result.message, error: result.status === 'unavailable' });
      } else {
        const year = new Date().getFullYear();
        const results = await Promise.allSettled([year, year + 1].map(value => fetchCalendarYear(region, value, undefined, state.calendar[`${region}-${value}`])));
        const updates = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        if (!updates.length) throw new Error('日历更新暂不可用');
        const latest = await readState();
        await save({ ...latest, calendar: { ...latest.calendar, ...Object.fromEntries(updates.map(calendar => [`${calendar.region}-${calendar.year}`, calendar])) } });
        if (manual) setNotice({ text: results[0].status === 'fulfilled' ? '日历已更新。' : '当年日历更新失败，已有有效缓存继续保留。', error: results[0].status === 'rejected' });
      }
    } catch {
      if (manual) setNotice({ text: cachedYear ? '更新失败，继续使用已保存的日历。' : '暂时无法获取日历，可手动切换今天上班或休息。', error: true });
    }
    finally { calendarJobs.current.delete(region); setCalendarBusy(calendarJobs.current.size > 0); }
  };
  useEffect(() => {
    if (!loaded || demo || isWidget) return;
    void refreshCalendar();
    // Only refresh when a configured region/year is first opened; manual refresh is also available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, demo, settings.region, realNow.getFullYear()]);
  const overrideToday = async (mode: 'work' | 'rest' | 'auto') => {
    if (demo) { setSettingsOpen(true); return; }
    if (dayBusy) return;
    setDayBusy(true);
    try {
      const latest = await readState();
      const dayOverrides = { ...latest.settings.dayOverrides };
      if (mode === 'auto') delete dayOverrides[todayKey]; else dayOverrides[todayKey] = mode;
      await save({ ...latest, settings: { ...latest.settings, dayOverrides } });
      setToast(mode === 'work' ? '今天按工作日计算，沿用设置的上下班时间。' : mode === 'rest' ? '今天设为休息日，明天恢复自动判断。' : '今天已恢复日历安排。');
      if (mode === 'work') await action(openWidget, 'widget');
      if (mode === 'rest' && window.niuma) await action(() => window.niuma!.hideWidget(), 'widget');
    } catch (error) { showError(error, 'save'); }
    finally { setDayBusy(false); }
  };
  const restSeconds = breakStart === null ? 0 : Math.max(0, (now.getTime() - breakStart) / 1000);
  const toggleBreak = () => {
    if (breakStart !== null) { setToast(`休息了 ${duration(restSeconds)}，工作时段内预估赚到 ${amountText(restAmount)}。`); setBreakStart(null); setCompletedBreaks(v => v + 1); }
    else { setBreakStart(clockDate(demo).getTime()); setToast('休息计时开始。站起来走走，工资在工作时段照常增长。'); }
  };
  const goalProgress = Math.min(1, salary.todayEarned / state.goal.amount);
  const achievements = [
    { title: '开始薪动', caption: '设置自己的第一份工资', unlocked: state.configured, icon: Zap },
    { title: '咖啡自由', caption: `今日预估收入达到 ${symbol}25`, unlocked: salary.todayEarned >= 25, icon: Coffee },
    { title: '百元小富翁', caption: `今日预估收入达到 ${symbol}100`, unlocked: salary.todayEarned >= 100, icon: Wallet },
    { title: '小目标，大快乐', caption: '完成你的每日快乐目标', unlocked: goalProgress >= 1, icon: Target },
    { title: '五日打工人', caption: '本月已完成 5 个排班工作日', unlocked: salary.completedWorkdays >= 5, icon: BadgeCheck },
    { title: '会休息才会生活', caption: '本次打开期间完成一次休息', unlocked: completedBreaks > 0, icon: Flower2 },
  ];

  if (!loaded) return <div className="loading-state"><Flower2 size={28} /><span>正在唤醒你的工资…</span></div>;
  if (profileError) return <div className="connection-error" role="alert"><p>{profileError}</p><button className="button secondary" onClick={() => window.location.reload()}>重新连接</button></div>;
  if (isWidget) return <Widget state={state} onRestore={() => void action(() => window.niuma!.restoreMain())}
    onHide={async () => {
      if (!window.niuma?.minimizeWidget) throw new Error('桌面连接需要更新，请从托盘退出后重新打开应用。');
      await window.niuma.minimizeWidget({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    }} />;

  const restCard = <section className={`rest-card ${breakStart !== null ? 'is-resting' : ''}`}>
    <div className="card-top"><span className="section-label"><Coffee size={18} />带薪充电站</span></div>
    <div className="rest-content"><div><h3>{breakStart !== null ? duration(restSeconds) : '歇一会儿，也在赚。'}</h3><p>{breakStart !== null ? `休息期间预估收入 ${amountText(restAmount)}` : '接杯水、伸个懒腰，让自己缓一缓。'}</p></div><button className={`rest-button ${breakStart !== null ? 'active' : ''}`} onClick={toggleBreak} aria-label={breakStart !== null ? '结束休息' : '开始带薪休息'}>{breakStart !== null ? <Pause size={18} /> : <Play size={18} />}<span>{breakStart !== null ? '结束休息' : '休息一下'}</span></button></div>
    {page === 'playground' && <p className="fine-print">计时不会暂停工资。仅排班计薪时段产生预估收入，设为暂停增长的午休和下班后不累计。</p>}
  </section>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('dashboard'); }} aria-label="牛马鼓励器首页"><span className="brand-mark"><Flower2 size={30} strokeWidth={2.2} /></span><div><strong>牛马鼓励器<span className="brand-dot">.</span></strong></div></a>
      <div className="sidebar-label">我的打工生活</div>
      <nav aria-label="主导航">
        <button className={page === 'dashboard' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('dashboard')}><LayoutDashboard size={19} />薪动时刻<span className="nav-dot" /></button>
        <button className={page === 'playground' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('playground')}><FlaskConical size={19} />快乐实验室</button>
        <button className={page === 'achievements' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('achievements')}><Trophy size={19} />打工成就</button>
      </nav>
      <div className="sidebar-note"><span className="note-spark">✳</span><p>生活不止有工作，<br />还有每一笔小快乐。</p><div className="note-line" /></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings2 size={19} />工资与偏好设置</button><div className="local-status"><ShieldCheck size={14} /><span>数据只留在这台设备</span><span className="version">v{version}</span></div></div>
    </aside>

    <div className="main-shell">
      <header className={`topbar ${window.niuma ? 'native-titlebar' : ''}`} onDoubleClick={e => { if (e.target === e.currentTarget && window.niuma) void action(() => window.niuma!.maximize()); }}>
        <div className="breadcrumb"><span>我的空间</span><ChevronRight size={13} /><strong>{page === 'dashboard' ? '薪动时刻' : page === 'playground' ? '快乐实验室' : '打工成就'}</strong></div>
        <div className="topbar-actions"><span className={`mode-indicator ${demo ? 'demo' : ''}`}><span />{demo ? '体验模式 · 演示数据' : '本地工资估算'}</span><button className="icon-button" onClick={() => void action(togglePrivacy, 'save')} aria-label={state.privacy ? '显示金额' : '隐藏金额'} title={state.privacy ? '显示金额' : '隐藏金额'}>{state.privacy ? <EyeOff size={18} /> : <Eye size={18} />}</button><span className="avatar">牛</span>
          {window.niuma && <div className="window-controls"><button onClick={() => void action(() => window.niuma!.minimize())} aria-label="最小化"><Minus size={15} /></button><button onClick={() => void action(() => window.niuma!.maximize())} aria-label={maximized ? '还原窗口' : '最大化'}><Maximize2 size={13} /></button><button className="window-close" onClick={() => void action(() => window.niuma!.close())} aria-label="收起到托盘" title="收起到托盘，后台继续运行"><X size={17} /></button></div>}
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <h1>{page === 'dashboard' ? <>今日薪动<span className="heading-star" aria-hidden="true">✿</span></> : page === 'playground' ? '快乐实验室' : '我的小勋章'}</h1>
            {page === 'playground' && <p>把漫长的工作日，拆成一个个小小的期待。</p>}
            {page === 'achievements' && <p>{demo ? '演示成就 · ' : ''}已解锁 {achievements.filter(a => a.unlocked).length} / {achievements.length} 项。小小的勋章，送给努力的你。</p>}
          </div>
          <div className="date-badge"><Sun size={17} /><span>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></div>
        </div>

        {page === 'dashboard' && <>
          <section className="calendar-banner" aria-label="今天的工作安排">
            <div className="calendar-status"><span className={`status-dot ${todaySchedule.working ? '' : 'resting'}`} /><div><strong>{demo ? '开始记录我的工资' : `${todaySchedule.reason} · ${settings.startTime}—${settings.endTime}`}</strong>{calendarHint && <p>{calendarHint}</p>}</div></div>
            <div className="day-actions">{demo ? <button className="button primary" onClick={() => setSettingsOpen(true)}>设置我的月薪<ArrowUpRight size={16} /></button> : <>
              <button className="button secondary" disabled={dayBusy} onClick={() => void overrideToday(todaySchedule.working ? 'rest' : 'work')}>{todaySchedule.working ? '今天休息' : '今天上班'}</button>
              {settings.dayOverrides[todayKey] && <button className="text-button" disabled={dayBusy} onClick={() => void overrideToday('auto')}>恢复日历</button>}
              <button className="text-button" disabled={calendarBusy} onClick={() => void refreshCalendar(true)}>{calendarBusy ? '更新中…' : '更新日历'}</button>
            </>}</div>
          </section>
          <div className="dashboard-grid">
            <section className="earnings-card">
              <div className="card-top"><span className="section-label"><span className={`status-dot ${salary.status !== 'working' ? 'resting' : ''}`} />{salary.statusLabel}</span><span className="outlined-tag">{demo ? 'DEMO' : 'LIVE'}<span className="live-bars"><i /><i /><i /></span></span></div>
              <div className="earnings-caption">今天，已经为自己赚了<button className="icon-button" onClick={() => void action(togglePrivacy, 'save')} aria-label={state.privacy ? '显示今日金额' : '隐藏今日金额'}>{state.privacy ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
              <LiveAmount settings={settings} demo={demo} privacy={state.privacy} calendar={demo ? {} : state.calendar} />
              <div className="earning-rate"><span className="mint-badge"><ArrowUpRight size={15} />{amountText(salary.hourlyRate)} / 小时</span><span>{salary.status === 'working' ? `每一秒，预估 +${state.privacy ? '••••' : `${symbol}${salary.perSecond.toFixed(4)}`}` : salary.status === 'break' ? '午休暂停计薪，好好吃顿饭。' : salary.status === 'after' ? '今天辛苦了，把时间还给生活。' : '工作时段自动开始，不必手动打卡。'}</span></div>
              <div className="workday-track">
                <div className="track-label"><span>今日进度 <strong>{(salary.progress * 100).toFixed(1)}%</strong></span><span>{settings.startTime} — {settings.endTime}</span></div>
                <div className="progress-track"><i style={{ width: `${salary.progress * 100}%` }} /><span className="progress-tip" style={{ left: `${Math.min(97, Math.max(3, salary.progress * 100))}%` }}>✦</span></div>
                <div className="track-caption">{settings.lunchEnabled ? '已扣除午休' : '全时段计薪'}</div>
              </div>
              <div className="hero-footer"><span><Wallet size={14} />{demo ? '演示月薪' : '月薪'} {amountText(settings.monthlySalary)}</span><button onClick={() => void action(openWidget, 'widget')}><Monitor size={15} />开启悬浮窗<ArrowUpRight size={15} /></button></div>
            </section>

            <section className="mood-card"><div className="card-top"><span className="section-label">我的打工搭子</span><Flower2 size={16} aria-hidden="true" /></div><div className="mascot-scene"><span className="buddy-label"><span />{salary.status === 'after' || salary.status === 'off' ? '下班万岁' : '今日份元气已到账'}</span><Mascot /><span className="scene-spark spark-one">✧</span><span className="scene-spark spark-two">✳</span></div><div className="buddy-copy"><h2>{quotes[quote][0]}</h2><p>{quotes[quote][1]}</p></div><button className="encourage-button" onClick={() => setQuote(v => (v + 1) % quotes.length)}><Heart size={15} />再来一点鼓励<ArrowUpRight size={15} /></button></section>
          </div>

          <div className="stats-row">
            <section className="stat-card"><span className="stat-icon lilac"><Wallet size={19} /></span><div><div className="stat-label">本月已赚</div><strong>{amountText(salary.monthEarned)}</strong></div></section>
            <section className="stat-card"><span className="stat-icon peach"><ArrowDownRight size={21} /></span><div><div className="stat-label">距离下班</div><strong className="countdown">{salary.status === 'off' ? '今日休息' : salary.status === 'after' ? '已下班，去生活' : duration(salary.remainingSeconds)}</strong></div></section>
            <section className="stat-card"><span className="stat-icon yellow"><Coins size={20} /></span><div><div className="stat-label">下次发薪日{salary.paydayEstimated && ' · 估算'}</div><strong title={salary.nextPayday?.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}>{salary.daysToPayday === null ? '暂无法确定' : salary.daysToPayday === 0 ? '就是今天' : <>{salary.daysToPayday}<small> 天后</small></>}</strong></div></section>
          </div>

          <div className="lower-grid"><section className="week-card"><div className="card-top"><div><h3>本周工资 <small>{settings.currency}</small></h3></div></div><div className="week-chart" role="img" aria-label={`本周每日预估收入：${salary.week.map(day => `${day.label} ${amountText(day.earned)}`).join('，')}`}>
            {salary.week.map(day => <div className={`chart-column ${day.isToday ? 'today' : ''} ${day.isFuture ? 'future' : ''}`} key={day.label}><div className="bar-value" title={state.privacy || day.isFuture ? undefined : amountText(day.earned)}>{state.privacy ? '•••' : day.isFuture ? '—' : cardFigure(day.earned)}</div><div className="bar-track"><div className="bar" style={{ '--bar-height': `${Math.max(5, (day.earned / (salary.dailySalary || 1)) * 100)}%` } as CSSProperties}>{day.isToday && <span>✦</span>}</div></div><span className="bar-label">{day.isToday ? '今天' : day.label}</span></div>)}
          </div><div className="chart-footer"><span><i className="legend-dot" />排班收入预估</span><span>{salary.workingDaysInMonth} 个本月计薪日</span></div></section>
            <div className="right-stack"><section className="goal-card"><div className="card-top"><span className="section-label"><Target size={18} />今日小目标</span><button className="icon-button" aria-label="编辑小目标" onClick={() => setGoalOpen(true)}><MoreHorizontal size={19} /></button></div><div className="goal-content"><span className={`goal-icon ${goalProgress >= 1 ? 'complete' : ''}`}>{goalProgress >= 1 ? <Check size={25} /> : <Coffee size={25} />}</span><div><h3>{state.goal.name}</h3><p>{goalProgress >= 1 ? '目标达成！这份快乐，你值得。' : `还差 ${amountText(state.goal.amount - salary.todayEarned)}，小快乐就在前面。`}</p></div></div><div className="goal-progress"><i style={{ width: `${goalProgress * 100}%` }} /></div><div className="goal-caption"><span>{goalProgress >= 1 ? '今日已解锁' : '正在靠近'}</span><strong>{amountText(Math.min(salary.todayEarned, state.goal.amount), 0)} / {amountText(state.goal.amount, 0)}</strong></div></section>{restCard}</div>
          </div>
          
        </>}

        {page === 'playground' && <div className="playground-grid"><section className="conversion-card"><h2>今天的努力，可以换成…</h2><p className="muted">换个单位，看见打工的快乐。</p><div className="conversion-items">{[{ label: '杯快乐咖啡', price: 25, icon: Coffee }, { label: '顿好好吃饭', price: 35, icon: Heart }, { label: '次轻松通勤', price: 10, icon: Zap }].map(item => <div key={item.label}><item.icon size={27} /><strong title={state.privacy ? undefined : money(salary.todayEarned / item.price, 1)}>{state.privacy ? '••' : cardFigure(salary.todayEarned / item.price, 1)}</strong><span>{item.label}</span><small>按 {symbol}{item.price} / 份估算</small></div>)}</div></section>{restCard}<section className="lab-quote"><Sparkles size={25} /><div><h2>{quotes[quote][0]}</h2><p>{quotes[quote][1]}</p></div><button className="button secondary" onClick={() => setQuote(v => (v + 1) % quotes.length)}>换一句<ArrowRight size={16} /></button></section><section className="lab-goal"><Target size={25} /><h2>下一个小快乐，由你定义。</h2><p>把咖啡、电影票或一顿大餐，变成看得见的期待。</p><button className="button primary" onClick={() => setGoalOpen(true)}><Plus size={16} />定个小目标</button></section><section className="lab-widget"><Monitor size={25} /><h2>小窗口，大动力。</h2><p>让跳动的工资，在你的桌面悄悄陪伴。</p><button className="button secondary" onClick={() => void action(openWidget, 'widget')}>打开悬浮窗<ArrowUpRight size={16} /></button></section></div>}

        {page === 'achievements' && <><div className="achievement-summary"><div className="achievement-emblem"><Trophy size={38} /></div><div><h2>{achievements.filter(a => a.unlocked).length} 枚小勋章，致认真生活的你。</h2><p>{demo ? '当前使用演示数据。保存你的工资设置后，将按真实排班重新计算。' : '每日与本月成就随当前排班计算；休息成就记录本次打开期间的体验。'}</p></div></div><div className="achievement-grid">{achievements.map(item => <section className={`achievement-card ${item.unlocked ? 'unlocked' : ''}`} key={item.title}><span className="achievement-icon"><item.icon size={31} /></span><span className="achievement-state">{item.unlocked ? <><Check size={12} />已解锁</> : '等待点亮'}</span><h3>{item.title}</h3><p>{item.caption}</p></section>)}</div></>}

        <footer className="page-footer"><span><Flower2 size={14} />每一秒努力，都值得被看见。</span><span>仅作收入估算 · 工资数据保存在本机</span></footer>
      </main>
    </div>
    {settingsOpen && <SettingsModal settings={state.settings} calendar={state.calendar} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
    {goalOpen && <GoalModal goal={state.goal} onSave={async goal => { await save({ ...state, goal }); setGoalOpen(false); setToast('新的小目标，安排好了。'); }} onClose={() => setGoalOpen(false)} />}
    {notice && <div className="toast" role={notice.error ? 'alert' : 'status'}>{notice.error ? <span aria-hidden="true">!</span> : <Check size={17} />}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button></div>}
    {browserWidget && <div className="browser-widget-host" ref={browserWidgetHost}
      style={{ ...widgetLayoutStyle, '--widget-right': `${widgetPosition.x}px`, '--widget-bottom': `${widgetPosition.y}px` } as CSSProperties}
      onPointerDown={e => {
        if (e.button !== 0 || (e.target as Element).closest('button, input, [role="dialog"]')) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        drag.current = { clientX: e.clientX, clientY: e.clientY, x: window.innerWidth - bounds.right, y: window.innerHeight - bounds.bottom };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!drag.current) return;
        const { offsetWidth, offsetHeight } = e.currentTarget;
        setWidgetPosition({
          x: Math.max(0, Math.min(window.innerWidth - offsetWidth, drag.current.x + drag.current.clientX - e.clientX)),
          y: Math.max(0, Math.min(window.innerHeight - offsetHeight, drag.current.y + drag.current.clientY - e.clientY)),
        });
      }}
      onLostPointerCapture={() => { drag.current = null; }}>
      <Widget state={state} preview onRestore={() => setBrowserWidget(false)} onHide={() => {
        setBrowserCompanion(companionOrigin(document.querySelector('.browser-widget-host .widget-dog')));
        setBrowserWidget(false);
      }} />
    </div>}
    {browserCompanion && !browserWidget && <div style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
      <CompanionPet origin={browserCompanion} onRestore={() => { setBrowserCompanion(null); setBrowserWidget(true); }} />
    </div>}
  </div>;
}
export default App;

