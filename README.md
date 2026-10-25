# LotWatch

Turns ordinary IP security cameras into live parking-occupancy maps. A YOLOX vehicle detector
runs on-premises (CPU, CUDA or DirectML); each space you draw on the camera image turns green
(free) or red (occupied) in real time.

## Features

- Cameras: RTSP, HTTP snapshot URLs, or local image/video files (for demos)
- Click-to-draw space and zone editor, with auto-detection of spaces from parked cars
- Hysteresis (high/low thresholds + confirm frames) to filter rain, shadows and glare
- Live dashboard over WebSockets
- Audit timeline: scrub recorded frames to see arrivals and departures per space
- Analytics: occupancy over time, hour-of-day profile, weekly heatmap, turnover, dwell time
- Alerts: reserved space, overstay, lot full, zone limit, camera offline, delivered via webhook / email / MQTT
- Public vacancy JSON feed + full-screen signage page (`/sign/<slug>`)
- Developer API (`POST /api/v1/detect`) with API keys
- Privacy: counts vehicles only, with no plate reading and no face capture

## Stack

Node 22.13+ · TypeScript · Fastify · onnxruntime-node · sharp · ffmpeg-static · SQLite (`node:sqlite`)
· React · Vite · Tailwind · Recharts

## Run

```sh
npm install
npm run model:download      # fetches yolox_s.onnx (Apache-2.0) into ./models
npm run dev                 # API on :8080, dashboard on :5173 (proxied)
```

Open the dashboard, create the admin account, add a lot, add a camera, then draw spaces.

Production: `npm run build && npm start`; the server then also serves the dashboard on :8080.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and snapshots |
| `MODEL_PATH` | `./models/yolox_s.onnx` | Any YOLOX ONNX export (`yolox_nano` … `yolox_l`) |
| `MODEL_INPUT_SIZE` | `640` | Use `416` for nano/tiny |
| `EXECUTION_PROVIDER` | `cpu` | `cuda` (Linux + NVIDIA) or `dml` (Windows DirectML) |
| `SNAPSHOT_RETENTION_DAYS` | `7` | Audit-timeline frame retention |
| `FFMPEG_PATH` | bundled | Use a system ffmpeg instead |

## Utilities

- `npx tsx server/scripts/detect-image.ts lot.jpg` writes `lot.detections.png` with boxes drawn
- `npm test` runs the geometry / scoring / hysteresis unit tests
