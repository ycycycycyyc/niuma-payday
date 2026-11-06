import { petFeedingFrame, petFeedingMenuRect, type PetFeeding, type PetFeedingRect, type PetFood } from '../../shared/pet-feeding.mjs';
import feedingArtwork from '../assets/widget-dog-feeding.png';
import foodArtwork from '../assets/pet-food-options.png';
import '../components/pet-feeding.css';

for (const src of [feedingArtwork, foodArtwork]) {
  const image = new Image();
  image.src = src;
}

type Options = { onFeed(food: PetFood): void; onMenuEnter(): void; onMenuLeave(): void };
type Frame = {
  anchor: PetFeedingRect; bounds: PetFeedingRect; facing: 1 | -1;
  feeding: PetFeeding | null; open: boolean; reducedMotion: boolean;
};

// Shared by the card and the isolated desktop renderer, so food and animation
// always look the same in either home. Button names remain available to AT.
export function createPetFeedingView(parent: HTMLElement, options: Options) {
  const menu = document.createElement('div');
  menu.className = 'pet-food-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', '选择食物');
  for (const [food, label] of [['kibble', '喂狗粮'], ['stick', '喂棒棒']] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pet-food-option';
    button.dataset.food = food;
    button.setAttribute('aria-label', label);
    const picture = document.createElement('span');
    picture.className = 'pet-food-picture';
    picture.setAttribute('aria-hidden', 'true');
    picture.style.backgroundImage = `url("${foodArtwork}")`;
    picture.style.backgroundPositionX = food === 'kibble' ? '0%' : '100%';
    button.append(picture);
    button.addEventListener('click', () => options.onFeed(food));
    menu.append(button);
  }
  menu.addEventListener('pointerenter', options.onMenuEnter);
  menu.addEventListener('pointerleave', options.onMenuLeave);
  menu.addEventListener('focusin', options.onMenuEnter);
  menu.addEventListener('focusout', event => {
    if (!menu.contains(event.relatedTarget as Node | null)) options.onMenuLeave();
  });
  const sprite = document.createElement('span');
  sprite.className = 'pet-feeding-sprite';
  sprite.hidden = true;
  sprite.setAttribute('aria-hidden', 'true');
  sprite.style.backgroundImage = `url("${feedingArtwork}")`;
  parent.append(sprite, menu);
  return {
    menu,
    render({ anchor, bounds, facing, feeding, open, reducedMotion }: Frame) {
      menu.hidden = !open || Boolean(feeding);
      if (!menu.hidden) {
        const rect = petFeedingMenuRect(anchor, bounds);
        menu.style.left = `${rect.x}px`;
        menu.style.top = `${rect.y}px`;
      }
      sprite.hidden = !feeding;
      if (!feeding) return;
      const { frame, stage, portion } = petFeedingFrame(feeding, reducedMotion);
      sprite.dataset.food = feeding.food;
      sprite.dataset.frame = String(frame);
      sprite.dataset.stage = stage;
      sprite.dataset.portion = portion.toFixed(2);
      sprite.style.left = `${anchor.x}px`;
      sprite.style.top = `${anchor.y}px`;
      sprite.style.width = `${anchor.width}px`;
      sprite.style.height = `${anchor.height}px`;
      sprite.style.transform = `scaleX(${facing})`;
      sprite.style.backgroundPosition = `${(frame % 4) * 100 / 3}% ${Math.floor(frame / 4) * 100 / 3}%`;
    },
    destroy() { menu.remove(); sprite.remove(); },
  };
}
