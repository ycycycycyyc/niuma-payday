export type PetFood = 'kibble' | 'stick';
export type PetFeeding = { food: PetFood; elapsedMs: number };
export type PetFeedingRect = { x: number; y: number; width: number; height: number };
export const FEED_DURATION_MS: number;
export function createPetFeeding(food: unknown): PetFeeding | null;
export function stepPetFeeding(state: PetFeeding | null, deltaMs: number): PetFeeding | null;
export function petFeedingFrame(state: PetFeeding, reducedMotion?: boolean): {
  frame: number; stage: 'offer' | 'eat' | 'happy'; portion: number;
};
export function petFeedingMenuRect(anchor: PetFeedingRect, bounds: PetFeedingRect): PetFeedingRect;
