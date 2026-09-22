// Overlays a 100px coordinate grid on a screenshot for precise click targeting.
// Usage: node tools/poc/grid-overlay.mjs <input.jpg> <output.png>
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
const img = sharp(input);
const meta = await img.metadata();
const w = meta.width ?? 0;
const h = meta.height ?? 0;

const parts = [];
for (let x = 100; x < w; x += 100) {
  parts.push(
    `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="red" stroke-width="0.5"/>`,
  );
  parts.push(`<text x="${x + 4}" y="14" fill="red" font-size="12">${x}</text>`);
}
for (let y = 100; y < h; y += 100) {
  parts.push(
    `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="red" stroke-width="0.5"/>`,
  );
  parts.push(`<text x="4" y="${y + 12}" fill="red" font-size="12">${y}</text>`);
}
const svg =
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
  parts.join('') +
  '</svg>';

await img
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .toFile(output);
console.log(`grid overlay saved: ${output}`);
