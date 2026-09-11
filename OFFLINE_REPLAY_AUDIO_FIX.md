# Offline replay audio timing fix

This patch fixes the offline replay exporter producing one combined blip at the start.

## Root cause

Authoritative events contain:

```js
recordingTimeSeconds: null
recordingFrameIndex: null
```

The old WAV renderer used `Number(null)`, which equals `0`, and treated that as a valid presentation timestamp. Every event was therefore mixed at time zero.

## Correct timing

Offline replay exports now explicitly use:

```text
audio time = authoritative event.frame / simulation FPS
```

The output video FPS and the number/speed of parallel render workers cannot alter the soundtrack timing.

## Validation

The recorder now rejects a non-silent match when:

- the audio theme maps the match to only one cue;
- all cues collapse near the beginning;
- the WAV has no non-silent samples;
- the WAV peak is effectively zero.

The recording metadata now includes cue count, audible event count, first/last cue time, peak, RMS and non-silent sample count.
