import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompanionMotion, stepCompanionMotion } from '../shared/desktop-pet-companion.mjs';

const bounds = { x: -1280, y: -80, width: 1280, height: 800 };
const size = 76;
const origin = { x: -700, y: 300, facing: -1, pose: 'walk', frame: 2, stepPhase: 2.6 };
const options = { bounds, size, random: () => 0.65 };

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function beginWalk() {
  let state = createCompanionMotion(origin, bounds, size);
  while (state.activity !== 'walk') state = stepCompanionMotion(state, 16, options);
  return state;
}

test('the companion starts at the existing dog and preserves her current sprite pose', () => {
  const pet = createCompanionMotion(origin, bounds, size);
  assert.deepEqual([pet.x, pet.y, pet.facing, pet.pose, pet.frame, pet.stepPhase], [-700, 300, -1, 'walk', 2, 2.6]);
  assert.deepEqual([pet.vx, pet.vy], [0, 0]);
  for (const [pose, frame] of [['stand', 0], ['sit', 3], ['wag', 6]] as const) {
    assert.equal(createCompanionMotion({ ...origin, pose }, bounds, size).frame, frame);
  }
  for (const pose of ['sleep', 'sleep-side', 'sleep-belly']) {
    assert.equal(createCompanionMotion({ ...origin, pose, frame: 99 }, bounds, size).frame, 5);
  }
  assert.equal(createCompanionMotion({ ...origin, pose: 'play', frame: 11 }, bounds, size).frame, 11);
});

test('walking eases in and out at an unhurried speed with distance-based paw frames', () => {
  let state = beginWalk();
  const start = state;
  state = stepCompanionMotion(state, 16, options);
  assert.ok(Math.hypot(state.x - start.x, state.y - start.y) > 0);
  assert.ok(Math.hypot(state.x - start.x, state.y - start.y) < 0.2, 'the first step accelerates from rest');
  const frames = new Set<number>();
  let peakSpeed = 0;
  let lastSpeed = 0;
  for (let index = 0; index < 1000 && state.activity === 'walk'; index++) {
    const next = stepCompanionMotion(state, 16, options);
    if (next.activity === 'walk') {
      const speed = Math.hypot(next.vx, next.vy);
      peakSpeed = Math.max(peakSpeed, speed);
      lastSpeed = speed;
      frames.add(next.frame);
      assert.ok(speed <= 58);
    }
    state = next;
  }
  assert.ok(peakSpeed > 35);
  assert.ok(lastSpeed < 3, 'the companion slows before stopping');
  assert.equal(state.activity, 'action');
  assert.deepEqual(frames, new Set([0, 1, 2, 3]));
  assert.deepEqual([state.vx, state.vy, state.arrived], [0, 0, true]);
});

test('major activities share one shuffle bag while sleep postures rotate in their own bag', () => {
  let state = createCompanionMotion(origin, bounds, size);
  const seeded = random(42);
  const activities: string[] = [];
  const sleepPostures: string[] = [];
  const frames = new Map<string, Set<number>>();
  const durations = new Map<string, number>();
  const frameCounts = { lick: 4, play: 12, sleep: 6, 'sleep-side': 6, 'sleep-belly': 6, roll: 4 };
  for (let index = 0; index < 360_000 / 16; index++) {
    const next = stepCompanionMotion(state, 16, { bounds, size, random: seeded });
    if (next.activity === 'action') {
      if (state.activity !== 'action') {
        const activity = next.pose.startsWith('sleep') ? 'sleep' : next.pose;
        activities.push(activity);
        if (activity === 'sleep') sleepPostures.push(next.pose);
        durations.set(activity, next.activityDurationMs);
      }
      assert.ok(Number.isInteger(next.frame) && next.frame >= 0 && next.frame < frameCounts[next.pose]);
      if (!frames.has(next.pose)) frames.set(next.pose, new Set());
      frames.get(next.pose)!.add(next.frame);
    }
    state = next;
  }
  assert.ok(activities.length >= 12, `observed ${activities.length} activities`);
  for (let index = 0; index + 4 <= activities.length; index += 4) {
    assert.deepEqual(new Set(activities.slice(index, index + 4)), new Set(['lick', 'play', 'sleep', 'roll']));
  }
  for (let index = 1; index < activities.length; index++) assert.notEqual(activities[index], activities[index - 1]);
  assert.ok(sleepPostures.length >= 3);
  for (let index = 0; index + 3 <= sleepPostures.length; index += 3) {
    assert.deepEqual(new Set(sleepPostures.slice(index, index + 3)), new Set(['sleep', 'sleep-side', 'sleep-belly']));
  }
  for (let index = 1; index < sleepPostures.length; index++) assert.notEqual(sleepPostures[index], sleepPostures[index - 1]);
  assert.deepEqual(new Set(frames.keys()), new Set(Object.keys(frameCounts)));
  for (const [pose, set] of frames) assert.deepEqual(set, new Set(Array.from({ length: frameCounts[pose] }, (_, frame) => frame)));
  assert.ok(durations.get('sleep')! >= 11000);
  assert.ok(durations.get('roll')! <= 3400);
});

test('toy play visits all twelve frames forward and back without jumps, and sleeping breathes forward and back', () => {
  const initial = createCompanionMotion(origin, bounds, size);
  for (const [pose, sequence, frameMs] of [
    ['play', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1], 110],
    ...['sleep', 'sleep-side', 'sleep-belly'].map(pose => [pose, [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0], 420]),
  ] as Array<[string, number[], number]>) {
    let state = { ...initial, activity: 'action', pose, frame: 0, activityMs: 0, activityDurationMs: 20000 };
    const frames = [0];
    for (let time = 10; time <= frameMs * (sequence.length - 1); time += 10) {
      state = stepCompanionMotion(state, 10, options);
      if (time % frameMs === 0) frames.push(state.frame);
    }
    assert.deepEqual(frames, sequence, `${pose} uses its complete authored sequence`);
    for (let index = 1; index < frames.length; index++) {
      assert.equal(Math.abs(frames[index] - frames[index - 1]), 1, `${pose} never skips a pose at either end of the loop`);
    }
    const frozen = stepCompanionMotion(state, 10000, { ...options, paused: true });
    assert.deepEqual([frozen.pose, frozen.frame, frozen.activityMs], [state.pose, state.frame, state.activityMs]);
  }
});

test('pausing and reduced motion freeze both position and activities, and resume starts a fresh clock', () => {
  for (const mode of ['paused', 'reducedMotion'] as const) {
    let state = beginWalk();
    for (let index = 0; index < 20; index++) state = stepCompanionMotion(state, 16, options);
    const before = state;
    const stopped = stepCompanionMotion(state, 20_000, { ...options, [mode]: true });
    for (const key of ['x', 'y', 'pose', 'frame', 'activity', 'activityMs']) assert.equal(stopped[key], before[key]);
    assert.deepEqual([stopped.vx, stopped.vy], [0, 0]);
    const resumed = stepCompanionMotion(stopped, 20_000, options);
    assert.deepEqual([resumed.x, resumed.y, resumed.activityMs], [stopped.x, stopped.y, stopped.activityMs]);
    const next = stepCompanionMotion(resumed, 16, options);
    assert.ok(Math.hypot(next.x - resumed.x, next.y - resumed.y) < 0.2);
    assert.ok(next.activityMs > resumed.activityMs);
  }
});

test('current position and travel goals remain visible after work-area or sprite-size changes', () => {
  let state = createCompanionMotion({ ...origin, x: 3000, y: -900 }, bounds, size);
  assert.deepEqual([state.x, state.y], [-38, -42]);
  const seeded = random(7);
  for (let index = 0; index < 2000; index++) {
    state = stepCompanionMotion(state, 16, { bounds, size, random: seeded });
    assert.ok(state.x >= bounds.x + size / 2 && state.x <= bounds.x + bounds.width - size / 2);
    assert.ok(state.y >= bounds.y + size / 2 && state.y <= bounds.y + bounds.height - size / 2);
  }
  const tiny = { x: 100, y: 200, width: 30, height: 40 };
  state = stepCompanionMotion(state, 16, { bounds: tiny, size: 120, random: seeded });
  assert.deepEqual([state.x, state.y], [115, 220]);
  assert.deepEqual(state.target, { x: 115, y: 220 });
  for (let index = 0; index < 1000; index++) {
    state = stepCompanionMotion(state, 16, { bounds: tiny, size: 120, random: seeded });
    assert.deepEqual([state.x, state.y], [115, 220]);
  }
});

test('long or invalid frame gaps cannot replay a sleep interval or skip activity cycles', () => {
  const state = beginWalk();
  assert.deepEqual(stepCompanionMotion(state, 20_000, options), stepCompanionMotion(state, 64, options));
  for (const gap of [NaN, Infinity, -1]) {
    const next = stepCompanionMotion(state, gap, options);
    assert.deepEqual([next.x, next.y, next.activityMs], [state.x, state.y, state.activityMs]);
  }
});

test('seeded random choices are reproducible and stepping leaves earlier states untouched', () => {
  let left = createCompanionMotion(origin, bounds, size);
  let right = createCompanionMotion(origin, bounds, size);
  const leftRandom = random(123);
  const rightRandom = random(123);
  for (let index = 0; index < 3500; index++) {
    const previous = structuredClone(left);
    const input = left;
    left = stepCompanionMotion(left, 16, { bounds, size, random: leftRandom });
    right = stepCompanionMotion(right, 16, { bounds, size, random: rightRandom });
    assert.deepEqual(input, previous);
    assert.deepEqual(left, right);
  }
});
