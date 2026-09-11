# Offline replay recorder

The default recorder renders one authoritative 60 Hz match and samples it at the requested output rate. It does not use `MediaRecorder`, `captureStream()`, or `capture-speed`.

## Instagram delivery presets

### Quality-first 30 FPS

```powershell
npm run record -- `
  --seed seed-455 `
  --delivery-preset instagram-hd-30 `
  --output recordings/seed-455-instagram.mp4 `
  --workers 6 `
  --threads 6 `
  --max-simulation-frames 3900
```

This preset uses:

```text
1080x1920 constant 30 FPS
H.264 High, level 4.1
CRF 16, x264 medium
14 Mbps VBV maximum, 28 Mbps buffer
Rec.709 primaries/transfer/matrix
Limited/tv video range
YUV 4:2:0
AAC-LC, 48 kHz, stereo, 192 kbps
Two-second keyframe interval
Fast-start MP4
```

### Smooth 60 FPS

```powershell
npm run record -- `
  --seed seed-455 `
  --delivery-preset instagram-smooth-60 `
  --output recordings/seed-455-instagram-60.mp4 `
  --workers 6 `
  --threads 6 `
  --max-simulation-frames 3900
```

This uses H.264 High level 4.2 and a 24 Mbps maximum bitrate. The 30 FPS preset is recommended when text and fine outlines matter more than motion smoothness.

Passing only `--fps 30` or `--fps 60` automatically selects the corresponding Instagram preset. To create an unrestricted local master, use:

```powershell
npm run record -- --seed seed-455 --delivery-preset master
```

## Validate a finished file

```powershell
npm run verify:instagram -- recordings/seed-455-instagram.mp4
```

The verifier checks:

- 1080x1920 resolution
- Constant 30 or 60 FPS
- H.264 High profile and appropriate level
- `yuv420p`
- Rec.709 primaries, transfer and matrix
- Limited/tv range
- AAC audio at 48 kHz stereo
- Conservative bitrate warnings

The recorder performs the same mandatory checks before accepting an Instagram-preset output.

## Editable text and UI sizes

All values below are canvas pixels in `game-config.json` and affect simulation and recording together.

### Corner team panels

```json
"ui": {
  "teamPanels": {
    "enabled": true,
    "width": 282,
    "height": 102,
    "marginX": 24,
    "marginY": 24,
    "teamNameFontSize": 22,
    "healthFontSize": 35,
    "activeFontSize": 19
  }
}
```

The remaining position controls are `teamNameX`, `teamNameY`, `healthX`, `healthY`, `activeRightPadding`, and `activeY`.

### Winner overlay

```json
"winnerOverlay": {
  "enabled": true,
  "width": 680,
  "height": 154,
  "fontSize": 62,
  "centerY": 960
}
```

### Health inside bots

```json
"botHealth": {
  "minimumFontSize": 18,
  "maximumFontSize": 34
}
```

These values are used by `plugins/styles/beige-glyph-2/style.js` in `drawBot()`.

### Powerup labels

```json
"powerupLabels": {
  "fontSize": 18,
  "offsetY": 24,
  "fontWeight": 800
}
```

These values are used by `drawPowerup()` in `plugins/styles/beige-glyph-2/style.js`.

### Configured hook/display text

The content and position remain in the top-level `displayText` object:

```json
"displayText": {
  "text": "PICK A TEAM BEFORE THE FIRST KILL",
  "startSeconds": 0.3,
  "endSeconds": 3.0,
  "x": 540,
  "y": 300
}
```

Its visual size is controlled separately:

```json
"ui": {
  "displayText": {
    "fontSize": 54,
    "minimumFontSize": 34,
    "maximumFontSize": 60,
    "panelPaddingX": 58,
    "panelHeightScale": 1.58
  }
}
```

### Match clock

```json
"matchClock": {
  "fontSize": 35,
  "boxWidth": 226,
  "boxHeight": 66,
  "y": 28,
  "textY": 27,
  "progressY": 49,
  "progressHeight": 8
}
```

## Audio

The authoritative event timeline is rendered once to WAV and muxed after all parallel video segments are joined. Instagram presets encode AAC-LC at 48 kHz stereo and 192 kbps. A final limiter prevents peaks above approximately -1 dBFS without changing event timestamps.

Audio synchronization remains:

```text
event time = authoritative simulation frame / 60
```

## Environment overrides

```text
CHROMIUM_PATH   Chrome, Chromium or Edge executable
FFMPEG_PATH     ffmpeg executable
FFPROBE_PATH    ffprobe executable
```
