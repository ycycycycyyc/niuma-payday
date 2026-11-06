import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompanionMotion, stepCompanionMotion } from '../shared/desktop-pet-companion.mjs';
import type { CompanionAction, CompanionActionPose, CompanionMotionState, CompanionSleepPose } from '../shared/desktop-pet-companion.mjs';

const bounds = { x: -1280, y: -80, width: 1280, height: 800 };
const size = 76;
const origin = { x: -700, y: 300, facing: -1 as const, pose: 'walk', frame: 2, stepPhase: 2.6 };
const options = { bounds, size, random: () => 0.65 };

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function until(state: CompanionMotionState, phase: CompanionMotionState['activity'], config = options) {
  for (let index = 0; index < 20000; index++) {
    if (state.activity === phase) return state;
    state = stepCompanionMotion(state, 5, config);
  }
  assert.fail(`The companion never reached ${phase}`);
}

function beginWalk() {
  return until(createCompanionMotion(origin, bounds, size), 'walk');
}

function entry(pose: CompanionActionPose) {
  const activity: CompanionAction = pose.startsWith('sleep') ? 'sleep' : pose as CompanionAction;
  const state: CompanionMotionState = {
    ...createCompanionMotion({ ...origin, pose: 'stand', vx: 0 }, bounds, size),
    settleNext: 'enter', settleStableMs: 160, actionQueue: [activity],
    sleepQueue: activity === 'sleep' ? [pose as CompanionSleepPose] : [],
  };
  return until(state, 'enter');
}

function distinctFrames(states: CompanionMotionState[], phase: CompanionMotionState['activity']) {
  const result: number[] = [];
  for (const state of states.filter(value => value.activity === phase)) {
    if (state.frame !== result.at(-1)) result.push(state.frame);
  }
  return result;
}

function completeAction(pose: CompanionActionPose) {
  let state = entry(pose);
  const states = [state];
  while (state.activity !== 'settle') {
    state = stepCompanionMotion(state, 5, options);
    states.push(state);
    assert.ok(states.length < 10000, `${pose} must finish its exit`);
  }
  return states;
}

test('handoff preserves the first sprite and decelerates into a planted stance instead of freezing a walking image', () => {
  let state = createCompanionMotion(origin, bounds, size);
  assert.deepEqual([state.x, state.y, state.facing, state.pose, state.frame, state.stepPhase], [-700, 300, -1, 'walk', 2, 2.6]);
  assert.deepEqual([state.vx, state.vy], [-48, 0]);
  const first = stepCompanionMotion(state, 16, options);
  assert.ok(first.x < state.x, 'the first stride still moves');
  assert.ok(first.vx < 0 && first.vx > state.vx, 'the velocity eases down instead of being cleared');
  state = first;
  for (let index = 0; index < 100 && state.pose !== 'stand'; index++) state = stepCompanionMotion(state, 5, options);
  assert.equal(state.pose, 'stand');
  assert.equal(state.activity, 'settle');
  assert.deepEqual([state.vx, state.vy], [0, 0]);
  assert.ok(state.activityMs < 650);
  for (const [pose, frame] of [['stand', 0], ['sit', 3], ['wag', 6]] as const) {
    assert.equal(createCompanionMotion({ ...origin, pose }, bounds, size).frame, frame);
  }
  for (const pose of ['sleep', 'sleep-side', 'sleep-belly']) {
    assert.equal(createCompanionMotion({ ...origin, pose, frame: 99 }, bounds, size).frame, 5);
  }
  assert.equal(createCompanionMotion({ ...origin, pose: 'play', frame: 11 }, bounds, size).frame, 11);
});

test('a stroll eases in and out, then finishes its stride and stands before any action bridge', () => {
  let state = beginWalk();
  const start = state;
  state = stepCompanionMotion(state, 16, options);
  assert.ok(Math.hypot(state.x - start.x, state.y - start.y) > 0);
  assert.ok(Math.hypot(state.x - start.x, state.y - start.y) < 0.2);
  const frames = new Set<number>();
  let peakSpeed = 0, lastSpeed = 0;
  for (let index = 0; index < 1500 && state.activity === 'walk'; index++) {
    const next = stepCompanionMotion(state, 16, options);
    assert.equal(next.facing, start.facing, 'a moving dog cannot be mirrored to change direction');
    if (next.activity === 'walk') {
      lastSpeed = Math.hypot(next.vx, next.vy);
      peakSpeed = Math.max(peakSpeed, lastSpeed);
      frames.add(next.frame);
      assert.ok(lastSpeed <= 58);
    }
    state = next;
  }
  assert.ok(peakSpeed > 35);
  assert.ok(lastSpeed < 3);
  assert.equal(state.activity, 'settle');
  assert.deepEqual(frames, new Set([0, 1, 2, 3]));
  const settled = until(state, 'enter');
  assert.equal(settled.frame, 0);
  assert.ok(settled.pose.startsWith('bridge-'));
  assert.deepEqual([settled.vx, settled.vy], [0, 0]);
  assert.ok(settled.settleStableMs >= 160);
});

test('every action uses its full entry, complete cycles, reverse exit and a standing finish', () => {
  const bridges: Record<CompanionActionPose, string> = {
    lick: 'bridge-lick', play: 'bridge-play', sleep: 'bridge-sleep',
    'sleep-side': 'bridge-side', 'sleep-belly': 'bridge-belly', roll: 'bridge-side',
  };
  const cycleMs = { lick: 7 * 120, play: 23 * 110, sleep: 11 * 420, 'sleep-side': 11 * 420, 'sleep-belly': 11 * 420, roll: 4 * 110 };
  for (const pose of Object.keys(bridges) as CompanionActionPose[]) {
    const states = completeAction(pose);
    const first = states[0];
    const actions = states.filter(value => value.activity === 'action');
    const exits = states.filter(value => value.activity === 'exit');
    assert.ok(states.filter(value => value.activity === 'enter').every(value => value.pose === bridges[pose]));
    assert.deepEqual(distinctFrames(states, 'enter'), pose === 'lick' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.ok(actions.every(value => value.pose === pose));
    assert.equal(actions[0].activityDurationMs % cycleMs[pose], 0, `${pose} duration ends on a complete cycle`);
    assert.equal(actions.at(-1)!.frame, pose === 'roll' ? 3 : 0, `${pose} finishes its final authored frame`);
    assert.ok(actions[0].activityDurationMs - actions.at(-1)!.activityMs <= 5);
    assert.ok(exits.every(value => value.pose === (pose === 'roll' ? 'bridge-lick' : bridges[pose])));
    assert.deepEqual(distinctFrames(states, 'exit'), pose === 'roll' ? [3, 2, 1, 0]
      : pose === 'lick' ? [5, 4, 3, 2, 1, 0] : [7, 6, 5, 4, 3, 2, 1, 0]);
    assert.ok(states.every(value => value.x === first.x && value.y === first.y && value.vx === 0 && value.vy === 0));
    assert.deepEqual([states.at(-1)!.activity, states.at(-1)!.pose, states.at(-1)!.frame], ['settle', 'stand', 0]);
  }
});

test('licking and play return along every frame, sleep rises through its own bridge, and roll runs exactly once', () => {
  for (const pose of ['lick', 'play', 'sleep', 'sleep-side', 'sleep-belly'] as const) {
    const states = completeAction(pose);
    const frames = distinctFrames(states, 'action');
    const count = pose === 'play' ? 12 : pose === 'lick' ? 4 : 6;
    assert.deepEqual(new Set(frames), new Set(Array.from({ length: count }, (_, frame) => frame)));
    for (let index = 1; index < frames.length; index++) {
      assert.equal(Math.abs(frames[index] - frames[index - 1]), 1, `${pose} never snaps between ends of its cycle`);
    }
    assert.equal(frames.at(-1), 0);
    const firstExit = states.find(value => value.activity === 'exit')!;
    assert.equal(firstExit.frame, pose === 'lick' ? 5 : 7);
  }
  const roll = completeAction('roll');
  assert.deepEqual(distinctFrames(roll, 'action'), [0, 1, 2, 3]);
  assert.equal(roll.find(value => value.activity === 'action')!.activityDurationMs, 440);
  assert.equal(roll.find(value => value.activity === 'enter')!.pose, 'bridge-side');
  assert.deepEqual(distinctFrames(roll, 'exit'), [3, 2, 1, 0]);
});

test('turning stays planted, uses the old facing for all eight frames, then changes facing and sheet together', () => {
  let state = createCompanionMotion({ ...origin, pose: 'stand', facing: 1, vx: 0 }, bounds, size);
  state = until(state, 'turn');
  const point = { x: state.x, y: state.y };
  const frames: number[] = [];
  while (state.activity === 'turn') {
    if (state.frame !== frames.at(-1)) frames.push(state.frame);
    assert.equal(state.pose, 'bridge-turn');
    assert.equal(state.facing, 1);
    assert.deepEqual([state.x, state.y, state.vx, state.vy], [point.x, point.y, 0, 0]);
    state = stepCompanionMotion(state, 5, options);
  }
  assert.deepEqual(frames, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([state.activity, state.pose, state.frame, state.facing, state.turnTo], ['walk', 'walk', 0, -1, null]);
  assert.deepEqual([state.x, state.y, state.vx, state.vy], [point.x, point.y, 0, 0]);
  const moving = stepCompanionMotion(state, 16, options);
  assert.ok(moving.x < state.x);
  assert.ok(Math.abs(moving.vx) < 10);
});

test('all major activities rotate fairly, all sleep postures appear, and every facing change follows a stationary turn', () => {
  let state = createCompanionMotion(origin, bounds, size);
  const seeded = random(42);
  const activities: string[] = [], sleepPostures: string[] = [];
  for (let index = 0; index < 480_000 / 16; index++) {
    const next = stepCompanionMotion(state, 16, { bounds, size, random: seeded });
    if (next.activity === 'action' && state.activity !== 'action') {
      activities.push(next.lastAction!);
      if (next.lastAction === 'sleep') sleepPostures.push(next.pose);
    }
    if (next.facing !== state.facing) {
      assert.equal(state.activity, 'turn');
      assert.equal(next.activity, 'walk');
      assert.equal(next.pose, 'walk');
    }
    state = next;
  }
  assert.ok(activities.length >= 16);
  for (let index = 0; index + 4 <= activities.length; index += 4) {
    assert.deepEqual(new Set(activities.slice(index, index + 4)), new Set(['lick', 'play', 'sleep', 'roll']));
  }
  for (let index = 1; index < activities.length; index++) assert.notEqual(activities[index], activities[index - 1]);
  assert.ok(sleepPostures.length >= 3);
  for (let index = 0; index + 3 <= sleepPostures.length; index += 3) {
    assert.deepEqual(new Set(sleepPostures.slice(index, index + 3)), new Set(['sleep', 'sleep-side', 'sleep-belly']));
  }
  for (let index = 1; index < sleepPostures.length; index++) assert.notEqual(sleepPostures[index], sleepPostures[index - 1]);
});

test('pausing and reduced motion freeze every transition and resume without advancing a stale clock', () => {
  const actionStates = completeAction('sleep-belly');
  const states = ['enter', 'action', 'exit', 'settle'].map(phase => actionStates.find(state => state.activity === phase)!);
  states.push(beginWalk());
  states.push(until(createCompanionMotion({ ...origin, pose: 'stand', facing: 1, vx: 0 }, bounds, size), 'turn'));
  const frozenKeys = ['x', 'y', 'pose', 'frame', 'facing', 'stepPhase', 'activity', 'activityMs',
    'activityDurationMs', 'actionDurationMs', 'settleStableMs', 'activePose', 'turnTo'] as const;
  for (const state of states) for (const mode of ['paused', 'reducedMotion'] as const) {
    const stopped = stepCompanionMotion(state, 20_000, { ...options, [mode]: true });
    for (const key of frozenKeys) assert.equal(stopped[key], state[key], `${state.activity}.${key} freezes under ${mode}`);
    assert.deepEqual([stopped.vx, stopped.vy], [0, 0]);
    const resumed = stepCompanionMotion(stopped, 20_000, options);
    for (const key of frozenKeys) assert.equal(resumed[key], stopped[key]);
    const next = stepCompanionMotion(resumed, 5, options);
    assert.ok(next.activityMs >= resumed.activityMs || next.activity !== resumed.activity);
  }
});

test('screen and size changes clamp the dog and target, including during bridges and on tiny screens', () => {
  let state = createCompanionMotion({ ...origin, x: 3000, y: -900 }, bounds, size);
  assert.deepEqual([state.x, state.y], [-38, -42]);
  const seeded = random(7);
  for (let index = 0; index < 4000; index++) {
    state = stepCompanionMotion(state, 16, { bounds, size, random: seeded });
    assert.ok(state.x >= bounds.x + size / 2 && state.x <= bounds.x + bounds.width - size / 2);
    assert.ok(state.y >= bounds.y + size / 2 && state.y <= bounds.y + bounds.height - size / 2);
  }
  const tiny = { x: 100, y: 200, width: 30, height: 40 };
  state = entry('sleep-side');
  state = stepCompanionMotion(state, 16, { bounds: tiny, size: 120, random: seeded });
  assert.deepEqual([state.x, state.y], [115, 220]);
  assert.deepEqual(state.target, { x: 115, y: 220 });
  for (let index = 0; index < 2000; index++) {
    state = stepCompanionMotion(state, 16, { bounds: tiny, size: 120, random: seeded });
    assert.deepEqual([state.x, state.y], [115, 220]);
  }
});

test('long or invalid frame gaps cannot replay sleep time or skip whole transition clips', () => {
  for (const state of [beginWalk(), entry('play'), until(entry('sleep'), 'exit')]) {
    assert.deepEqual(stepCompanionMotion(state, 20_000, options), stepCompanionMotion(state, 64, options));
    for (const gap of [NaN, Infinity, -1]) {
      const next = stepCompanionMotion(state, gap, options);
      assert.deepEqual([next.x, next.y, next.activityMs, next.frame], [state.x, state.y, state.activityMs, state.frame]);
    }
    const next = stepCompanionMotion(state, 20_000, options);
    if (state.activity === 'enter' || state.activity === 'exit') assert.ok(Math.abs(next.frame - state.frame) <= 1);
  }
});

test('seeded choices are reproducible and stepping never mutates earlier states or their queues', () => {
  let left = createCompanionMotion(origin, bounds, size), right = createCompanionMotion(origin, bounds, size);
  const leftRandom = random(123), rightRandom = random(123);
  for (let index = 0; index < 4500; index++) {
    const previous = structuredClone(left), input = left;
    left = stepCompanionMotion(left, 16, { bounds, size, random: leftRandom });
    right = stepCompanionMotion(right, 16, { bounds, size, random: rightRandom });
    assert.deepEqual(input, previous);
    assert.deepEqual(left, right);
  }
});
