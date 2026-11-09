import { ballProjection, paddleProjection, PONG_CANVAS, projectPong, type PongState } from './ping-pong';

type Point = { x: number; y: number };
const { width: WIDTH, height: HEIGHT } = PONG_CANVAS;
const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The engine owns all world-to-canvas and contact dimensions. */
export function drawPong(canvas: HTMLCanvasElement, state: PongState, reduced = false) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const ratio = canvas.width / WIDTH;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const line = (points: Point[], color: string, width = 1, close = false, fill = '') => {
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    if (close) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  const ellipse = (center: Point, radiusX: number, radiusY: number, fill: string, stroke = '', width = 1) => {
    ctx.beginPath(); ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  };

  const floor = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  floor.addColorStop(0, '#fbf7f9'); floor.addColorStop(1, '#f0e7ee');
  ctx.fillStyle = floor; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ellipse({ x: WIDTH / 2, y: HEIGHT * .87 }, WIDTH * .40, 24, '#70566a12');
  const nearLeft = projectPong(-1, 0), nearRight = projectPong(1, 0);
  const farLeft = projectPong(-1, 2), farRight = projectPong(1, 2);
  for (const x of [-.86, .86]) {
    const leg = projectPong(x, .12);
    line([leg, { x: leg.x, y: leg.y + 35 }], '#657e77', 7);
  }
  line([nearLeft, nearRight, { x: nearRight.x, y: nearRight.y + 12 }, { x: nearLeft.x, y: nearLeft.y + 12 }], '#426963', 1, true, '#426963');
  const table = ctx.createLinearGradient(0, farLeft.y, 0, nearLeft.y);
  table.addColorStop(0, '#7caaa1'); table.addColorStop(1, '#6b978d');
  ctx.beginPath(); ctx.moveTo(nearLeft.x, nearLeft.y);
  for (const point of [nearRight, farRight, farLeft]) ctx.lineTo(point.x, point.y);
  ctx.closePath(); ctx.fillStyle = table; ctx.fill();
  ctx.strokeStyle = '#315e56'; ctx.lineWidth = 3; ctx.stroke();
  // This near-side zone gives depth to free forward/back racket motion.
  line([projectPong(-.96, .035), projectPong(.96, .035), projectPong(.96, .9), projectPong(-.96, .9)],
    '#d4e8dc20', 1, true, '#e7efe313');
  line([projectPong(-.975, .025), projectPong(.975, .025), projectPong(.975, 1.975), projectPong(-.975, 1.975)], '#f7f1df', 3, true);
  line([projectPong(0, .025), projectPong(0, 1.975)], '#e9eede', 1.4);

  const playerY = state.playerY, computerY = state.computerY;
  const shadowPaddle = (x: number, y: number, player: boolean) => {
    const p = projectPong(x, y), size = paddleProjection(x, y);
    ellipse(p, size.radiusX * .94, size.radiusY * .40, player ? '#254b4230' : '#254b4222');
  };
  shadowPaddle(state.computerX, computerY, false);
  shadowPaddle(state.playerX, playerY, true);

  const b = state.ball, ball = ballProjection(b.x, b.y, b.z);
  const ballShadow = projectPong(b.x, b.y), height = Math.max(0, b.z);
  if (Math.abs(b.x) <= 1.03 && b.y >= -.02 && b.y <= 2.02) {
    const radius = ball.radius * (1 + Math.min(.6, height * .7));
    ellipse(ballShadow, radius * 1.25, radius * .35, 'rgba(31,65,54,' + clamp(.31 - height * .13, .08, .31) + ')');
    // Shadow and ball share x/y. Their separation shows actual height and bounce.
    if (state.phase === 'rally' && b.y < 1 && height > .09) {
      ellipse(ballShadow, radius * 1.8, radius * .65, '', '#e6f2e65c', 1);
      if (!reduced && height > .4) {
        ctx.save(); ctx.setLineDash([2, 5]);
        line([{ x: ballShadow.x, y: ballShadow.y - 2 }, { x: ball.x, y: ball.y + ball.radius + 3 }], '#e5efdf66');
        ctx.restore();
      }
    }
  }
  const effect = state.effect;
  if (effect && effect.age >= 0 && effect.age < .30) {
    const progress = clamp(effect.age / .30, 0, 1);
    const center = projectPong(effect.x, effect.y, effect.kind === 'bounce' ? 0 : effect.z);
    ctx.save(); ctx.globalAlpha = reduced ? .45 : 1 - progress;
    const color = effect.kind === 'hit' ? '#fff2c4' : effect.kind === 'bounce' ? '#e9f4dd' : '#e1a29d';
    const expansion = reduced ? 0 : progress * 13;
    ellipse(center, 10 + expansion, effect.kind === 'bounce' ? 3 + expansion * .3 : 7 + expansion * .6, '', color, 2);
    ctx.restore();
  }

  const paddle = (x: number, y: number, player: boolean) => {
    const p = paddleProjection(x, y);
    const strength = clamp(player ? state.playerSwing : state.computerSwing, 0, 1), scale = p.radiusX / 29;
    // Rotate only the decorative handle: the face exactly matches the collider.
    const angle = (player ? -.32 : Math.PI + .25) + (reduced ? 0 : strength * (player ? .28 : -.24));
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
    ctx.fillStyle = '#bca387'; ctx.fillRect(-4.5 * scale, p.radiusY * .65, 9 * scale, 31 * scale);
    ctx.fillStyle = '#dfc9ad'; ctx.fillRect(-2.5 * scale, p.radiusY * .65 + 3 * scale, 2 * scale, 25 * scale);
    ctx.restore();
    const face = ctx.createLinearGradient(p.x, p.y - p.radiusY, p.x, p.y + p.radiusY);
    face.addColorStop(0, player ? strength > .2 ? '#db82a6' : '#c87098' : '#dfc48d');
    face.addColorStop(1, player ? '#a74b74' : '#b8995f');
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.radiusX, p.radiusY, 0, 0, TAU);
    ctx.fillStyle = face; ctx.fill();
    ctx.strokeStyle = strength > .2 ? '#fff0cb' : '#eddbbd'; ctx.lineWidth = 2.3 * scale; ctx.stroke();
    ellipse({ x: p.x - 4 * scale, y: p.y - 6 * scale }, p.radiusX * .60, p.radiusY * .22, '#ffffff24');
    if (!reduced && state.phase === 'rally' && strength > .15) {
      ctx.save(); ctx.globalAlpha = strength * .75; ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.radiusX + 5 * scale, p.radiusY + 4 * scale, 0, Math.PI * 1.12, Math.PI * 1.88);
      ctx.strokeStyle = '#fff1d6'; ctx.lineWidth = 2 * scale; ctx.stroke(); ctx.restore();
    }
  };
  const paintBall = () => {
    if (!reduced && state.phase === 'rally' && !state.serveCountdown) {
      const tail = ballProjection(b.x - b.vx * .024, b.y - b.vy * .024, Math.max(0, b.z - b.vz * .024));
      line([tail, ball], '#fffcf78c', ball.radius * 1.1);
    }
    const sphere = ctx.createRadialGradient(ball.x - ball.radius * .35, ball.y - ball.radius * .4, .4, ball.x, ball.y, ball.radius);
    sphere.addColorStop(0, '#ffffff'); sphere.addColorStop(.65, '#fff9e9'); sphere.addColorStop(1, '#e8d9bd');
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, TAU);
    ctx.fillStyle = sphere; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#d8c4a3'; ctx.stroke();
    if (state.serveCountdown > 0) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + 5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(state.serveCountdown / 1.1, 0, 1));
      ctx.strokeStyle = '#9e7e9466'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  };
  const net = () => {
    const left = projectPong(-1.045, 1), right = projectPong(1.045, 1);
    line([left, projectPong(-1.045, 1, .155), projectPong(1.045, 1, .155), right], '#e8e4d8', 1, true, '#d4ddce70');
    for (let x = -1; x <= 1.01; x += .075) line([projectPong(x, 1), projectPong(x, 1, .155)], '#f1eddf99');
    for (let z = .035; z < .155; z += .035) line([projectPong(-1.04, 1, z), projectPong(1.04, 1, z)], '#f1eddf99');
    line([projectPong(-1.045, 1, .155), projectPong(1.045, 1, .155)], '#fff8e6', 3);
    for (const x of [-1.045, 1.045]) line([projectPong(x, 1, -.025), projectPong(x, 1, .19)], '#426963', 4);
  };
  // Sort real world depths: advancing rackets, ball and net stay in agreement.
  [
    { depth: computerY, draw: () => paddle(state.computerX, computerY, false) },
    { depth: playerY, draw: () => paddle(state.playerX, playerY, true) },
    { depth: b.y, draw: paintBall },
    { depth: 1, draw: net },
  ].sort((left, right) => right.depth - left.depth).forEach(layer => layer.draw());
  ctx.textAlign = 'center'; ctx.font = '500 13px system-ui'; ctx.fillStyle = '#806675';
  ctx.fillText('电脑', WIDTH / 2, 62); ctx.fillText('你', WIDTH / 2, HEIGHT - 20);
}
