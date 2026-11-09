import type { PongState } from './ping-pong';

const WIDTH = 900, HEIGHT = 550;
export function drawPong(canvas: HTMLCanvasElement, state: PongState, reduced = false) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const ratio = canvas.width / WIDTH;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const project = (x: number, y: number, z = 0) => ({
    x: WIDTH / 2 + x * WIDTH * .415 * (1 - y * .16),
    y: HEIGHT * .84 - y * HEIGHT * .315 - z * HEIGHT * .2,
  });
  const line = (points: { x: number; y: number }[], color: string, width = 1, close = false, fill = '') => {
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    if (close) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  ctx.fillStyle = '#f9f3f5'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#d7c4ce';
  for (let x = 25; x < WIDTH; x += 30) for (let y = 25; y < HEIGHT; y += 30) {
    ctx.beginPath(); ctx.arc(x, y, .75, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#d4c8cf';
  ctx.beginPath(); ctx.ellipse(WIDTH / 2, HEIGHT * .86, WIDTH * .40, 24, 0, 0, Math.PI * 2); ctx.fill();
  const nearLeft = project(-1, 0), nearRight = project(1, 0), farLeft = project(-1, 2), farRight = project(1, 2);
  line([nearLeft, nearRight, { x: nearRight.x, y: nearRight.y + 15 }, { x: nearLeft.x, y: nearLeft.y + 15 }], '#426963', 1, true, '#426963');
  line([nearLeft, nearRight, farRight, farLeft], '#315d58', 3, true, '#6f9b92');
  line([project(-.975, .025), project(.975, .025), project(.975, 1.975), project(-.975, 1.975)], '#f7f1df', 3, true);
  line([project(0, 0), project(0, 2)], '#e2e8da', 1.5);
  const paddle = (x: number, y: number, player: boolean) => {
    const p = project(x, y, .19);
    const scale = player ? 1 : .75;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(player ? -.25 : Math.PI + .25);
    ctx.fillStyle = '#b3a087'; ctx.fillRect(-5 * scale, 8 * scale, 10 * scale, 34 * scale);
    ctx.beginPath(); ctx.ellipse(0, 0, 29 * scale, 20 * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = player ? '#b7577d' : '#d6bc83'; ctx.fill(); ctx.lineWidth = 3 * scale; ctx.strokeStyle = '#f5dfc0'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-5 * scale, -5 * scale, 15 * scale, 7 * scale, -.2, Math.PI, Math.PI * 2);
    ctx.lineWidth = 2 * scale; ctx.strokeStyle = player ? '#d88faa' : '#ead6ab'; ctx.stroke(); ctx.restore();
  };
  const ball = () => {
    const b = state.ball;
    const p = project(b.x, b.y, b.z), shadow = project(b.x, b.y);
    const radius = 7.5 * (1 - b.y * .10);
    ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, radius * 1.35, radius * .48, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#254b4244'; ctx.fill();
    if (!reduced && state.phase === 'rally') {
      const tail = project(b.x - b.vx * .022, b.y - b.vy * .022, Math.max(0, b.z - b.vz * .022));
      line([tail, p], '#fff9ec80', radius * 1.2);
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fffcf2'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#e4d2b2'; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x - radius * .27, p.y - radius * .3, radius * .25, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  };
  paddle(state.computerX, 1.92, false);
  if (state.ball.y > 1) ball();
  // The mesh has a real height in the same coordinates as ball/net collisions.
  const left = project(-1.045, 1), right = project(1.045, 1);
  line([left, project(-1.045, 1, .155), project(1.045, 1, .155), right], '#e8e4d8', 1, true, '#d9d9cb75');
  for (let x = -1; x <= 1.01; x += .075) line([project(x, 1), project(x, 1, .155)], '#f1eddf99');
  for (let z = .035; z < .155; z += .035) line([project(-1.04, 1, z), project(1.04, 1, z)], '#f1eddf99');
  line([project(-1.045, 1, .155), project(1.045, 1, .155)], '#fff8e6', 3);
  for (const x of [-1.045, 1.045]) line([project(x, 1, -.025), project(x, 1, .19)], '#426963', 4);
  paddle(state.playerX, .07, true);
  if (state.ball.y <= 1) ball();
  ctx.textAlign = 'center'; ctx.font = '500 13px system-ui'; ctx.fillStyle = '#806675';
  ctx.fillText('电脑', WIDTH / 2, 61); ctx.fillText('你', WIDTH / 2, HEIGHT - 20);
}

export const pongCanvasSize = { width: WIDTH, height: HEIGHT };
