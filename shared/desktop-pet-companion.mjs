import { clampPetCenter } from './desktop-pet-motion.mjs';

const ACTIVITIES = ['lick', 'play', 'sleep', 'roll'];
const SLEEP_POSES = ['sleep', 'sleep-side', 'sleep-belly'];
const ACTION_FRAMES = { stand: 0, turn: 1, crouch: 2, sit: 3, lift: 4, paw: 5, wag: 6 };
const BRIDGES = { lick: 'bridge-lick', play: 'bridge-play', sleep: 'bridge-sleep',
  'sleep-side': 'bridge-side', 'sleep-belly': 'bridge-belly', roll: 'bridge-side' };
const DURATIONS = { lick: [3600, 6200], play: [4500, 7500], sleep: [11000, 19000] };
const SEQUENCES = {
  lick: [0, 1, 2, 3, 2, 1, 0],
  play: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  sleep: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0],
  roll: [0, 1, 2, 3],
};
const FRAME_MS = { lick: 120, play: 110, sleep: 420, roll: 110 };
const BRIDGE_FRAME_MS = 95;
const STABLE_MS = 160;
const MAX_FRAME_MS = 64;
const PAW_STEP = 7.5;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const category = pose => SLEEP_POSES.includes(pose) ? 'sleep' : pose;

function workArea(bounds) {
  return { x: finite(bounds?.x, 0), y: finite(bounds?.y, 0),
    width: Math.max(0, finite(bounds?.width, 0)), height: Math.max(0, finite(bounds?.height, 0)) };
}

function randomUnit(random) {
  return clamp(finite(random(), 0.5), 0, 1 - Number.EPSILON);
}

function range(random, min, max) {
  return min + randomUnit(random) * (max - min);
}

function takeFromBag(values, previousQueue, last, random) {
  const queue = [...previousQueue];
  if (!queue.length) {
    queue.push(...values);
    for (let index = queue.length - 1; index > 0; index--) {
      const other = Math.floor(randomUnit(random) * (index + 1));
      [queue[index], queue[other]] = [queue[other], queue[index]];
    }
    if (queue[0] === last) [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  return { item: queue.shift(), queue };
}

function beginSettle(state, next) {
  return { ...state, activity: 'settle', activityMs: 0, activityDurationMs: STABLE_MS,
    settleNext: next, settleStableMs: 0, turnTo: null, arrived: true };
}

function beginEntry(state, random) {
  const activity = takeFromBag(ACTIVITIES, state.actionQueue, state.lastAction, random);
  const sleep = activity.item === 'sleep'
    ? takeFromBag(SLEEP_POSES, state.sleepQueue, state.lastSleep, random) : null;
  const activePose = sleep?.item ?? activity.item;
  const cycleMs = SEQUENCES[activity.item].length * FRAME_MS[activity.item];
  // Deadlines choose a number of complete cycles. The final return-to-rest
  // frame is held before the corresponding bridge plays backwards.
  const actionDurationMs = activity.item === 'roll' ? cycleMs
    : Math.ceil(range(random, ...DURATIONS[activity.item]) / cycleMs) * cycleMs;
  // The lick sheet's first frame is the raised paw, before the bridge's
  // already-licking poses. Stop at frame 5 so the two clips join naturally.
  return { ...state, activity: 'enter', activityMs: 0, activityDurationMs: (activePose === 'lick' ? 6 : 8) * BRIDGE_FRAME_MS,
    actionDurationMs, activePose, pose: BRIDGES[activePose], frame: 0,
    actionQueue: activity.queue, lastAction: activity.item, sleepQueue: sleep?.queue ?? state.sleepQueue,
    lastSleep: sleep?.item ?? state.lastSleep, vx: 0, vy: 0, arrived: true };
}

function beginWalk(state) {
  return { ...state, activity: 'walk', activityMs: 0, activityDurationMs: 0,
    activePose: null, pose: 'walk', frame: 0, stepPhase: 0, vx: 0, vy: 0, arrived: false, turnTo: null };
}

function planWalk(state, random) {
  const angle = range(random, 0, Math.PI * 2);
  const distance = range(random, 85, 190);
  let target = clampPetCenter({ x: state.x + Math.cos(angle) * distance,
    y: state.y + Math.sin(angle) * distance * 0.38 }, state.workArea, state.spriteSize);
  if (Math.hypot(target.x - state.x, target.y - state.y) < 24) {
    const candidates = [
      { x: state.x - distance, y: state.y }, { x: state.x + distance, y: state.y },
      { x: state.x, y: state.y - distance * 0.38 }, { x: state.x, y: state.y + distance * 0.38 },
    ].map(point => clampPetCenter(point, state.workArea, state.spriteSize));
    target = candidates.reduce((farthest, point) =>
      Math.hypot(point.x - state.x, point.y - state.y) > Math.hypot(farthest.x - state.x, farthest.y - state.y) ? point : farthest);
  }
  if (Math.hypot(target.x - state.x, target.y - state.y) < 1) return beginEntry(state, random);
  const planned = { ...state, target, walkSpeed: range(random, 40, 58) };
  const facing = Math.abs(target.x - state.x) > 1 ? Math.sign(target.x - state.x) : state.facing;
  if (facing === state.facing) return beginWalk(planned);
  return { ...planned, activity: 'turn', activityMs: 0, activityDurationMs: 8 * BRIDGE_FRAME_MS,
    activePose: null, pose: 'bridge-turn', frame: 0, vx: 0, vy: 0, arrived: true, turnTo: facing };
}

function placePaws(state, point, vx, vy) {
  const position = clampPetCenter(point, state.workArea, state.spriteSize);
  const stepPhase = (state.stepPhase + Math.hypot(position.x - state.x, position.y - state.y) / PAW_STEP) % 4;
  return { ...state, ...position, vx: position.x === point.x ? vx : 0, vy: position.y === point.y ? vy : 0,
    stepPhase, pose: 'walk', frame: Math.floor(stepPhase) };
}

function settle(state, ms, random) {
  const seconds = ms / 1000;
  const response = Math.exp(-seconds / 0.065);
  const vx = state.vx * response, vy = state.vy * response;
  let next = placePaws(state, { x: state.x + (state.vx + vx) * 0.5 * seconds,
    y: state.y + (state.vy + vy) * 0.5 * seconds }, vx, vy);
  next.activityMs += ms;
  if (Math.hypot(next.vx, next.vy) >= 0.55) return { ...next, settleStableMs: 0 };
  next = { ...next, vx: 0, vy: 0, pose: 'stand', frame: 0, settleStableMs: state.settleStableMs + ms };
  if (next.settleStableMs < STABLE_MS) return next;
  return next.settleNext === 'enter' ? beginEntry(next, random) : planWalk(next, random);
}

function walk(state, ms) {
  const dx = state.target.x - state.x, dy = state.target.y - state.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.8) return beginSettle(state, 'enter');
  // A changed display may move the target behind her. Finish the current
  // stride before choosing another route, rather than flipping a moving dog.
  if (dx * state.facing < -1) return beginSettle(state, 'walk');
  const seconds = ms / 1000;
  const speed = Math.min(state.walkSpeed, distance * 1.6);
  const response = 1 - Math.exp(-seconds / 0.12);
  const vx = state.vx + (dx / distance * speed - state.vx) * response;
  const vy = state.vy + (dy / distance * speed - state.vy) * response;
  const stepX = (state.vx + vx) * 0.5 * seconds;
  const stepY = (state.vy + vy) * 0.5 * seconds;
  if (stepX * dx + stepY * dy >= distance * distance) return beginSettle(state, 'enter');
  return { ...placePaws(state, { x: state.x + stepX, y: state.y + stepY }, vx, vy), activityMs: state.activityMs + ms };
}

function exitFrames(pose) {
  if (pose === 'roll') return [3, 2, 1, 0];
  return pose === 'lick' ? [5, 4, 3, 2, 1, 0] : [7, 6, 5, 4, 3, 2, 1, 0];
}

function advanceClip(state, ms) {
  const time = state.activityMs + ms;
  if (time < state.activityDurationMs) {
    let frame;
    if (state.activity === 'action') {
      const name = category(state.activePose);
      const sequence = SEQUENCES[name];
      frame = sequence[Math.floor(time / FRAME_MS[name]) % sequence.length];
    } else if (state.activity === 'exit') frame = exitFrames(state.activePose)[Math.floor(time / BRIDGE_FRAME_MS)];
    else frame = Math.floor(time / BRIDGE_FRAME_MS);
    return { ...state, activityMs: time, frame };
  }
  if (state.activity === 'turn') {
    // Frame 7 is still mirrored with the OLD facing. Change the facing and
    // sheet together so that the completed turn cannot be mirrored twice.
    return beginWalk({ ...state, facing: state.turnTo });
  }
  if (state.activity === 'enter') return { ...state, activity: 'action', activityMs: 0,
    activityDurationMs: state.actionDurationMs, pose: state.activePose, frame: 0 };
  if (state.activity === 'action') {
    const sequence = exitFrames(state.activePose);
    return { ...state, activity: 'exit', activityMs: 0, activityDurationMs: sequence.length * BRIDGE_FRAME_MS,
      pose: state.activePose === 'roll' ? 'bridge-lick' : BRIDGES[state.activePose], frame: sequence[0] };
  }
  return beginSettle({ ...state, activePose: null, pose: 'stand', frame: 0 }, 'walk');
}

export function createCompanionMotion(pet, bounds, size) {
  const area = workArea(bounds);
  const spriteSize = Math.max(0, finite(size, 76));
  const position = clampPetCenter({ x: finite(pet?.x, area.x + area.width / 2), y: finite(pet?.y, area.y + area.height / 2) }, area, spriteSize);
  const pose = pet?.pose === 'walk' || Object.hasOwn(ACTION_FRAMES, pet?.pose) || Object.hasOwn(BRIDGES, pet?.pose)
    || pet?.pose === 'bridge-turn' || Object.values(BRIDGES).includes(pet?.pose) ? pet.pose : 'stand';
  const phase = finite(pet?.stepPhase, 0) % 4;
  const stepPhase = phase < 0 ? phase + 4 : phase;
  const count = pose.startsWith('bridge-') ? 8 : Object.hasOwn(BRIDGES, pose)
    ? Math.max(...SEQUENCES[category(pose)]) + 1 : 0;
  const frame = pose === 'walk' ? Math.floor(stepPhase)
    : count ? clamp(Math.floor(finite(pet?.frame, 0)), 0, count - 1) : ACTION_FRAMES[pose];
  const facing = pet?.facing < 0 ? -1 : 1;
  const speed = pose === 'walk' ? Math.max(0, finite(pet?.speed, 48)) : 0;
  return { ...position, vx: finite(pet?.vx, facing * speed), vy: finite(pet?.vy, 0),
    facing, stepPhase, frame, pose, arrived: true,
    activity: 'settle', activityMs: 0, activityDurationMs: STABLE_MS, activePose: null, actionDurationMs: 0,
    settleNext: 'walk', settleStableMs: 0, turnTo: null, target: { ...position }, walkSpeed: 48,
    actionQueue: [], lastAction: null, sleepQueue: [], lastSleep: null, workArea: area, spriteSize, suspended: false };
}

export function placeCompanionMotion(state, point, bounds) {
  const area = workArea(bounds);
  const position = clampPetCenter(point, area, state.spriteSize);
  return beginSettle({ ...state, ...position, workArea: area, target: position, vx: 0, vy: 0,
    activePose: null, pose: 'stand', frame: 0 }, 'walk');
}

export function stepCompanionMotion(previous, elapsedMs, {
  bounds = previous.workArea, size = previous.spriteSize, paused = false, reducedMotion = false, random = Math.random,
} = {}) {
  const area = workArea(bounds);
  const spriteSize = Math.max(0, finite(size, previous.spriteSize));
  const position = clampPetCenter(previous, area, spriteSize);
  let state = { ...previous, ...position, workArea: area, spriteSize,
    target: clampPetCenter(previous.target, area, spriteSize),
    vx: position.x === previous.x ? previous.vx : 0, vy: position.y === previous.y ? previous.vy : 0,
    suspended: paused || reducedMotion };
  if (paused || reducedMotion) return { ...state, vx: 0, vy: 0 };
  // Sleep, explicit pauses and an event-loop stall must not skip whole clips.
  let remaining = previous.suspended ? 0 : clamp(finite(elapsedMs, 0), 0, MAX_FRAME_MS);
  while (remaining > 0) {
    const ms = Math.min(16, remaining);
    if (state.activity === 'walk') state = walk(state, ms);
    else if (state.activity === 'settle' || state.activity === 'rest') state = settle(state, ms, random);
    else state = advanceClip(state, ms);
    remaining -= ms;
  }
  return state;
}
