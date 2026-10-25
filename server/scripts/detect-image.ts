// Runs vehicle detection on image files and writes an annotated copy next to each one.
// Usage: npx tsx scripts/detect-image.ts <image> [...images]
import fs from 'node:fs';
import sharp from 'sharp';
import { detectVehicles } from '../src/detector.js';

for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file);
  const r = await detectVehicles(buf, 0.3);
  console.log(`${file}: ${r.width}x${r.height}, ${r.detections.length} vehicles, ${r.inferenceMs} ms`);
  const rects = r.detections
    .map(
      (d) =>
        `<rect x="${d.x1 * r.width}" y="${d.y1 * r.height}" width="${(d.x2 - d.x1) * r.width}" ` +
        `height="${(d.y2 - d.y1) * r.height}" fill="none" stroke="red" stroke-width="3"/>`,
    )
    .join('');
  const svg = Buffer.from(`<svg width="${r.width}" height="${r.height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
  const out = file.replace(/\.\w+$/, '.detections.png');
  await sharp(buf).composite([{ input: svg }]).toFile(out);
  console.log(`  -> ${out}`);
}
