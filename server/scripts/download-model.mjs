// Downloads the YOLOX (Apache-2.0) ONNX vehicle detector into ./models.
// Usage: node server/scripts/download-model.mjs [yolox_nano|yolox_tiny|yolox_s|yolox_m|yolox_l]
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const name = process.argv[2] ?? 'yolox_s';
const url = `https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/${name}.onnx`;
const dir = path.resolve(import.meta.dirname, '..', '..', 'models');
const dest = path.join(dir, `${name}.onnx`);

if (fs.existsSync(dest)) {
  console.log(`Model already present: ${dest}`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
const tmp = `${dest}.part`;
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
fs.renameSync(tmp, dest);
console.log(`Saved ${dest}`);
