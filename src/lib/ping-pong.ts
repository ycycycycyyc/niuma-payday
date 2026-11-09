import camera from '../assets/pong-court/camera.json' with { type: 'json' };

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Side = 'player' | 'computer';
export type PongTarget = { x: number; y: number };
export type PongBall = { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; hitter: Side; serveStage: 'server' | 'receiver' | 'in-play' };
export type PongEffect = { kind: 'bounce' | 'hit' | 'net' | 'out'; x: number; y: number; z: number; age: number };
export type PongState = {
  version: 2; difficulty: Difficulty; phase: 'ready' | 'rally' | 'point' | 'finished';
  player: number; computer: number; playerX: number; playerY: number; computerX: number; computerY: number;
  playerVX: number; playerVY: number; computerVX: number; computerVY: number;
  playerSwing: number; computerSwing: number; serveCountdown: number;
  ball: PongBall; rally: number; bestRally: number; winner: Side | null;
  message: string; elapsed: number; effect: PongEffect | null;
};
export type PongStats = { version: 1; wins: number; matches: number; bestRally: number };
export const PONG_CANVAS = { width: camera.width, height: camera.height };
export const PADDLE_HEIGHT = .17;
export const NET_HEIGHT = .155;
// At the rear limit the rendered handle has 21 px of clearance below it.
export const PONG_PLAYER_BOUNDS = { xMin: -1.12, xMax: 1.12, yMin: -.36, yMax: .90 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const GRAVITY = 6;
const OPTIONS = {
  easy: { speed: 1.55, move: 1.75, error: .07, lookahead: .075 },
  normal: { speed: 1.8, move: 2.2, error: .045, lookahead: .105 },
  hard: { speed: 2.05, move: 2.85, error: .018, lookahead: .13 },
};
const opponent = (side: Side): Side => side === 'player' ? 'computer' : 'player';

// Blender exports the exact camera used to render the court and net.
const [cameraX, cameraY, cameraW] = camera.matrix;
function cameraDepth(x: number, y: number, z: number) {
  return cameraW[0] * x + cameraW[1] * y + cameraW[2] * z + cameraW[3];
}
export function projectPong(x: number, y: number, z = 0) {
  const depth = cameraDepth(x, y, z);
  return {
    x: (cameraX[0] * x + cameraX[1] * y + cameraX[2] * z + cameraX[3]) / depth,
    y: (cameraY[0] * x + cameraY[1] * y + cameraY[2] * z + cameraY[3]) / depth,
  };
}
export function unprojectPong(pixelX: number, pixelY: number, z = PADDLE_HEIGHT) {
  // Intersect the pixel's camera ray with the racket's plane.
  const a = cameraX[0] - pixelX * cameraW[0], b = cameraX[1] - pixelX * cameraW[1];
  const c = cameraY[0] - pixelY * cameraW[0], d = cameraY[1] - pixelY * cameraW[1];
  const offset = cameraW[2] * z + cameraW[3];
  const rx = pixelX * offset - cameraX[2] * z - cameraX[3];
  const ry = pixelY * offset - cameraY[2] * z - cameraY[3];
  const determinant = a * d - b * c;
  return { x: (rx * d - b * ry) / determinant, y: (a * ry - c * rx) / determinant };
}
export function paddleProjection(x: number, y: number) {
  const scale = cameraDepth(0, 0, PADDLE_HEIGHT) / cameraDepth(x, y, PADDLE_HEIGHT);
  return { ...projectPong(x, y, PADDLE_HEIGHT), radiusX: 29 * scale, radiusY: 20 * scale };
}
export function ballProjection(x: number, y: number, z = 0) {
  return { ...projectPong(x, y, z), radius: 7.5 * cameraDepth(0, 0, 0) / cameraDepth(x, y, z) };
}
function playerHalfWidth(y: number) {
  // Perspective enlarges the racket closest to the camera. Taper just the
  // new backswing area, leaving the previous playing area at its full width.
  const { yMin, xMax } = PONG_PLAYER_BOUNDS;
  const fullWidthY = -.12, rearHalfWidth = 1.06;
  const depth = clamp((y - yMin) / (fullWidthY - yMin), 0, 1);
  return rearHalfWidth + (xMax - rearHalfWidth) * depth;
}
export function clampPlayerTarget(input: PongTarget, fallback: PongTarget = { x: 0, y: .28 }): PongTarget {
  const y = clamp(Number.isFinite(input?.y) ? input.y : fallback.y, PONG_PLAYER_BOUNDS.yMin, PONG_PLAYER_BOUNDS.yMax);
  const halfWidth = playerHalfWidth(y);
  return {
    x: clamp(Number.isFinite(input?.x) ? input.x : fallback.x, -halfWidth, halfWidth),
    y,
  };
}

/** Continuous relative sweep against the painted ellipse, expanded by ball radius and 2px tolerance. */
export function sweptPaddleContact(beforeBall: PongBall, ball: PongBall, before: PongTarget, paddle: PongTarget): number | null {
  const a = ballProjection(beforeBall.x, beforeBall.y, beforeBall.z), b = ballProjection(ball.x, ball.y, ball.z);
  const p = paddleProjection(before.x, before.y), q = paddleProjection(paddle.x, paddle.y);
  const radiusX = Math.max(p.radiusX, q.radiusX) + Math.max(a.radius, b.radius) + 2;
  const radiusY = Math.max(p.radiusY, q.radiusY) + Math.max(a.radius, b.radius) + 2;
  const x = (a.x - p.x) / radiusX, y = (a.y - p.y) / radiusY;
  const dx = ((b.x - q.x) - (a.x - p.x)) / radiusX;
  const dy = ((b.y - q.y) - (a.y - p.y)) / radiusY;
  const denominator = dx * dx + dy * dy;
  const time = denominator > 0 ? clamp(-(x * dx + y * dy) / denominator, 0, 1) : 0;
  return (x + dx * time) ** 2 + (y + dy * time) ** 2 <= 1 ? time : null;
}

export function newPongGame(difficulty: Difficulty = 'normal'): PongState {
  return { version: 2, difficulty, phase: 'ready', player: 0, computer: 0, playerX: 0, playerY: .28, computerX: 0, computerY: 1.72,
    playerVX: 0, playerVY: 0, computerVX: 0, computerVY: 0, playerSwing: 0, computerSwing: 0,
    serveCountdown: 0,
    ball: { x: 0, y: 1.72, z: PADDLE_HEIGHT + .08, vx: 0, vy: 0, vz: 0, bounces: 0, hitter: 'computer', serveStage: 'server' },
    rally: 0, bestRally: 0, winner: null, message: '前后滑动挥拍，把球打回去。', elapsed: 0, effect: null };
}

export function matchWinner(player: number, computer: number): Side | null {
  if (Math.max(player, computer) < 11 || Math.abs(player - computer) < 2) return null;
  return player > computer ? 'player' : 'computer';
}

export function servePong(input: PongState): PongState {
  if (input.phase === 'rally' || input.phase === 'finished') return input;
  return { ...input, phase: 'rally', rally: 0, winner: null, serveCountdown: 1.1,
    computerY: 1.72, computerVX: 0, computerVY: 0, playerVX: 0, playerVY: 0, playerSwing: 0, computerSwing: 0,
    ball: { x: input.computerX, y: 1.72, z: PADDLE_HEIGHT + .08, vx: 0, vy: 0, vz: 0, bounces: 0, hitter: 'computer', serveStage: 'server' },
    message: '电脑准备发球，先把球拍移到来球附近。', effect: null };
}

function launchServe(state: PongState) {
  const firstFlight = .22;
  state.ball = { x: state.computerX, y: 1.72, z: .28, vx: (clamp(state.playerX, -.55, .55) - state.computerX) / .74,
    vy: -1.5, vz: (GRAVITY * firstFlight ** 2 / 2 - .28) / firstFlight, bounces: 0, hitter: 'computer', serveStage: 'server' };
  state.message = '球先落双方半台，再向前挥拍回击。';
}

function effect(state: PongState, kind: PongEffect['kind']) {
  const { x, y, z } = state.ball;
  state.effect = { kind, x, y, z: Math.max(0, z), age: 0 };
}

function point(state: PongState, winner: Side, reason: string, kind: 'net' | 'out' = 'out') {
  effect(state, kind);
  state.ball.vx = state.ball.vy = state.ball.vz = 0;
  state[winner]++;
  state.winner = winner;
  const finished = matchWinner(state.player, state.computer);
  state.phase = finished ? 'finished' : 'point';
  state.message = finished ? finished === 'player' ? '这局你赢啦！' : '电脑赢下这局，再来一次？'
    : `${winner === 'player' ? '你得一分' : '电脑得一分'} · ${reason}`;
}

function movePaddle(from: PongTarget, to: PongTarget, speed: number, dt: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance > 0 ? Math.min(1, speed * dt / distance) : 0;
  const vx = dx * scale / dt, vy = dy * scale / dt;
  return { x: scale === 1 ? to.x : from.x + vx * dt, y: scale === 1 ? to.y : from.y + vy * dt, vx, vy };
}

function strike(state: PongState, side: Side) {
  const ball = state.ball;
  const options = OPTIONS[state.difficulty];
  const vx = side === 'player' ? state.playerVX : state.computerVX;
  const vy = side === 'player' ? state.playerVY : state.computerVY;
  const power = clamp((Math.hypot(vx, vy) - .5) / 4.5, 0, 1);
  const desiredSpeed = side === 'player' ? 1.5 + power * 1.7 : options.speed + power * .4;
  const landingY = side === 'player' ? 1.30 + power * .56 : .50;
  const aim = side === 'player' ? clamp(state.playerX * .25 + vx * .20, -.86, .86)
    : clamp(Math.sin(state.elapsed * 1.7 + state.computer * .7) * (state.difficulty === 'easy' ? .36 : .66), -.75, .75);
  const distance = Math.abs(landingY - ball.y);
  const netFraction = clamp(Math.abs(1 - ball.y) / distance, .02, .98);
  // Solve the arc through its actual contact height and desired landing point.
  // Low contacts gain flight time, never an invisible upward teleport.
  const netClearance = NET_HEIGHT + .045;
  const minimumFlight = Math.sqrt(Math.max(0, (netClearance - ball.z * (1 - netFraction))
    / (GRAVITY / 2 * netFraction * (1 - netFraction))));
  const flight = Math.max(.20, distance / desiredSpeed, minimumFlight);
  ball.vy = (side === 'player' ? 1 : -1) * distance / flight;
  ball.vz = (GRAVITY * flight ** 2 / 2 - ball.z) / flight;
  ball.vx = clamp((aim - ball.x) / flight, -2.8, 2.8);
  ball.hitter = side; ball.bounces = 0; ball.serveStage = 'in-play';
  state.rally++; state.bestRally = Math.max(state.bestRally, state.rally);
  if (side === 'player') state.playerSwing = 1;
  else state.computerSwing = 1;
  state.message = '接到了！继续看球，向前挥拍。';
  effect(state, 'hit');
}

/** Short input segments may be stepped several times per frame without losing the swipe. */
export function stepPong(input: PongState, elapsedSeconds: number, target: PongTarget): PongState {
  if (input.phase !== 'rally' || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return input;
  const state = { ...input, ball: { ...input.ball }, effect: input.effect ? { ...input.effect } : null };
  const total = Math.min(.05, elapsedSeconds);
  const steps = Math.max(1, Math.ceil(total / (1 / 300)));
  const dt = total / steps;
  const wanted = clampPlayerTarget(target, { x: state.playerX, y: state.playerY });
  // A captured input segment is traversed over its full duration. Re-chasing its
  // endpoint each microstep would turn a slow 2px drag into a 5.2-unit spike.
  const playerPlan = movePaddle({ x: state.playerX, y: state.playerY }, wanted, 5.2, total);
  const options = OPTIONS[state.difficulty];
  for (let i = 0; i < steps && state.phase === 'rally'; i++) {
    state.elapsed += dt;
    state.playerSwing = Math.max(0, state.playerSwing - dt * 3.5);
    state.computerSwing = Math.max(0, state.computerSwing - dt * 3.5);
    if (state.effect) { state.effect.age += dt; if (state.effect.age > .65) state.effect = null; }
    const beforePlayer = { x: state.playerX, y: state.playerY }, beforeComputer = { x: state.computerX, y: state.computerY };
    const player = { ...clampPlayerTarget({ x: beforePlayer.x + playerPlan.vx * dt, y: beforePlayer.y + playerPlan.vy * dt }),
      vx: playerPlan.vx, vy: playerPlan.vy };
    state.playerX = player.x; state.playerY = player.y; state.playerVX = player.vx; state.playerVY = player.vy;
    let computerTarget = { x: state.ball.x * .35, y: 1.72 };
    if (state.ball.hitter === 'player') {
      const untilBounce = Math.max(0, (state.ball.vz + Math.sqrt(Math.max(0, state.ball.vz ** 2 + 2 * GRAVITY * state.ball.z))) / GRAVITY);
      const landingY = state.ball.y + state.ball.vy * untilBounce;
      const prediction = state.ball.x + state.ball.vx * (untilBounce + .02);
      const error = Math.sin(state.elapsed * 2.1 + state.player * .8 + state.computer * 1.7) * options.error;
      const swing = state.ball.bounces === 1 || untilBounce < options.lookahead;
      computerTarget = { x: clamp(prediction + error, -1.06, 1.06), y: swing ? 1.10 : clamp(landingY + .18, 1.26, 2.12) };
    }
    const computer = movePaddle(beforeComputer, computerTarget, options.move, dt);
    state.computerX = computer.x; state.computerY = computer.y; state.computerVX = computer.vx; state.computerVY = computer.vy;
    if (state.serveCountdown > 0) {
      state.serveCountdown = Math.max(0, state.serveCountdown - dt);
      state.ball = { ...state.ball, x: state.computerX, y: state.computerY, z: PADDLE_HEIGHT + .08, vx: 0, vy: 0, vz: 0 };
      if (state.serveCountdown === 0) launchServe(state);
      continue;
    }
    const beforeBall = { ...state.ball };
    const ball = state.ball;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    ball.z += ball.vz * dt - GRAVITY * dt * dt / 2; ball.vz -= GRAVITY * dt;
    if ((beforeBall.y - 1) * (ball.y - 1) <= 0 && beforeBall.y !== ball.y) {
      const crossing = (1 - beforeBall.y) / (ball.y - beforeBall.y);
      const height = beforeBall.z + (ball.z - beforeBall.z) * crossing;
      if (height < NET_HEIGHT && height >= -.02) { point(state, opponent(ball.hitter), '球碰到球网', 'net'); break; }
    }
    const inside = Math.abs(ball.x) <= 1 && ball.y >= 0 && ball.y <= 2;
    if (ball.z <= 0 && beforeBall.z > 0 && inside) {
      const correctHalf = ball.hitter === 'player' ? ball.y > 1 : ball.y < 1;
      if (ball.serveStage === 'server') {
        if (correctHalf) { point(state, opponent(ball.hitter), '发球未先落己方半台'); break; }
        ball.serveStage = 'receiver';
      } else {
        if (!correctHalf) { point(state, opponent(ball.hitter), '未落到对方半台'); break; }
        ball.bounces++;
        if (ball.bounces > 1) { point(state, ball.hitter, ball.hitter === 'computer' ? '你未能在第二次落地前接回' : '电脑未能在第二次落地前接回'); break; }
        ball.serveStage = 'in-play';
      }
      ball.z = Math.max(.00001, -ball.z); ball.vz = Math.abs(ball.vz) * .78;
      effect(state, 'bounce');
    }
    if (ball.z < -.45 || Math.abs(ball.x) > 1.5 || ball.y < -.48 || ball.y > 2.48) {
      point(state, ball.bounces === 1 && ball.serveStage === 'in-play' ? ball.hitter : opponent(ball.hitter), ball.bounces
        ? ball.hitter === 'computer' ? '你没有接回，球已落地或出界' : '电脑漏接，球已落地或出界' : '击球出界');
      break;
    }
    if (ball.bounces !== 1 || ball.serveStage !== 'in-play' || ball.z < -.015) continue;
    const receiver = opponent(ball.hitter);
    const oldPaddle = receiver === 'player' ? beforePlayer : beforeComputer;
    const paddle = receiver === 'player' ? player : computer;
    const forward = receiver === 'player' ? paddle.vy : -paddle.vy;
    if (forward < .18 || Math.hypot(paddle.vx, paddle.vy) < .65) continue;
    const contact = sweptPaddleContact(beforeBall, ball, oldPaddle, paddle);
    if (contact !== null) {
      ball.x = beforeBall.x + (ball.x - beforeBall.x) * contact;
      ball.y = beforeBall.y + (ball.y - beforeBall.y) * contact;
      ball.z = beforeBall.z + (ball.z - beforeBall.z) * contact;
      strike(state, receiver);
    }
  }
  return state;
}

/** Old v1 rallies restart from service while keeping their valid score and history. */
export function normalizePongSave(value: unknown): { game: PongState; stats: PongStats; playedMs: number } {
  const empty = { game: newPongGame(), stats: { version: 1 as const, wins: 0, matches: 0, bestRally: 0 }, playedMs: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const raw = value as Record<string, any>;
  const count = (n: unknown, max = 1_000_000) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
  const bounded = (n: unknown, min: number, max: number) => Number.isFinite(n) && Number(n) >= min && Number(n) <= max;
  if (raw.version !== 1) return empty;
  if (raw.stats?.version === 1 && count(raw.stats.wins) && count(raw.stats.matches) && raw.stats.wins <= raw.stats.matches && count(raw.stats.bestRally)) {
    empty.stats = { version: 1, wins: raw.stats.wins, matches: raw.stats.matches, bestRally: raw.stats.bestRally };
  }
  const g = raw.game;
  if (!g || ![1, 2].includes(g.version) || !['easy', 'normal', 'hard'].includes(g.difficulty)
    || !['ready', 'rally', 'point', 'finished'].includes(g.phase) || !count(g.player, 1000) || !count(g.computer, 1000)
    || !count(g.rally, 100_000) || !count(g.bestRally, 100_000) || (g.phase === 'finished') !== Boolean(matchWinner(g.player, g.computer))) return empty;
  const winner = matchWinner(g.player, g.computer);
  if (g.version === 1) {
    empty.game = { ...newPongGame(g.difficulty), player: g.player, computer: g.computer, bestRally: Math.max(g.bestRally, g.rally),
      phase: winner ? 'finished' : g.player + g.computer > 0 || g.phase !== 'ready' ? 'point' : 'ready', winner,
      message: winner ? winner === 'player' ? '这局你赢啦！' : '这局结束啦。' : '挥拍玩法已就绪，保留比分，从下一次发球继续。' };
  } else {
    const b = g.ball;
    if (!bounded(g.playerY, PONG_PLAYER_BOUNDS.yMin, PONG_PLAYER_BOUNDS.yMax)) return empty;
    const halfWidth = playerHalfWidth(g.playerY);
    if (!bounded(g.playerX, -halfWidth, halfWidth) || !bounded(g.computerX, -1.12, 1.12) || !bounded(g.computerY, 1.1, 2.12)
      || ![g.playerVX, g.playerVY, g.computerVX, g.computerVY].every(n => bounded(n, -5.3, 5.3))
      || !bounded(g.playerSwing, 0, 1) || !bounded(g.computerSwing, 0, 1) || !bounded(g.serveCountdown, 0, 1.1)
      || !bounded(g.elapsed, 0, 10_000_000)
      || !b || !bounded(b.x, -1.6, 1.6) || !bounded(b.y, -.6, 2.6) || !bounded(b.z, -.6, 4)
      || !bounded(b.vx, -8, 8) || !bounded(b.vy, -8, 8) || !bounded(b.vz, -15, 15) || !count(b.bounces, 2)
      || !['player', 'computer'].includes(b.hitter) || !['server', 'receiver', 'in-play'].includes(b.serveStage)) return empty;
    const e = g.effect;
    const safeEffect = e && ['bounce', 'hit', 'net', 'out'].includes(e.kind) && [e.x, e.y, e.z, e.age].every(Number.isFinite)
      && Math.abs(e.x) <= 2 && e.y >= -1 && e.y <= 3 && e.z >= 0 && e.z < 4 && e.age >= 0 && e.age <= .65 ? { kind: e.kind, x: e.x, y: e.y, z: e.z, age: e.age } : null;
    empty.game = { version: 2, difficulty: g.difficulty, phase: g.phase, player: g.player, computer: g.computer,
      playerX: g.playerX, playerY: g.playerY, computerX: g.computerX, computerY: g.computerY,
      playerVX: 0, playerVY: 0, computerVX: 0, computerVY: 0,
      playerSwing: 0, computerSwing: 0, serveCountdown: g.serveCountdown,
      ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, bounces: b.bounces, hitter: b.hitter, serveStage: b.serveStage },
      rally: g.rally, bestRally: Math.max(g.bestRally, g.rally), winner: winner ?? (['player', 'computer'].includes(g.winner) ? g.winner : null),
      message: winner ? winner === 'player' ? '这局你赢啦！' : '这局结束啦。' : g.phase === 'rally' ? '比赛已暂停，继续后向前挥拍回击。' : '准备好，继续下一球。', elapsed: g.elapsed, effect: safeEffect };
  }
  if (bounded(raw.playedMs, 0, 7 * 24 * 3600_000)) empty.playedMs = raw.playedMs;
  return empty;
}
