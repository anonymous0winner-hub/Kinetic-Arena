# Kinetic Arena Plugin and Configuration API

## 1. Composition lifecycle

Startup occurs in this order:

1. Fetch and validate `game-config.json`.
2. Apply `simulation` values to the shared core configuration object.
3. Resolve manifest URLs from `pluginRegistry`.
4. Load enabled powerup modules and apply safe overrides.
5. Load the selected style and CSS files.
6. Load the selected map.
7. Load the selected audio event mapper.
8. Load only enabled or assigned AI modules.
9. Create deterministic random streams from `seed`.
10. Create the arena, entities, audio manager, and per-bot controllers.

There is no hard-coded plugin import in the game loop.

## 2. `game-config.json`

### Required top-level structure

```json
{
  "schemaVersion": 1,
  "seed": "experiment-001",
  "timeScale": 1,
  "targetFps": 60,
  "pluginRegistry": {},
  "plugins": {},
  "teams": [],
  "bots": {},
  "world": {},
  "match": {},
  "simulation": {}
}
```

### Plugin registries

Paths are resolved relative to `game-config.json`:

```json
"pluginRegistry": {
  "styles": "./plugins/styles/manifest.json",
  "ai": "./plugins/ai/manifest.json",
  "maps": "./plugins/maps/manifest.json",
  "powerups": "./plugins/powerups/manifest.json",
  "audio": "./plugins/audio/manifest.json"
}
```

This allows an experiment to use different plugin collections without editing JavaScript.

### Plugin selection

```json
"plugins": {
  "style": "minimal-tactical",
  "map": "portrait-circuit",
  "audio": "minimal-impact",
  "ai": {
    "enabled": ["sentinel-vector", "swarm-tactician"],
    "default": "sentinel-vector"
  },
  "powerups": {
    "enabled": ["OVERCHARGE", "AEGIS", "TURBO", "REGEN", "FOCUS"],
    "overrides": {
      "REGEN": { "spawnWeight": 1.25 }
    }
  }
}
```

All IDs must exist in their corresponding manifests. A controller used by any team member must also be present in `plugins.ai.enabled`.

### Team and member assignment

```json
"teams": [
  {
    "id": "cyan",
    "label": "Blue",
    "members": 4,
    "defaultAI": "sentinel-vector",
    "memberAI": {
      "2": "swarm-tactician"
    }
  }
]
```

Stable bot IDs use `<team-id>-<1-based-member-number>`, for example `cyan-2`.

### Bot creation

```json
"bots": {
  "count": 16,
  "spawnAttempts": 60,
  "positionJitter": { "x": 18, "y": 18 },
  "initialCooldownFrames": 45
}
```

For formation spawn zones, each member receives a deterministic slot plus a random variation in `[-x,+x]` and `[-y,+y]`.

### World and viewport

Use the selected map’s viewport:

```json
"world": {
  "useMapViewport": true,
  "override": null
}
```

Or override it:

```json
"world": {
  "useMapViewport": false,
  "override": {
    "mode": "fixed",
    "width": 1080,
    "height": 1920,
    "fit": "contain"
  }
}
```

### Match lifecycle

```json
"match": {
  "maxDurationSeconds": 60,
  "winnerDisplayFrames": 180,
  "autoRestart": true,
  "restartSeedPolicy": "repeat",
  "timeoutWinnerRule": "alive-then-power"
}
```

The effective duration is the lower of the global limit and the map limit. Supported timeout rules:

```text
alive-then-power  Compare surviving bot count, then team power.
power-only        Compare team power only.
```

Exact ties are draws.

### Deterministic randomness

Plugins receive random functions derived from independent named streams. Runtime code must use the provided random function or `game.randomValue(channel)`; it must not call `Math.random()`.

AI receives a private stream keyed by bot ID. Therefore one AI controller cannot perturb another controller’s random sequence.

## 3. Style plugins

Manifest entry:

```json
{
  "id": "style-id",
  "name": "Style Name",
  "module": "./style-id/style.js",
  "css": ["./style-id/style.css"]
}
```

Required factory:

```js
export function createStyle({
    config,
    teams,
    gameConfig,
    options,
    powerupDefinitions
}) {
    return {
        getGeometry(kind, entity, game) {},
        createEffectParticles(effectName, data, game) {},
        getTeamVisual(teamId) {},
        getPowerupVisual(powerupId) {},
        styleTeamElement(element, teamId) {},
        drawBackground(ctx, game) {},
        drawZone(ctx, arena, game) {},
        drawWall(ctx, wall, game) {},
        drawFood(ctx, food, game) {},
        drawPowerup(ctx, powerup, game) {},
        drawProjectile(ctx, projectile, game) {},
        drawParticle(ctx, particle, game) {},
        drawBot(ctx, bot, game) {},
        drawClimaxRing(ctx, game, radius, alpha, team) {},

        applyDocument() {},
        formatStageText(stage, game) {},
        formatWinnerText(team, game, reason) {},
        drawOverlay(ctx, game) {}
    };
}
```

The last four methods are optional. `drawOverlay()` is useful for clocks, legends, warnings, and style-owned HUD graphics.

### Logical geometry

`getGeometry()` defines authoritative collision geometry, independently from visible decoration.

```js
{ shape: 'circle', radius: 18 }

{ shape: 'rect', width: 28, height: 8, rotation: entity.angle }

{
  shape: 'regularPolygon',
  sides: 6,
  radius: 24,
  rotation: Math.PI / 6
}
```

Supported kinds:

```text
bot
food
powerup
projectile
wall
```

The geometry is used for spawn checks, bot collision, melee, pickup collection, food collection, projectile hits, wall resolution, swept projectile-wall tests, and AI wall vertices.

### Seeded style effects

```js
createEffectParticles(name, data, game) {
    const random = () => game.randomValue('effects');
    const angle = random() * Math.PI * 2;
    return [{
        x: data.x,
        y: data.y,
        vx: Math.cos(angle) * 5,
        vy: Math.sin(angle) * 5,
        colorToken: `team:${data.teamId}`,
        life: 24,
        radius: 3,
        variant: 'dot'
    }];
}
```

Current semantic effect names:

```text
bot-death
bot-hit
shield-hit
zone-damage
powerup-collect
projectile-wall
```

## 4. AI plugins

Manifest entry:

```json
{
  "id": "controller-id",
  "name": "Controller Name",
  "module": "./controller-id/ai.js"
}
```

Factory:

```js
export function createController({
    config,
    gameConfig,
    random,
    botId,
    teamId,
    memberNumber,
    options,
    powerupDefinitions
}) {
    return {
        decide(perception) {
            return {
                movement: { x: 0, y: 0 },
                fire: [],
                itemForces: [],
                state: {}
            };
        }
    };
}
```

`random()` is deterministic and private to that bot.

### Perception

Important fields include:

```text
self                         Legacy live self reference.
selfStatus                   Immutable own status view.
health                       Own health/power alias.
frameCount                   Current simulation frame.
timeScale                    Configured simulation multiplier.
seed                         Current round seed.
matchRemainingFrames         Frames before forced resolution.
allies / teammates           Visible same-team records.
enemies                      Visible hostile records.
foods                        Visible food records.
powerups                     Visible pickup records.
ownedPowerups                Active effects on self.
walls                        Nearby wall geometry and motion.
projectiles                  Visible projectile threat predictions.
canFire                      Authoritative cooldown status.
hasPowerup                   Whether any effect is active.
isTopBot                     Whether self currently has maximum power.
arena                        Safe rectangle and stage state.
```

Visible bot records include health, radius, velocity, active powerups, distance, and the live entity reference. Visible pickup records include numeric `strength` and semantic `aiTags`.

Wall records include:

```text
id
shape
center
size
angle
nearestPoint
distance
velocity
collision
styleVariant
motion
vertices
```

Projectile records include:

```text
hostile
teamId
position
velocity
radius
damageBase
damagePercent
timeToClosest
predictedClosestDistance
isStraightLineThreat
```

### Decision authority

AI may request movement, firing, and limited item forces. The core remains authoritative for normalization, thrust, friction, cooldowns, projectile creation, damage, collision, collection, death, and match state.

## 5. Map plugins

Manifest entry:

```json
{
  "id": "map-id",
  "name": "Map Name",
  "module": "./map-id/map.js"
}
```

Optional fixed viewport:

```js
export const viewport = {
    mode: 'fixed',
    width: 1080,
    height: 1920,
    fit: 'contain'
};
```

Factory:

```js
export function createMap({ width, height, options, random }) {
    return {
        id: 'map-id',
        name: 'Map Name',
        match: {},
        spawnZones: {},
        walls: [],
        zone: {},
        stageRewardSpawns: []
    };
}
```

`options` is `pluginOptions.map`. `random()` is the seeded map stream.

### Spawn zones

Circle:

```js
{ shape: 'circle', x: 200, y: 300, radius: 90 }
```

Rectangle:

```js
{ shape: 'rect', x: 200, y: 300, w: 180, h: 120 }
```

Formation:

```js
{
  shape: 'formation',
  x: 250,
  y: 535,
  columns: 2,
  spacingX: 76,
  spacingY: 76
}
```

Formation slots combine with `bots.positionJitter` from the game configuration.

### Walls

```js
{
  id: 'moving-paddle',
  shape: 'rect',
  x: 540,
  y: 720,
  w: 300,
  h: 38,
  angle: 0,
  styleVariant: 'moving-solid',
  collision: {
    entities: true,
    projectiles: true,
    vision: true
  },
  motion: {
    type: 'oscillate',
    axis: 'x',
    amplitude: 235,
    periodFrames: 300,
    phase: 0
  }
}
```

Supported motion types:

```js
{ type: 'rotation', angularSpeed: 0.02 }
{ type: 'oscillate', axis: 'x', amplitude: 240, periodFrames: 360, phase: 0 }
{ type: 'linear', velocityX: 1, velocityY: 0 }
```

### Safe zone

```js
zone: {
  initialHalfWidth: 510,
  initialHalfHeight: 830,
  stages: [{
    id: 'danger-zone',
    atFrame: 2700,
    targetHalfWidth: 275,
    targetHalfHeight: 360,
    mode: 'linear',
    shrinkSpeed: 1.45,
    rewardPowerups: true,
    damageActive: true
  }],
  damage: {
    intervalFrames: 15,
    percent: 0.2,
    base: 3
  }
}
```

Shrink modes are `linear`, `instant`, and `ease`.

### Match limit

```js
match: {
  maxFrames: 3540,
  timeoutWinnerRule: 'alive-then-power'
}
```

The core uses the lower of this and `match.maxDurationSeconds` from `game-config.json`.

## 6. Powerup plugins

Manifest entry:

```json
{
  "id": "POWERUP_ID",
  "name": "Powerup Name",
  "module": "./folder/powerup.js"
}
```

Definition:

```js
export const definition = Object.freeze({
    id: 'POWERUP_ID',
    label: 'Powerup Name',
    description: 'What it does.',
    strength: 80,
    spawnWeight: 1,
    durationFrames: 240,
    maxStacks: 1,
    aiTags: ['weapon'],

    onCollect({ bot, game, instance, effect, definition, api }) {},
    onTick({ bot, game, effect, definition, api }) {},
    onExpire({ bot, game, effect, definition, api }) {},
    getModifiers({ bot, game, effect, definition }) {
        return {};
    }
});
```

`strength` is visible to AI and is intended for relative preference ranking. It does not automatically modify mechanics.

Available modifier groups:

```js
{
  movement: {
    thrustMultiplier: 1.2
  },
  weapon: {
    cooldownMultiplier: 0.8,
    speedMultiplier: 1.2,
    damageMultiplier: 1.2,
    damagePercentMultiplier: 1,
    cooldownOverride: 12,
    speedOverride: 18,
    damageBaseOverride: 10,
    projectileVariant: 'focused'
  },
  defense: {
    projectileImmunity: false,
    damageMultiplier: 0.7
  }
}
```

## 9. Invariants

- Plugins communicate through common contracts, not imports between concrete plugins.
- Core simulation code owns authoritative state changes.
- All runtime randomness is seeded.
- A style may change logical geometry, so styles are not necessarily cosmetic.
- A map may own resolution and aspect ratio.
- AI sees only objects within vision and line of sight.
- Manifest IDs are the only IDs used in `game-config.json`.
- Invalid configuration fails before the match starts.


## 7. Audio plugins

Audio plugins are pure event mappers. They do not own game state and must not use wall-clock time.

```js
export function createAudioTheme({ config, teams, gameConfig, options, random }) {
    return {
        id: 'audio-id',
        mapEvent(event) {
            return [{
                type: 'tone',
                duration: 0.08,
                frequency: 600,
                endFrequency: 420,
                gain: 0.15,
                waveform: 'square',
                pan: 0
            }];
        }
    };
}
```

The live Web Audio path and offline MP4 audio renderer consume the same cue descriptors. See [`AUDIO_PLUGIN_API.md`](AUDIO_PLUGIN_API.md).

## 8. Game event, snapshot, recorder, and seed APIs

Game events are immutable JSON-compatible records:

```js
{
  sequence,
  frame,
  type,
  payload
}
```

Use:

```js
window.KineticArena.getEvents();
window.KineticArena.getSnapshot();
window.KineticArena.recording.prepare({ seed });
window.KineticArena.recording.stepToFrame(frame);
await window.KineticArena.seedFinder.evaluateSeed(seed);
```

The snapshot exposes bot health, team health, positions, velocities, owned powerups, arena powerups, winner, and match termination reason. See [`RECORDER.md`](RECORDER.md) and [`SEED_FINDER.md`](SEED_FINDER.md).


### Configurable style-owned display text

`game-config.json` may provide a timed canvas message:

```json
"displayText": {
  "text": "Choose a color",
  "startSeconds": 0.5,
  "endSeconds": 3,
  "x": 540,
  "y": 700
}
```

`x` and `y` are canvas/world pixel coordinates. Either may be `null` or omitted to use the style's default position. The core controls only content, timing, and optional coordinates. The selected style owns font, panel treatment, transition, line width, and fallback placement through `drawDisplayText(ctx, game, config)`. Empty text disables the message.
