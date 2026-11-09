import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Flag, Pause, Play, RotateCcw, Trophy, VolumeX } from 'lucide-react';
import { clampPlayerTarget, matchWinner, newPongGame, normalizePongSave, PADDLE_HEIGHT, PONG_CANVAS, projectPong, servePong, stepPong, unprojectPong, type Difficulty, type PongStats } from '../lib/ping-pong';
import { drawPong, preparePongArt } from '../lib/ping-pong-draw';
import { duration, currencySymbol, money } from '../lib/clock';
import { earningsBetween, type SalarySettings } from '../lib/salary';
import type { CalendarCache } from '../../shared/calendar.mjs';
import './ping-pong.css';

const SAVE_KEY = 'niuma.ping-pong.v1';
const labels: Record<Difficulty, string> = { easy: '轻松', normal: '刚刚好', hard: '来点挑战' };
const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const limit = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const BACKSWING_ROOM = 80; // CSS pixels between the court and the bottom of the viewport.
type PointerPosition = { x: number; y: number; bottomExit?: true };

function inViewport({ clientX, clientY }: PointerEvent) {
  return clientX >= 0 && clientX < window.innerWidth && clientY >= 0 && clientY < window.innerHeight;
}

function outsidePointer(x: number, y: number): PointerPosition | null {
  return y >= window.innerHeight && x >= 0 && x < window.innerWidth
    ? { x, y: window.innerHeight, bottomExit: true } : null;
}
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
  const [artStatus, setArtStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [artAttempt, setArtAttempt] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const target = useRef({ x: initial.game.playerX, y: initial.game.playerY });
  const lastPointer = useRef<PointerPosition | null>(null);
  const dragPointer = useRef<number | null>(null);
  const startPointerType = useRef('');
  const [locked, setLocked] = useState(false);
  const [lockNotice, setLockNotice] = useState('');
  const strokeSamples = useRef<{ time: number; target: { x: number; y: number } }[]>([]);
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
    if (canvas.current && document.pointerLockElement === canvas.current) document.exitPointerLock();
    if (dragPointer.current !== null) {
      if (canvas.current?.hasPointerCapture(dragPointer.current)) canvas.current.releasePointerCapture(dragPointer.current);
      dragPointer.current = null;
      lastPointer.current = null;
    }
    if (lastPointer.current?.bottomExit) lastPointer.current = null;
    segment.current = null;
    keys.current.clear();
    strokeSamples.current.length = 0;
    target.current = { x: game.current.playerX, y: game.current.playerY };
    setRunning(false);
    setView({ ...game.current });
    persist();
  }, [persist, settleTime]);
  const reportLockFailure = useCallback(() => {
    if (runningRef.current) setLockNotice('当前窗口不能锁定鼠标。按住球台拖动，滑出页面也能挥拍。');
  }, []);
  const lockMouse = useCallback(() => {
    const el = canvas.current;
    if (!el || !runningRef.current || document.pointerLockElement === el) return;
    surface.current?.focus({ preventScroll: true });
    try {
      if (!el.requestPointerLock) { reportLockFailure(); return; }
      Promise.resolve(el.requestPointerLock()).catch(reportLockFailure);
    } catch { reportLockFailure(); }
  }, [reportLockFailure]);
  const fitCourt = useCallback(() => {
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds) return;
    const extra = Math.ceil(bounds.bottom + BACKSWING_ROOM - window.innerHeight);
    if (extra > 0) window.scrollBy({ top: extra, behavior: 'instant' });
  }, []);
  useEffect(() => {
    if (artStatus !== 'ready') return;
    fitCourt();
    const resize = () => { if (runningRef.current) fitCourt(); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [artStatus, fitCourt]);
  const start = useCallback((withMouse = false) => {
    if (artStatus !== 'ready' || game.current.phase === 'finished' || document.hidden) return;
    game.current = servePong(game.current);
    runningRef.current = true;
    setLockNotice('');
    segment.current = { wall: Date.now(), perf: performance.now() };
    setView({ ...game.current });
    setRunning(true);
    fitCourt();
    surface.current?.focus({ preventScroll: true });
    if (withMouse) lockMouse();
  }, [artStatus, fitCourt, lockMouse]);

  useEffect(() => {
    let mounted = true;
    preparePongArt().then(() => {
      if (!mounted) return;
      if (canvas.current) drawPong(canvas.current, game.current, reduced.current);
      setArtStatus('ready');
    }).catch(() => { if (mounted) setArtStatus('failed'); });
    return () => { mounted = false; };
  }, [artAttempt]);

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
      el.height = Math.round(el.width * PONG_CANVAS.height / PONG_CANVAS.width);
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
      if (movementKeys.has(event.code)) { event.preventDefault(); keys.current.add(event.code); }
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
      const frameStart = Math.min(now, Math.max(previous, now - 50));
      const dt = (now - frameStart) / 1000;
      previous = now;
      const old = game.current;
      const held = keys.current;
      if (held.size) {
        const dx = Number(held.has('ArrowRight') || held.has('KeyD')) - Number(held.has('ArrowLeft') || held.has('KeyA'));
        const dy = Number(held.has('ArrowUp') || held.has('KeyW')) - Number(held.has('ArrowDown') || held.has('KeyS'));
        target.current = clampPlayerTarget({ x: target.current.x + dx * dt * 2.4, y: target.current.y + dy * dt * 2.4 });
        game.current = stepPong(game.current, dt, target.current);
      } else {
        // A quick out-and-back stroke can contain several pointer samples in
        // one paint. Advance the ball and racket along the recorded path.
        let cursor = frameStart;
        for (const sample of strokeSamples.current) {
          const end = limit(sample.time, cursor, now);
          game.current = stepPong(game.current, (end - cursor) / 1000, sample.target);
          cursor = end;
        }
        game.current = stepPong(game.current, (now - cursor) / 1000, target.current);
      }
      strokeSamples.current.length = 0;
      if (canvas.current) drawPong(canvas.current, game.current, reduced.current);
      if (game.current.phase !== 'rally') {
        if (game.current.phase === 'finished' && old.phase !== 'finished') {
          stats.current = { version: 1, wins: stats.current.wins + (matchWinner(game.current.player, game.current.computer) === 'player' ? 1 : 0),
            matches: stats.current.matches + 1, bestRally: Math.max(stats.current.bestRally, game.current.bestRally) };
        } else stats.current.bestRally = Math.max(stats.current.bestRally, game.current.bestRally);
        pause(); return;
      }
      const hit = old.rally !== game.current.rally;
      const launched = old.serveCountdown > 0 && game.current.serveCountdown <= 0;
      if (now - lastUi >= 1000) { settleTime(); setView({ ...game.current }); lastUi = now; }
      else if (hit || launched) setView({ ...game.current });
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
    game.current = newPongGame(difficulty);
    target.current = { x: game.current.playerX, y: game.current.playerY };
    playedMs.current = 0; earned.current = 0;
    setView(game.current); setSummary({ playedMs: 0, earned: 0, stats: { ...stats.current } });
    setRestartOpen(false); persist();
    if (canvas.current) drawPong(canvas.current, game.current, reduced.current);
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    function move(event: PointerEvent) {
      if (!el || !event.isPrimary || (event.pointerType === 'touch' && event.pointerId !== dragPointer.current)) return;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const inCourt = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      const captured = document.pointerLockElement === el;
      const dragging = dragPointer.current === event.pointerId && el.hasPointerCapture(event.pointerId);
      if (!captured && !dragging && !inViewport(event)) {
        lastPointer.current = outsidePointer(event.clientX, event.clientY);
        return;
      }
      const coalesced = event.getCoalescedEvents?.();
      for (const sample of coalesced?.length ? coalesced : [event]) {
        const previous = lastPointer.current;
        lastPointer.current = { x: sample.clientX, y: sample.clientY };
        if (!runningRef.current) {
          if (!inCourt || game.current.phase === 'rally') continue;
          target.current = clampPlayerTarget(unprojectPong(
            (sample.clientX - box.left) * PONG_CANVAS.width / box.width,
            (sample.clientY - box.top) * PONG_CANVAS.height / box.height));
          game.current = { ...game.current, playerX: target.current.x, playerY: target.current.y, playerVX: 0, playerVY: 0, playerSwing: 0 };
          drawPong(el, game.current, reduced.current);
          continue;
        }
        let dx = sample.movementX, dy = sample.movementY;
        if (!captured) {
          if (!previous) continue;
          if (previous.bottomExit) {
            // Only the visible part of a return through the same edge is known.
            // A distant re-entry establishes a new starting point instead.
            const inset = window.innerHeight - sample.clientY;
            if (inset < 0 || inset > BACKSWING_ROOM || Math.abs(sample.clientX - previous.x) > BACKSWING_ROOM) continue;
            dx = 0;
            dy = -Math.min(inset, 32);
          } else {
            dx = sample.clientX - previous.x;
            dy = sample.clientY - previous.y;
          }
        }
        // Apply displacement to the *clamped* racket. Excess motion past an
        // edge is discarded, so the first reverse movement always takes effect.
        const startPixel = projectPong(target.current.x, target.current.y, PADDLE_HEIGHT);
        const next = unprojectPong(startPixel.x + dx * PONG_CANVAS.width / box.width,
          startPixel.y + dy * PONG_CANVAS.height / box.height);
        target.current = clampPlayerTarget(next, target.current);
        strokeSamples.current.push({ time: sample.timeStamp, target: target.current });
      }
      if (strokeSamples.current.length > 64) strokeSamples.current.splice(0, strokeSamples.current.length - 64);
    }
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.target !== el || event.button !== 0 || document.pointerLockElement === el) return;
      if (event.pointerType !== 'touch' && !runningRef.current) return;
      dragPointer.current = event.pointerId;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      el.setPointerCapture(event.pointerId);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== dragPointer.current) return;
      dragPointer.current = null;
      lastPointer.current = null;
      if (event.type === 'pointerup' && event.pointerType !== 'touch') {
        lastPointer.current = inViewport(event) ? { x: event.clientX, y: event.clientY } : outsidePointer(event.clientX, event.clientY);
      }
    };
    const leave = (event: PointerEvent) => {
      if (!event.isPrimary || event.pointerType === 'touch' || document.pointerLockElement === el || el.hasPointerCapture(event.pointerId)) return;
      lastPointer.current = outsidePointer(event.clientX, event.clientY);
    };
    let hadLock = false;
    const lockChange = () => {
      const acquired = document.pointerLockElement === el;
      setLocked(acquired);
      lastPointer.current = null;
      if (acquired) {
        setLockNotice('');
        if (!runningRef.current) document.exitPointerLock();
      }
      if (hadLock && !acquired && runningRef.current) {
        pause();
        if (document.hasFocus() && !document.hidden) onExitRef.current();
      }
      hadLock = acquired;
    };
    window.addEventListener('pointermove', move, { capture: true, passive: true });
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    el.addEventListener('lostpointercapture', up);
    document.documentElement.addEventListener('pointerleave', leave);
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('pointerlockerror', reportLockFailure);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      el.removeEventListener('lostpointercapture', up);
      document.documentElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('pointerlockerror', reportLockFailure);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [pause, reportLockFailure]);
  const mainLabel = view.phase === 'finished' ? '再来一局' : running ? '暂停比赛' : view.phase === 'rally' ? '继续比赛' : view.phase === 'point' ? '接下一球' : '开始比赛';

  return <section className="pong-game" aria-labelledby="pong-title">
    <header className="pong-header"><div><h2 id="pong-title">来一局，乒乓。</h2><p>等球在你这边弹起，向球网方向挥拍。斜着挥可以打向两侧。</p></div>
      <button className="button secondary" onClick={() => { pause(); onExit(); }}><ArrowLeft size={16} />收起回工资页 <kbd>Esc</kbd></button></header>
    <div className="pong-panel">
      <div className="pong-scoreboard" aria-label={`比赛比分：你 ${view.player}，电脑 ${view.computer}`}>
        <div><span className="pong-player-dot" />你<strong data-testid="pong-player-score">{view.player}</strong></div><span className="pong-score-separator">:</span><div><strong data-testid="pong-computer-score">{view.computer}</strong>电脑<span className="pong-computer-dot" /></div>
        <span className="pong-rules">11 分制 · 领先 2 分获胜</span>
      </div>
      <div className="pong-surface" ref={surface} tabIndex={0} role="group" aria-label="乒乓球操作区" aria-describedby="pong-instructions" data-running={running} data-phase={view.phase} data-rally={view.rally} data-hitter={view.ball.hitter}>
        <canvas ref={canvas} aria-label="乒乓球台：你控制下方球拍，电脑在上方" role="img"
          onPointerDown={() => surface.current?.focus({ preventScroll: true })} />
        {!running && <div className="pong-overlay">
          <h3>{artStatus === 'loading' ? '正在打开球馆…' : artStatus === 'failed' ? '球馆素材载入失败' : view.phase === 'ready' ? '准备接发球' : view.phase === 'rally' ? '比赛已暂停' : view.message}</h3>
          {artStatus === 'failed' ? <button className="button primary" onClick={() => { setArtStatus('loading'); setArtAttempt(v => v + 1); }}>重新载入球馆</button> :
            <button className="button primary" disabled={artStatus !== 'ready'}
              onPointerDown={event => { startPointerType.current = event.pointerType; }}
              onClick={event => {
                const withMouse = event.detail > 0 && startPointerType.current === 'mouse';
                startPointerType.current = '';
                if (view.phase === 'finished') restart(); else start(withMouse);
              }}><Play size={16} />{mainLabel}</button>}
        </div>}
      </div>
      <div className="pong-toolbar"><div className="pong-main-controls">{running && <button className="button primary" onClick={pause}><Pause size={16} />暂停比赛<kbd>Space</kbd></button>}
        {running && <button className="button secondary" disabled={locked} onClick={lockMouse}>{locked ? '鼠标已锁定' : '锁定鼠标'}</button>}
        <button className="button secondary" onClick={() => { pause(); setRestartOpen(true); }}><RotateCcw size={15} />重新开始</button></div>
        <label className="pong-difficulty">电脑难度<select aria-label="乒乓球电脑难度" value={view.difficulty} disabled={view.phase !== 'ready' || view.player + view.computer > 0}
          onChange={event => restart(event.target.value as Difficulty)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p id="pong-instructions" className="pong-instructions">鼠标滑动挥拍，未锁定时也可按住球台拖动。空格暂停并释放鼠标，方向键或 WASD 移动球拍。<span><VolumeX size={13} />静音球馆</span></p>
      {lockNotice && <p className="pong-live-message" role="status">{lockNotice}</p>}
      <p className="pong-live-message" role="status">{view.phase === 'rally' && running && view.serveCountdown > 0 ? '电脑准备发球' : view.phase === 'rally' && running ? `连续回击 ${view.rally} 次` : ''}</p>
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
