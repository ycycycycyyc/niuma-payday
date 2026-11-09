import assert from 'node:assert/strict';
import { test } from 'node:test';
import camera from '../src/assets/pong-court/camera.json' with { type: 'json' };
import sprites from '../src/assets/pong-equipment/sprites.json' with { type: 'json' };
import { ballProjection, clampPlayerTarget, matchWinner, newPongGame, normalizePongSave, paddleProjection, PADDLE_HEIGHT, projectPong, servePong, stepPong, sweptPaddleContact, unprojectPong, type Difficulty, type PongBall, type PongState, type PongTarget, type Side } from '../src/lib/ping-pong.ts';

const saved = (game = newPongGame()) => ({ version: 1, game, stats: { version: 1, wins: 2, matches: 3, bestRally: 17 }, playedMs: 15_000 });
const fixture = (ball: Partial<PongBall> = {}, state: Partial<PongState> = {}): PongState => ({
  ...newPongGame('easy'), phase: 'rally', playerY: .16, ...state,
  ball: { x: 0, y: .5, z: .17, vx: 0, vy: -1.5, vz: .2, bounces: 1, hitter: 'computer', serveStage: 'in-play', ...ball },
});
function netFault(state: PongState, hitter: Side): PongState {
  return stepPong({ ...state, serveCountdown: 0, ball: { x: 0, y: hitter === 'player' ? .999 : 1.001, z: .05, vx: 0, vy: hitter === 'player' ? 2 : -2, vz: 0, bounces: 0, hitter, serveStage: 'in-play' } }, .01, { x: 0, y: .16 });
}
function frontSwipe(state = fixture(), dt = .016) {
  for (const y of [.16, .22, .30, .38, .46, .58]) {
    state = stepPong(state, dt, { x: 0, y });
    if (state.rally > 0 || state.phase !== 'rally') break;
  }
  return state;
}
function diagonal(sign: number) {
  let state = fixture({}, { playerX: -.2 * sign, playerY: .30 });
  for (let i = 0; i < 10 && state.rally === 0; i++) state = stepPong(state, .016, { x: (-.2 + i * .08) * sign, y: .30 + i * .04 });
  return state;
}
function untilPoint(state: PongState, target: PongTarget = { x: 0, y: .16 }) {
  let longest = state.rally;
  for (let i = 0; i < 600 && state.phase === 'rally'; i++) { state = stepPong(state, .016, target); longest = Math.max(longest, state.rally); }
  return { state, longest };
}
const landing = (ball: PongBall) => ball.y + ball.vy * (ball.vz + Math.sqrt(ball.vz ** 2 + 12 * ball.z)) / 6;

test('11-point scoring needs a two-point lead and the deciding point cannot score twice', () => {
  assert.equal(matchWinner(10, 8), null);
  assert.equal(matchWinner(11, 10), null);
  assert.equal(matchWinner(12, 11), null);
  assert.equal(matchWinner(11, 9), 'player');
  assert.equal(matchWinner(11, 13), 'computer');
  let state = fixture({}, { player: 10, computer: 10 });
  for (const hitter of ['computer', 'player', 'computer', 'computer'] as Side[]) state = netFault(servePong(state), hitter);
  assert.equal(state.player, 13); assert.equal(state.computer, 11);
  assert.equal(state.phase, 'finished'); assert.equal(state.winner, 'player');
  assert.equal(stepPong(state, .05, { x: 0, y: .5 }), state);
  assert.equal(servePong(state), state);
});

test('computer service provides preparation time then bounces on both actual halves before reception', () => {
  let state = servePong(newPongGame('easy'));
  assert.equal(state.ball.hitter, 'computer');
  for (let i = 0; i < 30; i++) state = stepPong(state, .016, { x: 0, y: .16 });
  assert.ok(state.serveCountdown > .5);
  assert.equal(state.ball.vy, 0);
  let ownHalf = false, receivingHalf = false;
  for (let i = 0; i < 200 && state.phase === 'rally'; i++) {
    state = stepPong(state, .016, { x: 0, y: .16 });
    if (state.effect?.kind === 'bounce' && state.ball.serveStage === 'receiver') { ownHalf = true; assert.ok(state.effect.y > 1); }
    if (state.effect?.kind === 'bounce' && state.ball.serveStage === 'in-play') { receivingHalf = true; assert.ok(state.effect.y < 1); break; }
  }
  assert.ok(ownHalf); assert.ok(receivingHalf);
  assert.equal(state.ball.bounces, 1); assert.equal(state.rally, 0);
});

test('stationary overlap does not return a ball, while the same visible contact with a forward swipe does', () => {
  const overlap = fixture({ y: .30 }, { playerY: .30 });
  const still = stepPong(overlap, .016, { x: 0, y: .30 });
  assert.equal(still.rally, 0); assert.equal(still.ball.hitter, 'computer');
  const swung = stepPong(overlap, .016, { x: 0, y: .34 });
  assert.equal(swung.rally, 1); assert.equal(swung.ball.hitter, 'player');
  assert.ok(swung.ball.vy > 0);
  const unattended = untilPoint(fixture());
  assert.equal(unattended.state.computer, 1); assert.equal(unattended.longest, 0);
});

test('a ball visibly 100px to the side cannot be magically returned by a forward swipe', () => {
  const input = fixture({ x: .279, y: .30 }, { playerY: .30 });
  const actual = stepPong(input, .016, { x: 0, y: .35 });
  const ball = ballProjection(input.ball.x, input.ball.y, input.ball.z), paddle = paddleProjection(input.playerX, input.playerY);
  assert.ok(Math.abs(ball.x - paddle.x) > paddle.radiusX + ball.radius + 50);
  assert.equal(actual.rally, 0);
  const close = stepPong(fixture({ x: .05, y: .30 }, { playerY: .30 }), .016, { x: 0, y: .35 });
  assert.equal(close.rally, 1);
});

test('continuous relative motion catches a crossing swipe even when its endpoints miss the painted ellipse', () => {
  const input = fixture({ y: .5, vy: -.1 }, { playerX: -.13, playerY: .47 });
  const destination = { x: .13, y: .53 };
  assert.notEqual(sweptPaddleContact(input.ball, input.ball, { x: -.13, y: .47 }, destination), null);
  const actual = stepPong(input, .05, destination);
  assert.equal(actual.rally, 1);
  assert.equal(actual.ball.hitter, 'player');
});

test('the same physical stroke played slower produces a slower, shorter return without teleporting height', () => {
  const fast = frontSwipe(fixture(), .016), medium = frontSwipe(fixture(), .032), slow = frontSwipe(fixture(), .05);
  for (const shot of [fast, medium, slow]) assert.equal(shot.rally, 1);
  assert.ok(fast.ball.vy > medium.ball.vy && medium.ball.vy > slow.ball.vy);
  assert.ok(landing(fast.ball) > landing(medium.ball) && landing(medium.ball) > landing(slow.ball));
  assert.ok(landing(fast.ball) > 1.8 && landing(slow.ball) < 1.5);
  assert.ok(Math.abs(fast.ball.z - .17) < .025);
  for (const shot of [fast, medium, slow]) {
    const netTime = (1 - shot.ball.y) / shot.ball.vy;
    const netHeight = shot.ball.z + shot.ball.vz * netTime - 3 * netTime ** 2;
    assert.ok(netHeight >= .19, `short shot did not clear the net: ${netHeight}`);
  }
});

test('swipe direction causes opposite lateral returns and volleying before the first receiving bounce is rejected', () => {
  const right = diagonal(1), left = diagonal(-1);
  assert.equal(right.rally, 1); assert.equal(left.rally, 1);
  assert.ok(right.ball.vx > .5); assert.ok(left.ball.vx < -.5);
  assert.ok(Math.abs(right.ball.vx + left.ball.vx) < .01);
  const volley = stepPong(fixture({ y: .30, bounces: 0 }, { playerY: .30 }), .016, { x: 0, y: .35 });
  assert.equal(volley.rally, 0);
});

test('a missed ball continues across the old auto-hit line and only scores on later ground/out failure', () => {
  const input = fixture({ x: .8, y: .15, z: .20, vz: 0 });
  let state = stepPong(input, .016, { x: 0, y: .16 });
  assert.ok(state.ball.y < .14); assert.equal(state.phase, 'rally');
  assert.equal(state.computer, 0); assert.ok(state.ball.vy < 0);
  state = untilPoint(state).state;
  assert.equal(state.phase, 'point'); assert.equal(state.computer, 1);
  assert.ok(state.ball.y < 0 || state.ball.bounces > 1);
});

test('natural easy service can be manually returned and all computer difficulties can return ordinary center shots', () => {
  let state = servePong({ ...newPongGame('easy'), playerY: .16 });
  for (let i = 0; i < 200 && state.ball.bounces === 0; i++) state = stepPong(state, .016, { x: 0, y: .16 });
  assert.equal(state.ball.bounces, 1);
  for (const y of [.24, .34, .46, .58, .70]) { state = stepPong(state, .016, { x: 0, y }); if (state.rally) break; }
  assert.equal(state.rally, 1);
  for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const shot = frontSwipe(fixture({}, { difficulty }), .032);
    assert.ok(untilPoint(shot).longest >= 2, `${difficulty} could not return an ordinary shot`);
  }
  const winningDiagonal = untilPoint(diagonal(1));
  assert.equal(winningDiagonal.state.player, 1);
  assert.equal(winningDiagonal.longest, 1);
});

test('physics bounds gaps and invalid target samples without mutating the previous state', () => {
  const input = fixture(), original = structuredClone(input);
  const short = stepPong(input, .05, { x: .4, y: .6 });
  assert.deepEqual(stepPong(input, 60, { x: .4, y: .6 }), short);
  assert.deepEqual(input, original); assert.notEqual(short.ball, input.ball);
  for (const delta of [0, -1, NaN, Infinity]) assert.equal(stepPong(input, delta, { x: 0, y: .16 }), input);
  assert.deepEqual(stepPong(input, .02, { x: NaN, y: Infinity }), stepPong(input, .02, { x: input.playerX, y: input.playerY }));
  assert.deepEqual(clampPlayerTarget({ x: 99, y: -99 }), { x: 1.06, y: -.36 });
  const tiny = stepPong(input, .001, { x: .001, y: .161 });
  assert.ok(tiny.elapsed > input.elapsed); assert.ok(Number.isFinite(tiny.playerVX));
});

test('the game projects Blender table and net landmarks and inverts racket positions across the playing area', () => {
  const landmarks = [
    [projectPong(-1, 0), camera.table.corners.nearLeft], [projectPong(1, 0), camera.table.corners.nearRight],
    [projectPong(-1, 2), camera.table.corners.farLeft], [projectPong(1, 2), camera.table.corners.farRight],
    [projectPong(0, 1, .155), camera.netTop.center],
  ];
  for (const [game, blender] of landmarks) {
    assert.ok(Math.hypot(game.x - blender.x, game.y - blender.y) < .01);
  }
  for (const point of [{ x: -1.06, y: -.36 }, { x: -1, y: -.12 }, { x: 0, y: .28 }, { x: 1.1, y: .90 }]) {
    const pixel = projectPong(point.x, point.y, PADDLE_HEIGHT);
    const inverse = unprojectPong(pixel.x, pixel.y);
    assert.ok(Math.abs(inverse.x - point.x) < 1e-10 && Math.abs(inverse.y - point.y) < 1e-10);
    assert.equal(paddleProjection(point.x, point.y).x, pixel.x);
  }
});

test('new saves round-trip paused rallies and point states with safe metadata and independent objects', () => {
  for (const game of [frontSwipe(), untilPoint(fixture()).state]) {
    const value = saved(game);
    value.game.message = '<script>untrusted</script>';
    const result = normalizePongSave(JSON.parse(JSON.stringify(value)));
    assert.equal(result.game.phase, game.phase); assert.equal(result.game.player, game.player); assert.equal(result.game.computer, game.computer);
    assert.equal(result.playedMs, 15_000); assert.equal(result.stats.wins, 2);
    assert.equal(result.game.version, 2); assert.ok(!result.game.message.includes('<script>'));
    assert.notEqual(result.game.ball, game.ball); assert.equal(result.game.playerVY, 0);
  }
});

test('old player bounds and the new rear corners both produce valid resumable local saves', () => {
  for (const target of [{ x: -1.12, y: -.12 }, { x: 1.12, y: .90 }, { x: -1.06, y: -.36 }, { x: 1.06, y: -.36 }]) {
    let game = servePong(newPongGame());
    for (let i = 0; i < 30; i++) game = stepPong(game, .016, target);
    const restored = normalizePongSave(saved(game));
    assert.equal(restored.game.phase, 'rally');
    assert.ok(Math.hypot(game.playerX - target.x, game.playerY - target.y) < 1e-8);
    assert.equal(restored.game.playerX, game.playerX);
    assert.equal(restored.game.playerY, game.playerY);
  }
});

test('the racket can pull behind the baseline and the first upward movement releases it at the lower limit', () => {
  const sprite = sprites.player;
  // Opaque extents of the rendered rubber and handle within its 512px sprite.
  const opaque = { left: 138, right: 374, bottom: 415 };
  for (const x of [-2, 0, 2]) {
    const rear = clampPlayerTarget({ x, y: -2 });
    let game = servePong(newPongGame());
    for (let i = 0; i < 30; i++) game = stepPong(game, .016, { x, y: -2 });
    const face = paddleProjection(game.playerX, game.playerY);
    assert.ok(face.y > camera.table.corners.nearLeft.y);
    const bottom = face.y + (opaque.bottom - sprite.centerY) * face.radiusY / sprite.radiusY;
    assert.ok(camera.height - bottom > 15 && camera.height - bottom < 25);
    assert.ok(face.x + (opaque.left - sprite.centerX) * face.radiusX / sprite.radiusX > 15);
    assert.ok(face.x + (opaque.right - sprite.centerX) * face.radiusX / sprite.radiusX < camera.width - 15);

    const reverse = unprojectPong(face.x, face.y - 1);
    game = stepPong(game, .016, reverse);
    assert.ok(game.playerY > rear.y && game.playerVY > 0);
    assert.ok(Math.abs(paddleProjection(game.playerX, game.playerY).y - (face.y - 1)) < 1e-8);
  }
});

test('legacy airborne saves retain valid scores and history but resume safely from a new serve', () => {
  const value = saved();
  const legacy = { ...value, game: { version: 1, difficulty: 'hard', phase: 'rally', player: 6, computer: 4, rally: 3, bestRally: 8,
    playerX: 0, computerX: 0, ball: { x: .2, y: .7, z: .1, vx: 0, vy: -3, vz: 1, hitter: 'computer', bounces: 1 }, winner: null, elapsed: 100 } };
  const restored = normalizePongSave(legacy);
  assert.equal(restored.game.player, 6); assert.equal(restored.game.computer, 4); assert.equal(restored.game.bestRally, 8);
  assert.equal(restored.game.difficulty, 'hard'); assert.equal(restored.game.phase, 'point'); assert.equal(restored.game.ball.vy, 0);
  assert.equal(restored.stats.wins, 2); assert.equal(restored.playedMs, 15_000);
  assert.ok(servePong(restored.game).serveCountdown > 1);
});

test('malicious or non-finite game data never enters the simulation and valid history remains', () => {
  for (const mutate of [
    (g: PongState) => { g.ball.x = NaN; }, (g: PongState) => { g.ball.vz = Infinity; },
    (g: PongState) => { g.playerY = 100; }, (g: PongState) => { g.playerY = -.37; },
    (g: PongState) => { g.playerY = -.36; g.playerX = 1.12; }, (g: PongState) => { g.playerVX = 100; },
    (g: PongState) => { g.elapsed = -1; }, (g: PongState) => { g.ball.serveStage = 'bad' as never; },
    (g: PongState) => { g.phase = 'finished'; }, (g: PongState) => { g.player = 11; },
  ]) {
    const value = saved(fixture()); mutate(value.game);
    const result = normalizePongSave(value);
    assert.equal(result.game.phase, 'ready'); assert.equal(result.game.player, 0);
    assert.equal(result.stats.wins, 2); assert.equal(result.playedMs, 0);
  }
  for (const value of [null, false, [], { version: 99 }, { version: 1, game: {} }]) assert.equal(normalizePongSave(value).game.phase, 'ready');
});
