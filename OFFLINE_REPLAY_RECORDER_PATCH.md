# Offline parallel replay recorder

The default `npm run record` command no longer uses `MediaRecorder` or `canvas.captureStream()`.

## Architecture

1. One hidden Chromium instance executes the complete authoritative match at the configured 60 Hz simulation rate without rendering.
2. The final simulation frame, winner, food/powerup timeline, and audio event log are fixed before any video frame is rendered.
3. The output frame range is split across independent Chromium render processes.
4. Every render process starts from the same seed, advances the same 60 Hz simulation, and renders only its assigned 30 or 60 FPS output frames.
5. Frames are captured exactly with DevTools screenshots and encoded into independent segments.
6. Segments are concatenated without re-encoding.
7. Audio is rendered from authoritative simulation-frame events and muxed to the exact final duration.

Rendering does not control simulation timing, so 30 FPS and 60 FPS produce the same match result.

## Commands

```powershell
npm run record -- `
  --seed seed-455 `
  --fps 30 `
  --format mp4 `
  --output recordings/seed-455.mp4 `
  --workers 6 `
  --threads 6 `
  --max-simulation-frames 3900
```

For 60 FPS, change only `--fps 60`.

`--capture-speed` and `--source-codec` are accepted for command compatibility but ignored. They are only meaningful for the legacy real-time recorder:

```powershell
npm run record:legacy -- ...
```

## Configuration

```json
"recording": {
  "mode": "offline-replay",
  "renderWorkers": 6,
  "maximumRenderWorkers": 6,
  "encoderThreads": 6
}
```

With six render workers, each segment encoder normally receives one FFmpeg thread. The rendering work—not H.264 encoding—runs in parallel.

## Guarantees

The exporter validates:

- 1080×1920 output
- requested 30 or 60 FPS
- final frame count
- final duration
- audio stream presence
- final rendered winner and match-end frame against the authoritative pass
- zero MediaRecorder source-frame loss
