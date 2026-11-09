import { ballProjection, paddleProjection, PONG_CANVAS, projectPong, type PongState } from './ping-pong';
import courtUrl from '../assets/pong-court/court.webp';
import netUrl from '../assets/pong-court/net.png';
import playerUrl from '../assets/pong-equipment/player.png';
import opponentUrl from '../assets/pong-equipment/computer.png';
import ballUrl from '../assets/pong-equipment/ball.png';
import sprites from '../assets/pong-equipment/sprites.json' with { type: 'json' };

const TAU = Math.PI * 2;
type Point = { x: number; y: number };
type Art = { court: HTMLImageElement; net: HTMLImageElement; player: HTMLImageElement; computer: HTMLImageElement; ball: HTMLImageElement };
let art: Art | undefined;
let loading: Promise<void> | undefined;

async function texture(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export function preparePongArt(): Promise<void> {
  if (!loading) {
    loading = Promise.all([courtUrl, netUrl, playerUrl, opponentUrl, ballUrl].map(texture))
      .then(([court, net, player, computer, ball]) => { art = { court, net, player, computer, ball }; })
      .catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

function oval(ctx: CanvasRenderingContext2D, center: Point, rx: number, ry: number, fill: string, outline?: string) {
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, rx, ry, 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1.4; ctx.stroke(); }
}

type SpriteRegion = Pick<typeof sprites.player, 'width' | 'height' | 'centerX' | 'centerY' | 'radiusX' | 'radiusY'>;
function sprite(ctx: CanvasRenderingContext2D, texture: HTMLImageElement, region: SpriteRegion,
  center: Point, radiusX: number, radiusY: number) {
  const sx = radiusX / region.radiusX, sy = radiusY / region.radiusY;
  ctx.drawImage(texture, center.x - region.centerX * sx, center.y - region.centerY * sy, region.width * sx, region.height * sy);
}

export function drawPong(canvas: HTMLCanvasElement, state: PongState, reduced = false) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !art) return;
  const { width, height } = PONG_CANVAS;
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  const images = art;
  ctx.drawImage(images.court, 0, 0, width, height);
  const ball = state.ball, pos = ballProjection(ball.x, ball.y, ball.z);
  const player = paddleProjection(state.playerX, state.playerY);
  const computer = paddleProjection(state.computerX, state.computerY);
  for (const [x, y, halfWidth] of [[state.playerX, state.playerY, player.radiusX], [state.computerX, state.computerY, computer.radiusX]]) {
    if (Math.abs(x) <= 1 && y >= 0 && y <= 2) {
      oval(ctx, projectPong(x + .018, y + .012), halfWidth * .91, halfWidth * .25, '#13231a35');
    }
  }
  if (Math.abs(ball.x) <= 1 && ball.y >= 0 && ball.y <= 2) {
    const ground = projectPong(ball.x, ball.y);
    const opacity = Math.max(.12, .44 - Math.max(0, ball.z) * .38);
    oval(ctx, ground, pos.radius * 1.3, pos.radius * .42, `rgba(18,33,28,${opacity})`);
  }
  const e = state.effect;
  if (e && e.age < .24 && (e.kind === 'bounce' || e.kind === 'hit')) {
    const progress = e.age / .24;
    const radius = 8 + (reduced ? 0 : progress * 12);
    ctx.save(); ctx.globalAlpha = 1 - progress;
    oval(ctx, projectPong(e.x, e.y, e.kind === 'bounce' ? 0 : e.z), radius, radius * (e.kind === 'bounce' ? .32 : .70), '', '#fff5cb');
    ctx.restore();
  }

  const paintBall = () => {
    if (!reduced && state.phase === 'rally' && state.serveCountdown <= 0) {
      const previous = projectPong(ball.x - ball.vx * .018, ball.y - ball.vy * .018, ball.z - ball.vz * .018);
      ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(pos.x, pos.y);
      ctx.lineWidth = pos.radius; ctx.lineCap = 'round'; ctx.strokeStyle = '#fffff385'; ctx.stroke();
    }
    sprite(ctx, images.ball, sprites.ball, pos, pos.radius, pos.radius);
  };
  // The baked net is transparent. A ball or racket on its far side must be
  // painted first; foreground equipment must cover the mesh when it overlaps.
  [
    { depth: state.computerY, paint: () => sprite(ctx, images.computer, sprites.computer, computer, computer.radiusX, computer.radiusY) },
    { depth: state.playerY, paint: () => sprite(ctx, images.player, sprites.player, player, player.radiusX, player.radiusY) },
    { depth: 1, paint: () => ctx.drawImage(images.net, 0, 0, width, height) },
    { depth: ball.y, paint: paintBall },
  ].sort((a, b) => b.depth - a.depth).forEach(layer => layer.paint());
}
