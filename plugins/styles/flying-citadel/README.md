# Flying Citadel style

A procedural sci-fi presentation theme inspired by moonlit flying-tank combat art while keeping the arena readable at portrait resolution.

Files:
- `style.js`: plugin entry point and all entity/background renderers.
- `palette.js`: team and powerup color tokens.
- `canvas-utils.js`: reusable canvas paths, icons, hashing, and health formatting.
- `effects.js`: deterministic particle descriptors.
- `style.css`: DOM HUD and page styling.

Theme options under `pluginOptions.style`:
- `showPowerupLabels` (default `true`)
- `showMatchClock` (default `true`)
- `showHealthChips` (default `true`)

Health is shown in a floating HUD chip rather than covering the vehicle. Large values use engineering suffixes (`K`, `M`, `B`, `T`, `P`, `E`) so there is no fixed maximum value or maximum digit width.
