import fs from 'node:fs';
import os from 'node:os';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { config } from './config.js';
import { iou } from './geometry.js';
import type { Detection } from './types.js';

/** COCO class ids that count as vehicles. */
export const VEHICLE_CLASSES = new Map([
  [2, 'car'],
  [3, 'motorcycle'],
  [5, 'bus'],
  [7, 'truck'],
]);

const STRIDES = [8, 16, 32];

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function executionProviders(): string[] {
  switch (config.executionProvider) {
    case 'cuda':
      return ['cuda', 'cpu'];
    case 'dml':
    case 'directml':
      return ['dml', 'cpu'];
    default:
      return ['cpu'];
  }
}

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    if (!fs.existsSync(config.modelPath)) {
      throw new Error(`Model not found at ${config.modelPath}. Run "npm run model:download".`);
    }
    sessionPromise = ort.InferenceSession.create(config.modelPath, {
      executionProviders: executionProviders(),
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, Math.floor(os.availableParallelism() / 2)),
      // Spinning worker threads fight sharp's libvips pool inside a long-running server
      // and made inference ~20x slower than in a one-shot process.
      extra: { session: { intra_op: { allow_spinning: '0' } } },
    });
    sessionPromise.catch(() => (sessionPromise = null));
  }
  return sessionPromise;
}

export function modelInfo() {
  return { path: config.modelPath, inputSize: config.modelInputSize, executionProvider: config.executionProvider };
}

export interface DetectionResult {
  width: number;
  height: number;
  detections: Detection[];
  inferenceMs: number;
}

// Inference is serialized so several cameras don't oversubscribe the CPU/GPU at once.
let queue: Promise<unknown> = Promise.resolve();

export function detectVehicles(image: Buffer, minConfidence = 0.3): Promise<DetectionResult> {
  const job = queue.then(() => runDetection(image, minConfidence));
  queue = job.catch(() => undefined);
  return job;
}

async function runDetection(image: Buffer, minConfidence: number): Promise<DetectionResult> {
  const size = config.modelInputSize;
  const meta = await sharp(image).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error('Could not read image dimensions');

  // YOLOX letterbox: resize keeping aspect ratio, pad right/bottom with gray (114), BGR, 0-255.
  const ratio = Math.min(size / width, size / height);
  const nw = Math.max(1, Math.round(width * ratio));
  const nh = Math.max(1, Math.round(height * ratio));
  const raw = await sharp(image)
    .toColourspace('srgb')
    .removeAlpha()
    .resize(nw, nh, { fit: 'fill' })
    .extend({ top: 0, left: 0, right: size - nw, bottom: size - nh, background: { r: 114, g: 114, b: 114 } })
    .raw()
    .toBuffer();

  const plane = size * size;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = raw[i * 3 + 2];
    input[plane + i] = raw[i * 3 + 1];
    input[2 * plane + i] = raw[i * 3];
  }

  const session = await getSession();
  const started = performance.now();
  const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const inferenceMs = Math.round(performance.now() - started);
  const out = outputs[session.outputNames[0]];

  const boxes = decodeYolox(out.data as Float32Array, out.dims as number[], size, ratio, minConfidence);
  const detections = nms(boxes, 0.5).map((d) => ({
    x1: clamp01(d.x1 / width),
    y1: clamp01(d.y1 / height),
    x2: clamp01(d.x2 / width),
    y2: clamp01(d.y2 / height),
    score: Math.round(d.score * 1000) / 1000,
    cls: d.cls,
  }));
  return { width, height, detections, inferenceMs };
}

/** Decodes raw YOLOX head output [1, N, 5 + classes] into boxes in original-image pixels. */
export function decodeYolox(
  data: Float32Array,
  dims: number[],
  size: number,
  ratio: number,
  minConfidence: number,
): Detection[] {
  const [, count, channels] = dims;
  const expected = STRIDES.reduce((n, s) => n + (size / s) ** 2, 0);
  if (count !== expected) {
    throw new Error(`Unexpected model output ${dims.join('x')}; expected ${expected} anchors for input ${size}. Check MODEL_INPUT_SIZE.`);
  }
  const result: Detection[] = [];
  let idx = 0;
  for (const stride of STRIDES) {
    const grid = size / stride;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++, idx++) {
        const off = idx * channels;
        const objectness = data[off + 4];
        if (objectness < minConfidence) continue;
        let best = 0;
        let cls = -1;
        for (const k of VEHICLE_CLASSES.keys()) {
          const s = data[off + 5 + k];
          if (s > best) {
            best = s;
            cls = k;
          }
        }
        const score = objectness * best;
        if (score < minConfidence) continue;
        const cx = (data[off] + gx) * stride;
        const cy = (data[off + 1] + gy) * stride;
        const w = Math.exp(data[off + 2]) * stride;
        const h = Math.exp(data[off + 3]) * stride;
        result.push({
          x1: (cx - w / 2) / ratio,
          y1: (cy - h / 2) / ratio,
          x2: (cx + w / 2) / ratio,
          y2: (cy + h / 2) / ratio,
          score,
          cls,
        });
      }
    }
  }
  return result;
}

/** Class-agnostic NMS: a pickup flagged as both "car" and "truck" is still one vehicle. */
export function nms(boxes: Detection[], threshold: number): Detection[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const box of sorted) {
    if (keep.every((k) => iou(k, box) < threshold)) keep.push(box);
  }
  return keep;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
