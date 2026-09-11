# Frame-accurate recording audio patch

The recorder now captures video only and synthesizes its final soundtrack from deterministic game events after capture. Each event records the index of the first output video frame that can display it. MP4 output regenerates video timestamps from decoded frame order and places each sound at `recordingFrameIndex / fps`. This removes WebAudio/MediaStream latency and FFmpeg `atempo` transient displacement.

`recording.audioSyncOffsetMs` is an optional final calibration. Positive values delay sound; negative values advance it. Keep `0` unless a specific machine/player still shows a constant residual offset.

The muxer no longer uses `-shortest`; audio is rendered to the exact target video duration. Output validation rejects duration errors over roughly two video frames and audio/video stream-start skew over 25 ms.
