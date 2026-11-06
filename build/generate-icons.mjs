// Reproducible app artwork: a small wallet with two friendly eyes.
// No image or font dependency is required to regenerate the desktop icons.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const output = path.dirname(fileURLToPath(import.meta.url));
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let j = 0; j < 8; j++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
function chunk(name, data) {
  const type = Buffer.from(name);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  type.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc(Buffer.concat([type, data])), result.length - 4);
  return result;
}
function rounded(x, y, left, top, width, height, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, left + width - radius));
  const nearestY = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}
function colorAt(x, y, template) {
  if (template) {
    const outline = rounded(x, y, 68, 132, 378, 282, 70) && !rounded(x, y, 102, 166, 310, 214, 40);
    const eye = (x - 207) ** 2 + (y - 272) ** 2 < 22 ** 2 || (x - 316) ** 2 + (y - 272) ** 2 < 22 ** 2;
    const lip = rounded(x, y, 336, 230, 110, 86, 24) && !rounded(x, y, 367, 255, 80, 36, 14);
    return outline || eye || lip ? [0, 0, 0, 255] : [0, 0, 0, 0];
  }
  let result = rounded(x, y, 20, 20, 472, 472, 116) ? [251, 213, 216, 255] : [0, 0, 0, 0];
  if (rounded(x, y, 104, 115, 270, 228, 48)) result = [190, 108, 127, 255];
  if (rounded(x, y, 123, 132, 253, 213, 34)) result = [255, 245, 217, 255];
  if (rounded(x, y, 82, 176, 348, 234, 62)) result = [100, 45, 71, 255];
  if (rounded(x, y, 339, 246, 105, 84, 24)) result = [187, 116, 136, 255];
  if ((x - 196) ** 2 + (y - 282) ** 2 < 15 ** 2 || (x - 278) ** 2 + (y - 282) ** 2 < 15 ** 2) result = [255, 230, 216, 255];
  if (rounded(x, y, 205, 323, 63, 9, 4)) result = [255, 230, 216, 255];
  return result;
}
function png(size, template = false) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const rgba = colorAt((x + (sx + 0.5) / samples) * 512 / size, (y + (sy + 0.5) / samples) * 512 / size, template);
        sum[3] += rgba[3];
        for (let channel = 0; channel < 3; channel++) sum[channel] += rgba[channel] * rgba[3] / 255;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const alpha = sum[3] / (samples * samples);
      for (let channel = 0; channel < 3; channel++) raw[offset + channel] = alpha ? Math.round(sum[channel] / (samples * samples) * 255 / alpha) : 0;
      raw[offset + 3] = Math.round(alpha);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(output, 'icon.png'), png(512));
fs.writeFileSync(path.join(output, 'tray.png'), png(32));
fs.writeFileSync(path.join(output, 'trayTemplate.png'), png(16, true));
fs.writeFileSync(path.join(output, 'trayTemplate@2x.png'), png(32, true));
const icon = png(256);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icon.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([icoHeader, icon]));
console.log('Generated app and tray icons.');
