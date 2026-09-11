# Recording Audio Sync and Text Position Patch

## Recording audio synchronization

The optimized recorder now captures synthesized game audio and canvas video in the same browser `MediaStream`.

- The simulator `AudioManager` feeds a `MediaStreamAudioDestinationNode`.
- The audio and canvas tracks are passed to one `MediaRecorder`.
- Slow capture stretches cue envelopes and compressor timing by `1 / captureSpeed`.
- FFmpeg compresses the captured audio using chained `atempo` filters while preserving pitch.
- Video timestamps and audio tempo are restored to the final match duration together.
- The local monitor branch is muted during automated capture without muting the recording destination.

If the source WebM has no encoded audio stream, the old generated-WAV path remains available. It now uses `recordingTimeSeconds`, captured from actual browser presentation time, so stalls and simulation catch-up do not create the previous large timing mismatch.

Recording metadata reports:

```json
{
  "audioSyncMode": "shared-media-stream",
  "sourceAudioTrackCount": 1,
  "sourceAudioCodec": "opus"
}
```

Possible `audioSyncMode` values:

- `shared-media-stream`: preferred synchronized path.
- `event-timeline-fallback`: Chromium did not encode source audio, so timestamped event rendering was used.

## Text coordinates

`game-config.json` now supports explicit canvas coordinates:

```json
"displayText": {
  "text": "Choose a color",
  "startSeconds": 0.5,
  "endSeconds": 3,
  "x": 540,
  "y": 700
}
```

For the fixed 1080×1920 map, `x: 540` is the horizontal centre. Set either coordinate to `null` or remove it to use the selected style's default. Styles still control typography, visual design, and entry/exit animation.
