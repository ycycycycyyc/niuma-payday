export type CompanionAction = 'lick' | 'play' | 'sleep' | 'roll';
export type CompanionSleepPose = 'sleep' | 'sleep-side' | 'sleep-belly';
export type CompanionActionPose = 'lick' | 'play' | CompanionSleepPose | 'roll';
export type CompanionBridgePose = 'bridge-lick' | 'bridge-sleep' | 'bridge-side' | 'bridge-belly' | 'bridge-play' | 'bridge-turn';
export type CompanionPose = 'walk' | 'stand' | 'turn' | 'crouch' | 'sit' | 'lift' | 'paw' | 'wag' | CompanionActionPose | CompanionBridgePose;
export type CompanionBounds = { x: number; y: number; width: number; height: number };
export type CompanionSeed = {
  x: number; y: number; facing?: 1 | -1; pose?: string; frame?: number; stepPhase?: number;
  vx?: number; vy?: number; speed?: number;
};
export interface CompanionMotionState {
  x: number; y: number; vx: number; vy: number; facing: 1 | -1;
  stepPhase: number; frame: number; pose: CompanionPose; arrived: boolean;
  activity: 'rest' | 'settle' | 'turn' | 'walk' | 'enter' | 'action' | 'exit';
  activityMs: number; activityDurationMs: number; actionDurationMs: number;
  activePose: CompanionActionPose | null;
  settleNext: 'walk' | 'enter'; settleStableMs: number; turnTo: 1 | -1 | null;
  target: { x: number; y: number }; walkSpeed: number;
  actionQueue: CompanionAction[]; lastAction: CompanionAction | null;
  sleepQueue: CompanionSleepPose[]; lastSleep: CompanionSleepPose | null;
  workArea: CompanionBounds; spriteSize: number; suspended: boolean;
}
export function createCompanionMotion(pet: CompanionSeed, bounds: CompanionBounds, size: number): CompanionMotionState;
export function placeCompanionMotion(state: CompanionMotionState, point: { x: number; y: number }, bounds: CompanionBounds): CompanionMotionState;
export function stepCompanionMotion(state: CompanionMotionState, elapsedMs: number, options?: {
  bounds?: CompanionBounds; size?: number; paused?: boolean; reducedMotion?: boolean; random?: () => number;
}): CompanionMotionState;
