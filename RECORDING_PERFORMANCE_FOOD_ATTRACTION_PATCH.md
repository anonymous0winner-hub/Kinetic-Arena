# Recording performance and food-attraction patch

## Recording changes

- Physics continues at 60 simulation steps per game second.
- Style rendering occurs only at the requested final output FPS.
- A 30 FPS export performs two physics steps and one render per output frame.
- No capture intervals are intentionally skipped. If rendering is slower than the paced deadline, recording takes longer rather than dropping frames.
- Static backgrounds and non-moving walls are cached into offscreen layers.
- Particle removal now uses in-place compaction rather than repeated `splice()` calls.
- Static entity radii and bot radii are cached where safe.
- Chromium is launched with GPU rasterization and Canvas OOP rasterization enabled.
- MP4 encoding tries Intel Quick Sync first on the target Intel Core Ultra laptop.
- Software fallback uses six FFmpeg filter/encoder threads and `libx264`.
- Software preset defaults to `veryfast` at the same CRF. This trades compression efficiency/file size for substantially lower encode time, not lower target quality.

## New recorder configuration

```json
"renderAtOutputFps": true,
"encoderThreads": 6,
"hardwareEncoder": "auto",
"hardwareQuality": 18
```

`hardwareEncoder` accepts:

- `auto`: try Intel Quick Sync, then fall back to software.
- `qsv`: require Intel Quick Sync and fail if unavailable.
- `software`: always use `libx264`.

CLI equivalents:

```text
--threads 6
--encoder auto|qsv|software
```

Metadata now includes render time, schedule lag, source-frame loss, selected encoder, audio-render time, and encode time.

## Food attraction

```json
"FOOD_ATTRACTION_RANGE": 150,
"FOOD_ATTRACTION_STRENGTH": 0.32
```

Food selects the nearest living bot inside the configured range and applies a deterministic force toward it. The force has a smooth range falloff and a strength-derived terminal-speed cap to avoid tunnelling through bots or walls.
