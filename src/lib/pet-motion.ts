export type PetPose = 'walk' | 'turn' | 'crouch' | 'sit' | 'lift' | 'paw' | 'wag' | 'stand';
type Facing = 1 | -1;
type Turn = { origin: number; tip: number; from: Facing; elapsedMs: number };

export interface PetMotionState {
  x: number;
  facing: Facing;
  pose: PetPose;
  frame: number;
  speed: number;
  stride: number;
  turn: Turn | null;
  handshakeMs: number | null;
}

export interface PetMotionInput {
  /** Available travel of the sprite's left edge, and the desired position of that same edge. */
  trackLength: number;
  targetX: number | null;
  chasing: boolean;
  reducedMotion: boolean;
}

const PATROL_SPEED = 48; // CSS pixels per second
const CHASE_SPEED = 120;
const ACCELERATION = 320;
const TURN_MS = 230;
const PAW_STEP = 7.5;
const ARRIVAL_RADIUS = 1.5;
const WAKE_RADIUS = 6;
const SHAKE_END_MS = 2150;
const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
const opposite = (facing: Facing): Facing => facing === 1 ? -1 : 1;

export function createPetMotion(x = 0): PetMotionState {
  return {
    x: Number.isFinite(x) ? Math.max(0, x) : 0,
    facing: 1, pose: 'stand', frame: 0, speed: 0, stride: 0, turn: null, handshakeMs: null,
  };
}

export function requestPetHandshake(state: PetMotionState): PetMotionState {
  if (state.handshakeMs !== null) return state;
  return { ...state, pose: 'crouch', frame: 0, speed: 0, turn: null, handshakeMs: 0 };
}

const handshakePoses: ReadonlyArray<readonly [number, PetPose]> = [
  [210, 'crouch'], [430, 'sit'], [660, 'lift'], [1030, 'paw'], [1180, 'lift'],
  [1480, 'paw'], [1640, 'lift'], [1850, 'sit'], [2040, 'crouch'], [SHAKE_END_MS, 'stand'],
];

function handshakePose(time: number, reduced: boolean): PetPose {
  if (reduced) return time >= 430 && time < 1640 ? 'paw' : 'sit';
  return handshakePoses.find(([end]) => time < end)?.[1] ?? 'stand';
}

function standStill(state: PetMotionState, pose: PetPose) {
  state.pose = pose;
  state.frame = 0;
  state.speed = 0;
  state.turn = null;
}

function placePaws(state: PetMotionState, x: number) {
  state.stride = (state.stride + Math.abs(x - state.x)) % (4 * PAW_STEP);
  state.x = x;
  state.pose = 'walk';
  state.frame = Math.floor(state.stride / PAW_STEP);
}

function startTurn(state: PetMotionState, tip: number) {
  state.turn = { origin: state.x, tip, from: state.facing, elapsedMs: 0 };
}

function advanceTurn(state: PetMotionState, length: number, ms: number) {
  const turn = state.turn!;
  const elapsedMs = Math.min(TURN_MS, turn.elapsedMs + ms);
  const progress = elapsedMs / TURN_MS;
  // A short arc reaches the end of the ledge at its midpoint. Horizontal speed
  // crosses zero there for just an instant, while the dog rotates through front view.
  const origin = clamp(turn.origin, length);
  const span = clamp(turn.tip, length) - origin;
  placePaws(state, origin + span * Math.sin(progress * Math.PI));
  state.facing = progress < 0.5 ? turn.from : opposite(turn.from);
  if (progress >= 0.18 && progress < 0.82) {
    state.pose = 'turn';
    state.frame = 0;
  }
  state.turn = progress < 1 ? { ...turn, elapsedMs } : null;
  state.speed = Math.abs(span * Math.PI * Math.cos(progress * Math.PI)) * 1000 / TURN_MS;
}

function travel(state: PetMotionState, goal: number, speed: number, seconds: number) {
  const previousSpeed = state.speed;
  const change = ACCELERATION * seconds;
  state.speed += Math.max(-change, Math.min(change, speed - previousSpeed));
  const distance = Math.min(Math.abs(goal - state.x), (state.speed + previousSpeed) * 0.5 * seconds);
  placePaws(state, state.x + state.facing * distance);
}

function advance(state: PetMotionState, input: PetMotionInput, length: number, target: number | null, ms: number) {
  if (state.handshakeMs !== null) {
    state.handshakeMs += ms;
    if (state.handshakeMs < SHAKE_END_MS) {
      state.pose = handshakePose(state.handshakeMs, input.reducedMotion);
      return;
    }
    state.handshakeMs = null;
  }

  if (input.reducedMotion || length < 4) {
    if (input.reducedMotion && input.chasing && target !== null) {
      // Direct positioning is controlled by the pointer; there is no autonomous walk.
      const dx = target - state.x;
      if (Math.abs(dx) > WAKE_RADIUS) state.facing = dx > 0 ? 1 : -1;
      state.x = target;
    }
    standStill(state, 'stand');
    return;
  }

  if (state.turn) {
    advanceTurn(state, length, ms);
    return;
  }

  // Choosing the radius from speed makes entry and exit velocities match the arc.
  const turnRadius = state.speed * TURN_MS / (1000 * Math.PI);
  if (!input.chasing) {
    const edge = state.facing === 1 ? length : 0;
    const remaining = Math.abs(edge - state.x);
    if (remaining <= turnRadius + 0.01) {
      startTurn(state, edge);
      advanceTurn(state, length, ms);
    } else {
      travel(state, edge - state.facing * turnRadius, PATROL_SPEED, ms / 1000);
    }
    return;
  }

  const delta = (target ?? state.x) - state.x;
  const distance = Math.abs(delta);
  const reversing = delta * state.facing < 0;
  const tolerance = state.pose === 'wag' || reversing ? WAKE_RADIUS : ARRIVAL_RADIUS;
  if (distance <= tolerance) {
    standStill(state, 'wag');
  } else if (reversing) {
    startTurn(state, clamp(state.x + state.facing * turnRadius, length));
    advanceTurn(state, length, ms);
  } else {
    const brakingSpeed = Math.sqrt(2 * ACCELERATION * distance);
    travel(state, target!, Math.min(CHASE_SPEED, brakingSpeed), ms / 1000);
  }
}

export function stepPetMotion(previous: PetMotionState, deltaMs: number, input: PetMotionInput): PetMotionState {
  const length = Number.isFinite(input.trackLength) ? Math.max(0, input.trackLength) : 0;
  const target = input.targetX !== null && Number.isFinite(input.targetX) ? clamp(input.targetX, length) : null;
  const state = { ...previous, x: clamp(previous.x, length) };
  // Substeps also handle a delayed frame. The caller resets its RAF clock on becoming visible.
  let remaining = Number.isFinite(deltaMs) ? clamp(deltaMs, 2500) : 0;
  do {
    const ms = Math.min(remaining, 1000 / 60);
    advance(state, input, length, target, ms);
    remaining -= ms;
  } while (remaining > 1e-6);
  return state;
}
