export type Difficulty = 'easy' | 'normal' | 'hard';
export type Side = 'player' | 'computer';
export type PongBall = { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; hitter: Side };
export type PongState = {
  version: 1; difficulty: Difficulty; phase: 'ready' | 'rally' | 'point' | 'finished';
  player: number; computer: number; playerX: number; computerX: number;
  ball: PongBall; rally: number; bestRally: number; winner: Side | null;
  message: string; elapsed: number;
};
export type PongStats = { version: 1; wins: number; matches: number; bestRally: number };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const GRAVITY = 6;
const OPTIONS = { easy: { speed: 2.15, move: 1.1, error: .15 }, normal: { speed: 2.55, move: 1.6, error: .08 }, hard: { speed: 2.95, move: 2.1, error: .025 } };

export function newPongGame(difficulty: Difficulty = 'normal'): PongState {
  return { version: 1, difficulty, phase: 'ready', player: 0, computer: 0, playerX: 0, computerX: 0,
    ball: { x: 0, y: .14, z: .28, vx: 0, vy: 0, vz: 0, bounces: 0, hitter: 'player' },
    rally: 0, bestRally: 0, winner: null, message: '移动球拍，来一局轻松的。', elapsed: 0 };
}

export function matchWinner(player: number, computer: number): Side | null {
  if (Math.max(player, computer) < 11 || Math.abs(player - computer) < 2) return null;
  return player > computer ? 'player' : 'computer';
}

function strike(state: PongState, side: Side, serve = false) {
  const ball = state.ball;
  const direction = side === 'player' ? 1 : -1;
  const paddle = side === 'player' ? state.playerX : state.computerX;
  const offset = clamp((ball.x - paddle) / .25, -1, 1);
  const speed = Math.min(3.25, OPTIONS[state.difficulty].speed + state.rally * .025);
  ball.vy = direction * speed;
  // A real arc lands on the receiving half before reaching its paddle.
  // Fix the landing distance as rallies speed up, so fast shots remain playable.
  const flight = 1.4 / speed;
  ball.z = clamp(ball.z, .18, .48);
  ball.vz = (GRAVITY * flight * flight / 2 - ball.z) / flight;
  ball.vx = clamp(offset * .85 + (serve ? .13 * Math.sin(state.elapsed + state.player + state.computer) : 0), -1.15, 1.15);
  ball.hitter = side;
  ball.bounces = 0;
  if (!serve) state.rally++;
  state.bestRally = Math.max(state.bestRally, state.rally);
}

export function servePong(input: PongState): PongState {
  if (input.phase === 'rally' || input.phase === 'finished') return input;
  const state = { ...input, ball: { ...input.ball }, rally: 0, winner: null, phase: 'rally' as const, message: '来回击球中' };
  const points = state.player + state.computer;
  const server: Side = (points >= 20 ? points % 2 : Math.floor(points / 2) % 2) === 0 ? 'player' : 'computer';
  state.ball = { x: server === 'player' ? state.playerX : state.computerX, y: server === 'player' ? .14 : 1.86,
    z: .28, vx: 0, vy: 0, vz: 0, bounces: 0, hitter: server };
  strike(state, server, true);
  return state;
}

function point(state: PongState, winner: Side, reason: string) {
  state.ball.z = Math.max(0, state.ball.z);
  state.ball.vx = state.ball.vy = state.ball.vz = 0;
  state[winner]++;
  state.winner = winner;
  const finished = matchWinner(state.player, state.computer);
  state.phase = finished ? 'finished' : 'point';
  state.message = finished ? finished === 'player' ? '这局你赢啦！' : '电脑赢下这局，再来一次？'
    : `${winner === 'player' ? '你得一分' : '电脑得一分'} · ${reason}`;
}

/** Bounded substeps prevent tunnelling through the net or a paddle after a slow frame. */
export function stepPong(input: PongState, elapsedSeconds: number, targetX: number): PongState {
  if (input.phase !== 'rally' || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return input;
  const state = { ...input, ball: { ...input.ball } };
  const total = Math.min(.05, elapsedSeconds);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const dt = total / steps;
  const options = OPTIONS[state.difficulty];
  const wanted = Number.isFinite(targetX) ? clamp(targetX, -.88, .88) : state.playerX;
  for (let i = 0; i < steps && state.phase === 'rally'; i++) {
    state.elapsed += dt;
    state.playerX += clamp(wanted - state.playerX, -4 * dt, 4 * dt);
    const ball = state.ball;
    const prediction = ball.vy > 0 ? ball.x + ball.vx * Math.max(0, (1.86 - ball.y) / ball.vy) : ball.x * .45;
    const error = Math.sin(state.elapsed * 2.1 + state.player * .8 + state.computer * 1.7) * options.error;
    state.computerX += clamp(clamp(prediction + error, -.88, .88) - state.computerX, -options.move * dt, options.move * dt);
    const oldY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt - GRAVITY * dt * dt / 2;
    ball.vz -= GRAVITY * dt;
    if ((oldY - 1) * (ball.y - 1) <= 0 && oldY !== ball.y && ball.z < .155) {
      point(state, ball.hitter === 'player' ? 'computer' : 'player', '球碰到球网');
      break;
    }
    if (ball.z <= 0) {
      if (Math.abs(ball.x) > 1 || ball.y < 0 || ball.y > 2) {
        point(state, ball.hitter === 'player' ? 'computer' : 'player', '击球出界');
        break;
      }
      ball.bounces++;
      const receivingHalf = ball.hitter === 'player' ? ball.y > 1 : ball.y < 1;
      if (!receivingHalf) {
        point(state, ball.hitter === 'player' ? 'computer' : 'player', '未落到对方半台');
        break;
      }
      if (ball.bounces > 1) { point(state, ball.hitter, '对方没有接到球'); break; }
      ball.z = -ball.z;
      ball.vz = Math.abs(ball.vz) * .78;
    }
    const side: Side | null = oldY > .14 && ball.y <= .14 ? 'player'
      : oldY < 1.86 && ball.y >= 1.86 ? 'computer' : null;
    if (side) {
      const paddle = side === 'player' ? state.playerX : state.computerX;
      if (ball.bounces === 1 && Math.abs(ball.x - paddle) < .28 && ball.z > .025 && ball.z < .85) {
        ball.y = side === 'player' ? .14 : 1.86;
        strike(state, side);
      } else {
        const winner = ball.bounces === 1 ? ball.hitter : ball.hitter === 'player' ? 'computer' : 'player';
        point(state, winner, ball.bounces ? '对方没有接到球' : '击球出界');
      }
    }
  }
  return state;
}

/** Resume only validated local games, always paused by the view. No wall-clock catch-up. */
export function normalizePongSave(value: unknown): { game: PongState; stats: PongStats; playedMs: number } {
  const empty = { game: newPongGame(), stats: { version: 1 as const, wins: 0, matches: 0, bestRally: 0 }, playedMs: 0 };
  if (!value || typeof value !== 'object') return empty;
  const raw = value as Record<string, any>;
  const count = (n: unknown, max = 1_000_000) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
  if (raw.version !== 1) return empty;
  if (raw.stats?.version === 1 && count(raw.stats.wins) && count(raw.stats.matches) && raw.stats.wins <= raw.stats.matches && count(raw.stats.bestRally)) {
    empty.stats = { version: 1, wins: raw.stats.wins, matches: raw.stats.matches, bestRally: raw.stats.bestRally };
  }
  const game = raw.game as PongState;
  if (game && game.version === 1 && ['easy', 'normal', 'hard'].includes(game.difficulty) && ['ready', 'rally', 'point', 'finished'].includes(game.phase)
    && count(game.player, 1_000) && count(game.computer, 1_000) && count(game.rally, 100_000) && count(game.bestRally, 100_000)
    && Number.isFinite(game.playerX) && Math.abs(game.playerX) <= 1 && Number.isFinite(game.computerX) && Math.abs(game.computerX) <= 1
    && game.ball && [game.ball.x, game.ball.y, game.ball.z, game.ball.vx, game.ball.vy, game.ball.vz, game.elapsed].every(Number.isFinite)
    && Math.abs(game.ball.x) < 4 && game.ball.y > -1 && game.ball.y < 3 && game.ball.z >= 0 && game.ball.z < 4
    && Math.abs(game.ball.vx) < 10 && Math.abs(game.ball.vy) < 10 && Math.abs(game.ball.vz) < 20
    && count(game.ball.bounces, 2) && ['player', 'computer'].includes(game.ball.hitter)
    && [null, 'player', 'computer'].includes(game.winner) && game.elapsed >= 0 && game.elapsed < 10_000_000
    && (game.phase === 'finished') === Boolean(matchWinner(game.player, game.computer))) {
    empty.game = { ...game, ball: { ...game.ball }, message: game.phase === 'finished'
      ? matchWinner(game.player, game.computer) === 'player' ? '这局你赢啦！' : '这局结束啦。'
      : game.phase === 'rally' ? '比赛已暂停，继续就能接着打。' : '准备好，继续下一球。' };
    if (Number.isFinite(raw.playedMs) && raw.playedMs >= 0 && raw.playedMs <= 7 * 24 * 3600_000) empty.playedMs = raw.playedMs;
  }
  return empty;
}
