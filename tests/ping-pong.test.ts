import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchWinner, newPongGame, normalizePongSave, servePong, stepPong, type Difficulty, type PongBall, type PongState, type Side } from '../src/lib/ping-pong.ts';

const saved = (game = newPongGame()) => ({ version: 1, game, stats: { version: 1, wins: 2, matches: 3, bestRally: 17 }, playedMs: 15_000 });
const ballState = (ball: Partial<PongBall>, state: Partial<PongState> = {}): PongState => ({
  ...servePong(newPongGame()), ...state,
  ball: { x: 0, y: .7, z: .3, vx: 0, vy: 2, vz: 0, bounces: 0, hitter: 'player', ...ball },
});
function netFault(state: PongState, hitter: Side): PongState {
  return stepPong({ ...state, ball: { x: 0, y: hitter === 'player' ? .999 : 1.001, z: .05, vx: 0, vy: hitter === 'player' ? 2 : -2, vz: 0, bounces: 0, hitter } }, .01, 0);
}
const clamp = (value: number) => Math.max(-.88, Math.min(.88, value));

test('11-point scoring requires a two-point lead and stops after the deciding point', () => {
  assert.equal(matchWinner(10, 8), null);
  assert.equal(matchWinner(11, 10), null);
  assert.equal(matchWinner(12, 11), null);
  assert.equal(matchWinner(11, 9), 'player');
  assert.equal(matchWinner(11, 13), 'computer');
  let state = { ...servePong(newPongGame()), player: 10, computer: 10 };
  state = netFault(state, 'computer');
  assert.equal(state.player, 11);
  assert.equal(state.phase, 'point');
  state = netFault(servePong(state), 'player');
  assert.equal(state.computer, 11);
  assert.equal(state.phase, 'point');
  state = netFault(servePong(state), 'computer');
  assert.equal(state.phase, 'point');
  state = netFault(servePong(state), 'computer');
  assert.equal(state.player, 13);
  assert.equal(state.computer, 11);
  assert.equal(state.winner, 'player');
  assert.equal(state.phase, 'finished');
  assert.equal(stepPong(state, .05, .8), state);
  assert.equal(servePong(state), state);
});

test('service alternates every two points and after every point at deuce', () => {
  for (const [player, computer, server] of [
    [0, 0, 'player'], [1, 0, 'player'], [2, 0, 'computer'], [2, 1, 'computer'],
    [2, 2, 'player'], [10, 10, 'player'], [11, 10, 'computer'], [11, 11, 'player'],
  ] as const) {
    const state = servePong({ ...newPongGame(), player, computer, phase: 'point', rally: 7, bestRally: 9 });
    assert.equal(state.ball.hitter, server);
    assert.equal(Math.sign(state.ball.vy), server === 'player' ? 1 : -1);
    assert.equal(state.rally, 0);
    assert.equal(state.bestRally, 9);
    assert.equal(state.phase, 'rally');
  }
  const rally = servePong(newPongGame());
  assert.equal(servePong(rally), rally);
});

test('net faults, landing on the wrong half, and out-of-table shots award the opponent', () => {
  for (const hitter of ['player', 'computer'] as const) {
    const loser = hitter, winner = hitter === 'player' ? 'computer' : 'player';
    const net = netFault(servePong(newPongGame()), hitter);
    assert.equal(net[winner], 1);
    assert.equal(net[loser], 0);
    assert.match(net.message, /球网/);
    const wrongHalf = stepPong(ballState({ y: hitter === 'player' ? .6 : 1.4, z: .001, vz: -1, hitter, vy: hitter === 'player' ? 1 : -1 }), .01, 0);
    assert.equal(wrongHalf[winner], 1);
    assert.match(wrongHalf.message, /未落到对方半台/);
    const out = stepPong(ballState({ x: 1.01, y: hitter === 'player' ? 1.5 : .5, z: .001, vz: -1, hitter, vy: hitter === 'player' ? 1 : -1 }), .01, 0);
    assert.equal(out[winner], 1);
    assert.match(out.message, /出界/);
  }
});

test('a legal first bounce continues, a second bounce scores, and a missed paddle scores only once', () => {
  const legal = stepPong(ballState({ y: 1.5, z: .001, vz: -1 }), .01, 0);
  assert.equal(legal.phase, 'rally');
  assert.equal(legal.ball.bounces, 1);
  assert.ok(legal.ball.z >= 0);
  assert.ok(legal.ball.vz > 0);
  const double = stepPong(ballState({ y: 1.5, z: .001, vz: -1, bounces: 1 }), .01, 0);
  assert.equal(double.phase, 'point');
  assert.equal(double.player, 1);
  assert.match(double.message, /没有接到球/);
  const missed = stepPong(ballState({ x: -.9, y: .15, z: .2, vy: -2, vz: .5, hitter: 'computer', bounces: 1 }, { playerX: .8 }), .02, .8);
  assert.equal(missed.computer, 1);
  assert.equal(missed.phase, 'point');
  assert.equal(stepPong(missed, .05, -.9), missed);
});

test('both serves support successive returns at every difficulty without skipping the receiving bounce', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] satisfies Difficulty[]) {
    for (const computerServes of [false, true]) {
      let state = servePong({ ...newPongGame(difficulty), player: computerServes ? 2 : 0, phase: computerServes ? 'point' : 'ready' });
      let best = 0;
      const hitterChanges: { hitter: Side; bounces: number }[] = [];
      for (let i = 0; i < 2000 && state.phase === 'rally'; i++) {
        const target = state.ball.vy < 0 ? state.ball.x + state.ball.vx * ((.14 - state.ball.y) / state.ball.vy) : 0;
        const prior = state;
        state = stepPong(state, 1 / 120, clamp(target));
        if (state.ball.hitter !== prior.ball.hitter && state.phase === 'rally') hitterChanges.push({ hitter: state.ball.hitter, bounces: prior.ball.bounces });
        best = Math.max(best, state.rally);
        assert.ok(Object.values(state.ball).filter(value => typeof value === 'number').every(Number.isFinite));
      }
      assert.ok(best >= 2, `${difficulty}, ${computerServes ? 'computer' : 'player'} serve did not produce a playable return`);
      assert.ok(hitterChanges.length >= 2);
      assert.ok(hitterChanges.every(hit => hit.bounces === 1));
    }
  }
});

test('physics clamps long gaps and non-finite input, and leaves the previous state unchanged', () => {
  const input = servePong(newPongGame());
  const snapshot = structuredClone(input);
  const short = stepPong(input, .05, .7);
  assert.deepEqual(stepPong(input, 60, .7), short);
  assert.deepEqual(input, snapshot);
  assert.notEqual(short, input);
  assert.notEqual(short.ball, input.ball);
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) assert.equal(stepPong(input, delta, .5), input);
  assert.deepEqual(stepPong(input, .02, NaN), stepPong(input, .02, input.playerX));
  assert.deepEqual(stepPong(input, .02, 1000), stepPong(input, .02, .88));
});

test('valid local saves resume independent objects and sanitize user-provided messages', () => {
  const input = saved(servePong(newPongGame('hard')));
  input.game.message = '<script>untrusted</script>';
  const restored = normalizePongSave(input);
  assert.equal(restored.game.difficulty, 'hard');
  assert.equal(restored.game.phase, 'rally');
  assert.notEqual(restored.game, input.game);
  assert.notEqual(restored.game.ball, input.game.ball);
  assert.equal(restored.playedMs, 15_000);
  assert.deepEqual(restored.stats, input.stats);
  assert.match(restored.game.message, /暂停/);
  assert.ok(!restored.game.message.includes('<script>'));
  restored.game.ball.x = .8;
  assert.equal(input.game.ball.x, 0);
});

test('completed point saves preserve the score after bounce faults and out-of-table landings', () => {
  for (const ball of [
    { y: 1.5, z: .001, vz: -1, bounces: 1 },
    { y: .6, z: .001, vz: -1 },
    { x: 1.01, y: 1.5, z: .001, vz: -1 },
  ]) {
    const point = stepPong(ballState(ball), .01, 0);
    assert.equal(point.phase, 'point');
    const restored = normalizePongSave(JSON.parse(JSON.stringify(saved(point))));
    assert.equal(restored.game.phase, 'point');
    assert.equal(restored.game.player, point.player);
    assert.equal(restored.game.computer, point.computer);
    assert.equal(restored.playedMs, 15_000);
  }
});

test('corrupt, non-finite, extreme, and inconsistent winner-state saves never enter the engine', () => {
  for (const value of [undefined, null, false, [], { version: 2 }, { version: 1, game: {} }]) {
    assert.equal(normalizePongSave(value).game.phase, 'ready');
  }
  const corruptions: ((value: ReturnType<typeof saved>) => void)[] = [
    value => { value.game.ball.x = NaN; }, value => { value.game.ball.vz = Infinity; },
    value => { value.game.elapsed = -1; }, value => { value.game.playerX = 100; },
    value => { value.game.ball.y = 100; }, value => { value.game.ball.z = -1; },
    value => { value.game.ball.vx = 100; }, value => { value.game.player = 1.5; },
    value => { value.game.rally = -1; }, value => { value.game.difficulty = 'unknown' as Difficulty; },
    value => { value.game.ball.hitter = 'unknown' as Side; }, value => { value.game.ball.bounces = 100; },
    value => { value.game.phase = 'finished'; },
    value => { value.game.player = 11; value.game.computer = 0; },
  ];
  for (const corrupt of corruptions) {
    const value = saved(servePong(newPongGame('hard')));
    corrupt(value);
    const restored = normalizePongSave(value);
    assert.equal(restored.game.phase, 'ready');
    assert.equal(restored.game.difficulty, 'normal');
    assert.equal(restored.playedMs, 0);
    assert.equal(restored.stats.wins, 2);
  }
  const value = saved();
  value.stats.wins = 4;
  value.playedMs = Infinity;
  const restored = normalizePongSave(value);
  assert.equal(restored.stats.wins, 0);
  assert.equal(restored.playedMs, 0);
});
