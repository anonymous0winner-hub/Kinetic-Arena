# Team panel and recorder reliability fix

## Canvas UI

Added to `game-config.json`:

```json
"ui": {
  "teamPanels": { "enabled": true },
  "winnerOverlay": { "enabled": true }
}
```

- Team panels are drawn directly onto the game canvas.
- Each panel shows team color, label, total surviving health, and active members.
- The same flag controls simulator and recording output.
- Legacy DOM score and winner overlays are hidden to prevent simulator-only UI.
- The selected `beige-glyph-2` style provides matching beige team panels and winner card.

## Recorder

- Codec preflight now waits for `MediaRecorder` to enter the `recording` state.
- Probe duration was increased enough for Windows software VP8/VP9 encoders to emit a keyframe.
- Both canvas modes are tested:
  - manual: `captureStream(0)` + `requestFrame()`
  - automatic: `captureStream(sourceCaptureFps)`
- Automatic mode is selected when Chromium exposes `requestFrame()` but silently encodes zero bytes.
- MP4 automatic-capture output follows presentation timestamps; manual mode retains deterministic frame-index timing.
- Metadata now includes `captureMode`.
- Presentation PTS is normalized from zero before speed conversion.

## Additional corrections

- Fixed the internal style id of `beige-glyph-2`.
- Corrected stale manifest descriptions.
- Corrected stale powerup test expectations.
- Updated runtime mocks for canvas text metrics and hidden canvas-owned UI.
