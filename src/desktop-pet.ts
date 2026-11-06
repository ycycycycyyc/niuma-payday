import './desktop-pet.css';

type Dog = { x: number; y: number; size: number; facing: -1 | 1; frame: number; pose: 'walk' | 'stand' | 'wag' };
type Frame = { dog: Dog | null; bone: { x: number; y: number } | null };

declare global {
  interface Window {
    petOverlay?: { onFrame(listener: (frame: Frame) => void): () => void };
  }
}

const sprite = document.getElementById('desktop-dog')!;
const cursorBone = document.getElementById('desktop-bone')!;

window.petOverlay?.onFrame(({ dog, bone }) => {
  sprite.hidden = dog === null;
  if (dog) {
    const walking = dog.pose === 'walk';
    const frame = walking ? dog.frame : dog.pose === 'wag' ? 6 : 0;
    sprite.dataset.pose = dog.pose;
    sprite.dataset.facing = String(dog.facing);
    sprite.dataset.frame = String(frame);
    sprite.style.width = sprite.style.height = `${dog.size}px`;
    sprite.style.transform = `translate3d(${dog.x}px, ${dog.y}px, 0) scaleX(${dog.facing})`;
    sprite.style.backgroundPositionX = `${100 * frame / (walking ? 3 : 6)}%`;
  }
  cursorBone.hidden = bone === null;
  if (bone) cursorBone.style.transform = `translate3d(${bone.x}px, ${bone.y}px, 0)`;
});
