import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Flag, Pause, Play, RotateCcw, Trophy, VolumeX } from 'lucide-react';
import { matchWinner, newPongGame, normalizePongSave, servePong, stepPong, type Difficulty, type PongState, type PongStats } from '../lib/ping-pong';
import { drawPong, pongCanvasSize } from '../lib/ping-pong-draw';
import { duration, currencySymbol, money } from '../lib/clock';
import { earningsBetween, type SalarySettings } from '../lib/salary';
import type { CalendarCache } from '../../shared/calendar.mjs';
import './ping-pong.css';

const SAVE_KEY = 'niuma.ping-pong.v1';
const labels: Record<Difficulty, string> = { easy: '轻松', normal: '刚刚好', hard: '来点挑战' };
type Props = { settings: SalarySettings; calendar: CalendarCache; privacy: boolean; demo: boolean; active?: boolean; onExit: () => void };

function readGame() {
  try { return normalizePongSave(JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')); }
  catch { return normalizePongSave(null); }
}

function PingPongGame({ settings, calendar, privacy, demo, active = true, onExit }: Props) {
  const [initial] = useState(readGame);
  const game = useRef(initial.game);
  const stats = useRef<PongStats>(initial.stats);
  const playedMs = useRef(initial.playedMs);
  const [view, setView] = useState(initial.game);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [summary, setSummary] = useState({ playedMs: initial.playedMs, earned: 0, stats: initial.stats });
  const earned = useRef(0);
  const earnedCurrency = useRef(settings.currency);
  const [saveError, setSaveError] = useState('');
  const [restartOpen, setRestartOpen] = useState(false);
  const restartDialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const target = useRef(initial.game.playerX);
  const keys = useRef(new Set<string>());
  const reduced = useRef(false);
  const income = useRef({ settings, calendar, demo });
  income.current = { settings, calendar, demo };
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const segment = useRef<{ wall: number; perf: number } | null>(null);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, game: game.current, stats: stats.current, playedMs: playedMs.current }));
      setSaveError('');
    } catch { setSaveError('本机游戏存档暂时写入失败，本次仍可继续玩。'); }
  }, []);
  const settleTime = useCallback((publish = true) => {
    const start = segment.current;
    if (!start) return;
    const wall = Date.now(), perf = performance.now();
    const delta = Math.max(0, Math.min(perf - start.perf, wall - start.wall));
    // Count only visible, active play. A suspended computer never earns game time.
    if (delta <= 2500) {
      playedMs.current += delta;
      const { settings: schedule, calendar: cache, demo: isDemo } = income.current;
      if (!isDemo && delta > 0) earned.current += earningsBetween(schedule, new Date(wall - delta), new Date(wall), cache);
    }
    segment.current = { wall, perf };
    if (publish) setSummary({ playedMs: playedMs.current, earned: earned.current, stats: { ...stats.current } });
  }, []);
  const pause = useCallback(() => {
    if (runningRef.current) settleTime();
    stats.current.bestRally = Math.max(stats.current.bestRally, game.current.bestRally);
    runningRef.current = false;
    segment.current = null;
    keys.current.clear();
    setRunning(false);
    setView({ ...game.current });
    persist();
  }, [persist, settleTime]);
  const start = useCallback(() => {
    if (game.current.phase === 'finished' || document.hidden) return;
    game.current = servePong(game.current);
    runningRef.current = true;
    segment.current = { wall: Date.now(), perf: performance.now() };
    setView({ ...game.current });
    setRunning(true);
    surface.current?.focus();
  }, []);

  useEffect(() => { if (!active) pause(); }, [active, pause]);
  useEffect(() => {
    if (earnedCurrency.current === settings.currency) return;
    earnedCurrency.current = settings.currency;
    earned.current = 0;
    setSummary(previous => ({ ...previous, earned: 0 }));
  }, [settings.currency]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; if (canvas.current) drawPong(canvas.current, game.current, reduced.current); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.width * pongCanvasSize.height / pongCanvasSize.width);
      drawPong(el, game.current, reduced.current);
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) pause(); });
    observer.observe(el);
    const visibility = () => { if (document.hidden) pause(); };
    const leave = () => pause();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', leave); window.removeEventListener('pagehide', leave); };
  }, [pause]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('dialog')) return;
      if (event.key === 'Escape') { event.preventDefault(); pause(); onExitRef.current(); return; }
      if ((event.target as HTMLElement)?.closest('select, input, button, dialog')) return;
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) runningRef.current ? pause() : start(); }
      if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) { event.preventDefault(); keys.current.add(event.code); }
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    window.addEventListener('keydown', keyboard); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('keyup', up); };
  }, [pause, start]);
  useEffect(() => {
    if (!running) { if (canvas.current) drawPong(canvas.current, game.current, reduced.current); return; }
    let raf = 0, previous = performance.now(), lastUi = previous;
    const frame = (now: number) => {
      if (!runningRef.current) return;
      const dt = Math.max(0, Math.min(.05, (now - previous) / 1000)); previous = now;
      if (keys.current.has('ArrowLeft') || keys.current.has('KeyA')) target.current = Math.max(-.88, target.current - dt * 2.3);
      if (keys.current.has('ArrowRight') || keys.current.has('KeyD')) target.current = Math.min(.88, target.current + dt * 2.3);
      const old = game.current;
      game.current = stepPong(old, dt, target.current);
      if (canvas.current) drawPong(canvas.current, game.current, reduced.current);
      if (game.current.phase !== 'rally') {
        if (game.current.phase === 'finished' && old.phase !== 'finished') {
          stats.current = { version: 1, wins: stats.current.wins + (matchWinner(game.current.player, game.current.computer) === 'player' ? 1 : 0),
            matches: stats.current.matches + 1, bestRally: Math.max(stats.current.bestRally, game.current.bestRally) };
        } else stats.current.bestRally = Math.max(stats.current.bestRally, game.current.bestRally);
        pause(); return;
      }
      if (now - lastUi >= 1000) { settleTime(); setView({ ...game.current }); lastUi = now; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, pause, settleTime]);
  useEffect(() => () => {
    // Cleanup keeps the current rally, with no timers or animation left behind.
    if (runningRef.current) settleTime(false);
    runningRef.current = false;
    segment.current = null;
    stats.current.bestRally = Math.max(stats.current.bestRally, game.current.bestRally);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, game: game.current, stats: stats.current, playedMs: playedMs.current })); } catch { /* The visible save error already explains storage failures. */ }
  }, [settleTime]);
  useEffect(() => {
    if (restartOpen) restartDialog.current?.showModal();
  }, [restartOpen]);

  const restart = (difficulty = game.current.difficulty) => {
    pause();
    game.current = newPongGame(difficulty); target.current = 0; playedMs.current = 0; earned.current = 0;
    setView(game.current); setSummary({ playedMs: 0, earned: 0, stats: { ...stats.current } });
    setRestartOpen(false); persist();
    if (canvas.current) drawPong(canvas.current, game.current, reduced.current);
  };
  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    target.current = Math.max(-.88, Math.min(.88, (event.clientX - box.left - box.width / 2) / (box.width * .415)));
    if (!runningRef.current && game.current.phase !== 'finished') {
      game.current.playerX = target.current;
      if (game.current.phase === 'ready') game.current.ball.x = target.current;
      drawPong(event.currentTarget, game.current, reduced.current);
    }
  };
  const mainLabel = view.phase === 'finished' ? '再来一局' : running ? '暂停比赛' : view.phase === 'rally' ? '继续比赛' : view.phase === 'point' ? '继续发球' : '开始比赛';

  return <section className="pong-game" aria-labelledby="pong-title">
    <header className="pong-header"><div><span className="pong-eyebrow">快乐实验室 / 摸鱼球馆</span><h2 id="pong-title">来一局，乒乓。</h2><p>让球来回，让时间慢一点。</p></div>
      <button className="button secondary" onClick={() => { pause(); onExit(); }}><ArrowLeft size={16} />收起回工资页 <kbd>Esc</kbd></button></header>
    <div className="pong-panel">
      <div className="pong-scoreboard" aria-label={`比赛比分：你 ${view.player}，电脑 ${view.computer}`}>
        <div><span className="pong-player-dot" />你<strong data-testid="pong-player-score">{view.player}</strong></div><span className="pong-score-separator">:</span><div><strong data-testid="pong-computer-score">{view.computer}</strong>电脑<span className="pong-computer-dot" /></div>
        <span className="pong-rules">11 分制 · 领先 2 分获胜</span>
      </div>
      <div className="pong-surface" ref={surface} tabIndex={0} role="group" aria-label="乒乓球操作区" aria-describedby="pong-instructions" data-running={running} data-phase={view.phase}>
        <canvas ref={canvas} aria-label="乒乓球台：你控制下方球拍，电脑在上方" role="img" onPointerMove={pointer}
          onPointerDown={event => { pointer(event); event.currentTarget.setPointerCapture(event.pointerId); if (!runningRef.current) start(); }} />
        {!running && <div className="pong-overlay"><span className="pong-overlay-tag">{view.phase === 'finished' ? '本局结束' : view.phase === 'rally' ? '暂停一下' : '随时开球'}</span>
          <h3>{view.phase === 'ready' ? '今天的快乐，从发球开始。' : view.message}</h3>
          <p>{view.phase === 'finished' ? '胜负先放一边，快乐再来一局。' : '移动鼠标或触控板，球拍会跟着你。'}</p>
          <button className="button primary" onClick={() => view.phase === 'finished' ? restart() : start()}><Play size={16} />{mainLabel}</button>
        </div>}
      </div>
      <div className="pong-toolbar"><div className="pong-main-controls"><button className="button primary" onClick={() => view.phase === 'finished' ? restart() : running ? pause() : start()}>{running ? <Pause size={16} /> : <Play size={16} />}{mainLabel}<kbd>Space</kbd></button>
        <button className="button secondary" onClick={() => { pause(); setRestartOpen(true); }}><RotateCcw size={15} />重新开始</button></div>
        <label className="pong-difficulty">电脑难度<select aria-label="乒乓球电脑难度" value={view.difficulty} disabled={view.phase !== 'ready' || view.player + view.computer > 0}
          onChange={event => restart(event.target.value as Difficulty)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p id="pong-instructions" className="pong-instructions">鼠标 / 触控板移动球拍，也可用 ← → 或 A D。自动辅助挥拍；空格暂停，切到后台自动暂停。<span><VolumeX size={13} />静音球馆</span></p>
      <p className="pong-live-message" role="status">{view.phase === 'rally' ? running ? `本轮已连续回击 ${view.rally} 次` : '比赛已暂停，回来继续。' : view.message}</p>
    </div>
    <div className="pong-stats"><div><Flag size={18} /><span>本局实玩<strong>{duration(summary.playedMs / 1000)}</strong></span></div>
      <div><span className="pong-income-symbol">{currencySymbol(settings.currency)}</span><span>本次打开期间预估收入<strong>{privacy ? '••••' : demo ? '体验模式' : `${currencySymbol(settings.currency)}${money(summary.earned)}`}</strong></span></div>
      <div><Trophy size={18} /><span>最长连续回击<strong>{Math.max(summary.stats.bestRally, view.bestRally)} <small>次</small></strong></span></div>
      <div><span className="pong-win-flower">✿</span><span>本机胜场<strong>{summary.stats.wins} <small>/ {summary.stats.matches} 局</small></strong></span></div></div>
    <p className="pong-footnote">游戏进度自动保存在本机。收入仅统计实际游玩的排班计薪时段，暂停、午休暂停增长及下班后均不累计；切换币种后从零统计。</p>
    {saveError && <p className="pong-save-error" role="alert">{saveError}</p>}
    {restartOpen && <dialog ref={restartDialog} className="pong-restart-dialog" aria-labelledby="pong-restart-title" onCancel={() => setRestartOpen(false)}><h3 id="pong-restart-title">重新开始这一局？</h3><p>当前比分将清零，历史胜场和最长回击保留。</p><div><button className="button secondary" autoFocus onClick={() => setRestartOpen(false)}>继续这局</button><button className="button primary" onClick={() => restart()}>重新开始</button></div></dialog>}
  </section>;
}

export default memo(PingPongGame);
