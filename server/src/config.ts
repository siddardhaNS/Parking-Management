import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, 'data')),
  modelPath: path.resolve(process.env.MODEL_PATH ?? path.join(root, 'models', 'yolox_s.onnx')),
  modelInputSize: Number(process.env.MODEL_INPUT_SIZE ?? 640),
  /** cpu | cuda (Linux + NVIDIA) | dml (Windows DirectML) */
  executionProvider: (process.env.EXECUTION_PROVIDER ?? 'cpu').toLowerCase(),
  ffmpegPath: process.env.FFMPEG_PATH,
  webDist: path.join(root, 'web', 'dist'),
  snapshotRetentionDays: Number(process.env.SNAPSHOT_RETENTION_DAYS ?? 7),
  sessionDays: 30,
};
