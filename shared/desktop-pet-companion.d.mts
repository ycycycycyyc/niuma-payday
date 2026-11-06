export type CompanionPose = 'walk' | 'stand' | 'turn' | 'crouch' | 'sit' | 'lift' | 'paw' | 'wag' | 'lick' | 'play' | 'sleep' | 'sleep-side' | 'sleep-belly' | 'roll';
export type CompanionBounds = { x: number; y: number; width: number; height: number };
export type CompanionSeed = { x: number; y: number; facing?: 1 | -1; pose?: string; frame?: number; stepPhase?: number };
export interface CompanionMotionState {
  x: number; y: number; vx: number; vy: number; facing: 1 | -1;
  stepPhase: number; frame: number; pose: CompanionPose; arrived: boolean;
  activity: 'rest' | 'walk' | 'action'; activityMs: number; activityDurationMs: number;
  target: { x: number; y: number }; walkSpeed: number;
  actionQueue: CompanionPose[]; lastAction: CompanionPose | null;
  workArea: CompanionBounds; spriteSize: number; suspended: boolean;
}
export function createCompanionMotion(pet: CompanionSeed, bounds: CompanionBounds, size: number): CompanionMotionState;
export function stepCompanionMotion(state: CompanionMotionState, elapsedMs: number, options?: {
  bounds?: CompanionBounds; size?: number; paused?: boolean; reducedMotion?: boolean; random?: () => number;
}): CompanionMotionState;
