# Instagram HD export patch

This patch adds:

- `instagram-hd-30` and `instagram-smooth-60` offline replay delivery presets.
- Explicit H.264 High profile, level, Rec.709 and limited-range metadata.
- CRF plus VBV bitrate ceilings suitable for fast animated arena footage.
- AAC-LC 48 kHz stereo audio at 192 kbps with a -1 dB peak limiter.
- Automatic output validation and `npm run verify:instagram`.
- Configurable canvas font and panel sizes for the corner UI, winner card, bot health, powerup labels, hook text and timer.

Recommended command:

```powershell
npm run record -- `
  --seed seed-455 `
  --delivery-preset instagram-hd-30 `
  --output recordings/seed-455-instagram.mp4 `
  --workers 6 `
  --threads 6 `
  --max-simulation-frames 3900
```

Validate before upload:

```powershell
npm run verify:instagram -- recordings/seed-455-instagram.mp4
```
