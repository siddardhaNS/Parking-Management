import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { config } from './config.js';
import type { SourceType } from './types.js';

const ffmpegBin = config.ffmpegPath ?? (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

function runFfmpeg(args: string[], timeoutMs = 20_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out grabbing a frame'));
    }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks);
      if (code === 0 || out.length > 0) resolve(out);
      else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`));
    });
  });
}

const FRAME_TO_JPEG = ['-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'];

async function toJpeg(buf: Buffer): Promise<Buffer> {
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return buf;
  return sharp(buf).jpeg({ quality: 85 }).toBuffer();
}

async function fetchSnapshot(rawUrl: string): Promise<Buffer> {
  // fetch() refuses URLs with embedded credentials, so turn them into a Basic auth header.
  const url = new URL(rawUrl);
  const headers: Record<string, string> = {};
  if (url.username || url.password) {
    const creds = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(creds).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Snapshot request failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Produces one JPEG frame per call from an RTSP stream, an HTTP snapshot URL,
 * or a local image/video file (video files are stepped through and looped,
 * which is handy for demos and testing).
 */
export class FrameSource {
  private videoOffset = 0;

  constructor(
    private type: SourceType,
    private url: string,
    private stepSec = 5,
  ) {}

  async grab(): Promise<Buffer> {
    switch (this.type) {
      case 'rtsp':
        return toJpeg(await runFfmpeg(['-rtsp_transport', 'tcp', '-i', this.url, ...FRAME_TO_JPEG]));
      case 'snapshot':
        return toJpeg(await fetchSnapshot(this.url));
      case 'file':
        return toJpeg(await this.grabFile());
      default:
        throw new Error(`Unknown source type: ${this.type as string}`);
    }
  }

  private async grabFile(): Promise<Buffer> {
    if (IMAGE_EXT.has(path.extname(this.url).toLowerCase())) return fs.readFile(this.url);
    let frame = await runFfmpeg(['-ss', String(this.videoOffset), '-i', this.url, ...FRAME_TO_JPEG]);
    if (frame.length === 0 && this.videoOffset > 0) {
      this.videoOffset = 0; // reached the end: loop
      frame = await runFfmpeg(['-i', this.url, ...FRAME_TO_JPEG]);
    }
    if (frame.length === 0) throw new Error('Could not read a frame from the video file');
    this.videoOffset += this.stepSec;
    return frame;
  }
}
