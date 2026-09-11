# Kinetic Arena — Deterministic Modular Edition

Kinetic Arena is composed from one source of truth: [`game-config.json`](game-config.json). Styles, maps, AI controllers, powerups, audio, teams, per-member AI assignment, seed, time scale, recorder settings, and seed-search defaults are selected there.

## Run the game

Browser modules and manifests require HTTP:

```bash
cd kinetic-arena
python -m http.server 8080
```

Open `http://localhost:8080` and click or press a key once to unlock browser audio.

Run deterministic tests:

```bash
npm test
```

## Plugin systems

```text
plugins/styles/    Rendering, effects, UI appearance, and logical geometry
plugins/ai/        Per-bot movement, targeting, firing, and tactical decisions
plugins/maps/      Viewport, walls, spawns, collapse stages, and match limit
plugins/powerups/  Spawn weighting, strength, collection, duration, and modifiers
plugins/audio/     Event-to-sound definitions used by live and offline audio
```

Each folder has its own `manifest.json`. Add or remove a plugin directory and its manifest entry, then select its ID in `game-config.json`; the game loop does not import concrete plugins directly.

## Main configuration

```json
{
  "seed": "portrait-circuit-demo-001",
  "timeScale": 1,
  "targetFps": 60,
  "pluginRegistry": {
    "styles": "./plugins/styles/manifest.json",
    "ai": "./plugins/ai/manifest.json",
    "maps": "./plugins/maps/manifest.json",
    "powerups": "./plugins/powerups/manifest.json",
    "audio": "./plugins/audio/manifest.json"
  },
  "plugins": {
    "style": "minimal-tactical",
    "map": "portrait-circuit",
    "audio": "minimal-impact",
    "ai": {
      "enabled": ["sentinel-vector", "swarm-tactician"],
      "default": "sentinel-vector"
    },
    "powerups": {
      "enabled": ["OVERCHARGE", "AEGIS", "TURBO", "REGEN", "FOCUS"]
    }
  }
}
```

### Teams and per-member AI

```json
{
  "id": "cyan",
  "label": "Blue",
  "members": 4,
  "defaultAI": "sentinel-vector",
  "memberAI": {
    "4": "swarm-tactician"
  }
}
```

Stable bot IDs are `<team-id>-<member-number>`, such as `cyan-4`. `bots.count` must equal the sum of all team member counts.

### Deterministic randomness

No runtime module uses `Math.random()`. The seed generates isolated named streams for each AI, spawn variation, bot cooldowns, map behavior, food, powerup type and position, projectile spread, and visual effects. Replaying the same seed and configuration reproduces the same match.

`match.restartSeedPolicy` supports:

```text
repeat     Replay the same match.
increment  Use <base-seed>::round-N for deterministic new rounds.
```

### Time scale

`timeScale` controls simulation frames per real second:

```text
simulation frames per second = targetFps × timeScale
```

The frame-by-frame recorder uses the same conversion, so exported video and audio remain synchronized at non-default time scales.

## Modular audio

The default audio plugin is:

```text
plugins/audio/minimal-impact/audio.js
```

It maps frame-stamped game events such as `shoot`, `projectile-hit`, `bot-death`, `powerup-collect`, `zone-stage`, and `match-end` to pure sound cue descriptions. The browser audio engine and offline WAV renderer consume the same cue descriptions.

Select another audio plugin:

```json
"plugins": {
  "audio": "silent"
}
```

Audio API details are in [`docs/AUDIO_PLUGIN_API.md`](docs/AUDIO_PLUGIN_API.md).

## Optimized recorder

Requirements:

- Node.js 22 or newer.
- FFmpeg and FFprobe on `PATH`, or configure their environment variables.
- Chromium, Chrome, or Edge, or set `CHROMIUM_PATH`.

Record the configured seed as a 1080×1920, 60 FPS WebM:

```bash
npm run record
```

Record another seed at 30 FPS:

```bash
npm run record -- --seed experiment-42 --fps 30
```

The default production path runs the deterministic simulation at half speed while Chromium captures a lower-rate source stream. FFmpeg compresses its timestamps back to the requested 30 or 60 FPS and muxes offline-generated event audio. A one-minute match therefore normally takes about two minutes to capture, rather than 15–20 minutes of PNG frame export.

WebM is the default because its VP9/VP8 video can normally be copied without re-encoding. MP4 remains optional:

```bash
npm run record -- --seed experiment-42 --format mp4 --output recordings/experiment-42.mp4
```

The capture health guard retries at a slower speed when it detects a serious render stall, up to approximately 3× final duration. Resolution, requested FPS, and the presence of an audio stream are validated with FFprobe.

The previous screenshot-based exporter remains available for diagnostics:

```bash
npm run record:exact -- --seed experiment-42 --fps 60
```

Recorder details are in [`docs/RECORDER.md`](docs/RECORDER.md).

On Windows PowerShell, use a single-line command or PowerShell backticks; `\` is not a continuation character. The recorder performs a codec preflight and automatically retries in visible Chromium if headless canvas recording is unavailable.


## Parallel logic-only Seed Finder

Search deterministic seeds without rendering, CSS, particles, UI work, or audio:

```bash
npm run find-seeds -- \
  --prefix arena \
  --count 1000 \
  --workers 6 \
  --top 50 \
  --selected-limit 20 \
  --output results/arena-1000.json
```

The workers still execute the complete authoritative AI, movement, firing, collision, powerup, map, damage, and winner logic. Rejected seeds are not retained as full result objects by default, which keeps 1,000–5,000-seed searches bounded in memory.

Use `--details` only when readable reasons and component breakdowns are needed, and `--all-results` only when every rejected seed must be preserved. The command reports seeds per second and ETA while running.

Seed Finder details are in [`docs/SEED_FINDER.md`](docs/SEED_FINDER.md).

## Runtime APIs

```js
window.KineticArena.getSnapshot();
window.KineticArena.getEvents();
window.KineticArena.pause();
window.KineticArena.resume();
window.KineticArena.restart({ seed: 'experiment-42' });
window.KineticArena.stepFrames(60);

window.KineticArena.recording.prepare({ seed: 'experiment-42' });
window.KineticArena.recording.stepToFrame(600);
window.KineticArena.recording.events();

await window.KineticArena.seedFinder.evaluateSeed('experiment-42');
await window.KineticArena.seedFinder.search({ prefix: 'test', count: 10 });
```

Complete plugin and configuration contracts are in [`docs/PLUGIN_API.md`](docs/PLUGIN_API.md).

## Frame-paced recording and food attraction

The optimized recorder keeps simulation physics at `targetFps` (normally 60 Hz), but renders the complete style only at the requested output FPS. A 30 FPS export therefore performs two deterministic physics updates per rendered frame instead of drawing the scene at 60 FPS and discarding half the images.

MP4 encoding uses Intel Quick Sync (`h264_qsv`) automatically when the installed FFmpeg build and Intel driver support it. If Quick Sync cannot initialize, the recorder falls back to `libx264` with the configured thread count.

Relevant `game-config.json` options:

```json
"recording": {
  "renderAtOutputFps": true,
  "encoderThreads": 6,
  "hardwareEncoder": "auto",
  "hardwareQuality": 18,
  "preset": "veryfast"
}
```

CLI overrides:

```powershell
npm run record -- `
  --seed seed-455 `
  --fps 30 `
  --format mp4 `
  --output recordings/seed-455.mp4 `
  --capture-speed 0.4 `
  --threads 6 `
  --encoder auto
```

Food attraction is configured under `simulation`:

```json
"FOOD_ATTRACTION_RANGE": 150,
"FOOD_ATTRACTION_STRENGTH": 0.32
```

- `FOOD_ATTRACTION_RANGE`: maximum distance in world pixels at which food detects the nearest living bot. Set to `0` to disable attraction.
- `FOOD_ATTRACTION_STRENGTH`: acceleration applied toward that bot. Set to `0` to disable attraction. Larger values make food travel faster.

The attraction calculation is deterministic and therefore remains identical in the simulator, Seed Finder, and recorder for the same seed.

## Offline parallel recording

`npm run record` now executes one authoritative 60 Hz simulation and renders its output frames through parallel Chromium processes. It does not use `MediaRecorder`, so output frame rate cannot change food generation, powerups, winner, or match timing.

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

Use `--fps 60` for a 60 FPS render. `--capture-speed` and `--source-codec` are ignored by the offline renderer. The old real-time recorder is available as `npm run record:legacy`.
