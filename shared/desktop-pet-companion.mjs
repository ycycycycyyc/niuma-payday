import { clampPetCenter } from './desktop-pet-motion.mjs';

// The companion takes short, unhurried walks between activities. Shuffle bags
// keep every activity in rotation without making her routine predictable.
const ACTIVITIES = ['lick', 'play', 'sleep', 'roll'];
const SLEEP_POSES = ['sleep', 'sleep-side', 'sleep-belly'];
const ACTION_FRAMES = { stand: 0, turn: 1, crouch: 2, sit: 3, lift: 4, paw: 5, wag: 6 };
const DURATIONS = { lick: [3600, 6200], play: [4500, 7500], sleep: [11000, 19000], roll: [2400, 3400] };
const FRAME_COUNTS = { lick: 4, play: 12, sleep: 6, 'sleep-side': 6, 'sleep-belly': 6, roll: 4 };
const FRAME_MS = { lick: 220, play: 110, roll: 230 };
const SLEEP_BREATH = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];
const SLEEP_FRAME_MS = 420;
const MAX_FRAME_MS = 64;
const PAW_STEP = 7.5;

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function workArea(bounds) {
  return {
    x: finite(bounds?.x, 0), y: finite(bounds?.y, 0),
    width: Math.max(0, finite(bounds?.width, 0)), height: Math.max(0, finite(bounds?.height, 0)),
  };
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
    // Avoid repeating the last activity at a shuffle-bag boundary.
    if (queue[0] === last) [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  return { item: queue.shift(), queue };
}

function nextActivity(state, random) {
  const activity = takeFromBag(ACTIVITIES, state.actionQueue, state.lastAction, random);
  const sleep = activity.item === 'sleep'
    ? takeFromBag(SLEEP_POSES, state.sleepQueue ?? [], state.lastSleep, random) : null;
  const pose = sleep?.item ?? activity.item;
  const [min, max] = DURATIONS[activity.item];
  return {
    ...state, activity: 'action', activityMs: 0, activityDurationMs: range(random, min, max),
    actionQueue: activity.queue, lastAction: activity.item, sleepQueue: sleep?.queue ?? state.sleepQueue,
    lastSleep: sleep?.item ?? state.lastSleep, pose, frame: 0, vx: 0, vy: 0, arrived: true,
  };
}

function actionFrame(pose, time) {
  if (SLEEP_POSES.includes(pose)) return SLEEP_BREATH[Math.floor(time / SLEEP_FRAME_MS) % SLEEP_BREATH.length];
  if (pose === 'play') {
    // The toy sequence ends in a different stance. Retrace the authored poses
    // instead of jumping straight from the last sitting frame to standing.
    const cycle = (FRAME_COUNTS.play - 1) * 2;
    const step = Math.floor(time / FRAME_MS.play) % cycle;
    return step < FRAME_COUNTS.play ? step : cycle - step;
  }
  return Math.floor(time / FRAME_MS[pose]) % FRAME_COUNTS[pose];
}

function nextWalk(state, random) {
  const angle = range(random, 0, Math.PI * 2);
  const distance = range(random, 85, 190);
  let target = clampPetCenter({
    x: state.x + Math.cos(angle) * distance,
    y: state.y + Math.sin(angle) * distance * 0.38,
  }, state.workArea, state.spriteSize);
  if (Math.hypot(target.x - state.x, target.y - state.y) < 24) {
    // An outward choice at a screen edge should turn into a visible inward
    // stroll, rather than repeatedly choosing the same clamped corner.
    const candidates = [
      { x: state.x - distance, y: state.y }, { x: state.x + distance, y: state.y },
      { x: state.x, y: state.y - distance * 0.38 }, { x: state.x, y: state.y + distance * 0.38 },
    ].map(point => clampPetCenter(point, state.workArea, state.spriteSize));
    target = candidates.reduce((farthest, point) =>
      Math.hypot(point.x - state.x, point.y - state.y) > Math.hypot(farthest.x - state.x, farthest.y - state.y) ? point : farthest);
  }
  if (Math.hypot(target.x - state.x, target.y - state.y) < 1) return nextActivity(state, random);
  return {
    ...state, activity: 'walk', activityMs: 0, activityDurationMs: 0,
    target, walkSpeed: range(random, 40, 58), pose: 'walk', frame: Math.floor(state.stepPhase),
    vx: 0, vy: 0, arrived: false,
  };
}

function walk(state, ms, random) {
  const dx = state.target.x - state.x;
  const dy = state.target.y - state.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.8) return nextActivity({ ...state, x: state.target.x, y: state.target.y }, random);
  const seconds = ms / 1000;
  const speed = Math.min(state.walkSpeed, distance * 1.6);
  const response = 1 - Math.exp(-seconds / 0.12);
  const vx = state.vx + (dx / distance * speed - state.vx) * response;
  const vy = state.vy + (dy / distance * speed - state.vy) * response;
  const stepX = (state.vx + vx) * 0.5 * seconds;
  const stepY = (state.vy + vy) * 0.5 * seconds;
  if (stepX * dx + stepY * dy >= distance * distance) {
    return nextActivity({ ...state, x: state.target.x, y: state.target.y }, random);
  }
  const position = clampPetCenter({ x: state.x + stepX, y: state.y + stepY }, state.workArea, state.spriteSize);
  const stepPhase = (state.stepPhase + Math.hypot(position.x - state.x, position.y - state.y) / PAW_STEP) % 4;
  return {
    ...state, ...position, vx, vy, stepPhase, frame: Math.floor(stepPhase),
    facing: Math.abs(vx) > 1 ? Math.sign(vx) : state.facing, activityMs: state.activityMs + ms,
  };
}

export function createCompanionMotion(pet, bounds, size) {
  const area = workArea(bounds);
  const spriteSize = Math.max(0, finite(size, 76));
  const position = clampPetCenter({ x: finite(pet?.x, area.x + area.width / 2), y: finite(pet?.y, area.y + area.height / 2) }, area, spriteSize);
  const pose = pet?.pose === 'walk' || Object.hasOwn(ACTION_FRAMES, pet?.pose) || Object.hasOwn(FRAME_COUNTS, pet?.pose) ? pet.pose : 'stand';
  const phase = finite(pet?.stepPhase, 0) % 4;
  const stepPhase = phase < 0 ? phase + 4 : phase;
  const frame = pose === 'walk' ? Math.floor(stepPhase)
    : Object.hasOwn(FRAME_COUNTS, pose) ? clamp(Math.floor(finite(pet?.frame, 0)), 0, FRAME_COUNTS[pose] - 1) : ACTION_FRAMES[pose];
  return {
    ...position, vx: 0, vy: 0, facing: pet?.facing < 0 ? -1 : 1, stepPhase, frame, pose, arrived: true,
    activity: 'rest', activityMs: 0, activityDurationMs: 650, target: { ...position }, walkSpeed: 48,
    actionQueue: [], lastAction: null, sleepQueue: [], lastSleep: null, workArea: area, spriteSize, suspended: false,
  };
}

export function stepCompanionMotion(previous, elapsedMs, {
  bounds = previous.workArea, size = previous.spriteSize, paused = false, reducedMotion = false, random = Math.random,
} = {}) {
  const area = workArea(bounds);
  const spriteSize = Math.max(0, finite(size, previous.spriteSize));
  const position = clampPetCenter(previous, area, spriteSize);
  let state = {
    ...previous, ...position, workArea: area, spriteSize,
    target: clampPetCenter(previous.target, area, spriteSize),
    vx: position.x === previous.x ? previous.vx : 0,
    vy: position.y === previous.y ? previous.vy : 0,
    suspended: paused || reducedMotion,
  };
  if (paused || reducedMotion) return { ...state, vx: 0, vy: 0 };

  // A system sleep or an event-loop stall is not play time. On resuming an
  // explicitly paused companion, start a fresh clock before the next step.
  let remaining = previous.suspended ? 0 : clamp(finite(elapsedMs, 0), 0, MAX_FRAME_MS);
  while (remaining > 0) {
    const ms = Math.min(16, remaining);
    if (state.activity === 'walk') state = walk(state, ms, random);
    else {
      state = { ...state, activityMs: state.activityMs + ms };
      if (state.activityMs >= state.activityDurationMs) state = nextWalk(state, random);
      else if (state.activity === 'action') state.frame = actionFrame(state.pose, state.activityMs);
    }
    remaining -= ms;
  }
  return state;
}
