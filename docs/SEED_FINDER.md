# Parallel Logic-Only Seed Finder

The Seed Finder evaluates deterministic matches without rendering them. It uses the same AI, movement, firing, collision, powerup, wall, zone, and winner rules as the recorded game, but removes work that cannot affect the outcome.

## What is disabled

In `?automation=seed` mode the runtime does not perform:

- Canvas rendering.
- CSS theme loading.
- Particles or visual effects.
- Live or offline audio synthesis.
- Scoreboard DOM updates.
- Full recording snapshots.
- Human-readable result explanations unless requested.

It still performs every authoritative simulation step. AI frequency, collision rules, projectile movement, seeded randomness, damage, spawning, and map timing are not approximated.

## Parallel execution

`tools/find-seeds.mjs` launches several independent headless Chromium logic workers. Each worker receives batches of seeds and returns only:

- Its best candidates.
- Candidates passing the configured threshold.
- Numeric score values needed for global statistics.

By default, full data for every rejected seed is not retained.

Configuration:

```json
"seedFinder": {
  "evaluator": "engaging-v2",
  "sampleEveryFrames": 30,
  "maxFrames": 3600,
  "topK": 20,
  "minimumScore": 190,
  "minimumTier": "A",
  "selectedLimit": 20,
  "parallelWorkers": 6,
  "logicOnly": true,
  "retainAllResults": false
}
```

Six workers are suitable for the target 16 GB Core Ultra 5 laptop. Use fewer workers if the machine becomes thermally constrained; use up to eight when profiling shows a benefit.

## Commands

Search 1,000 seeds:

```bash
npm run find-seeds -- \
  --prefix arena \
  --count 1000 \
  --workers 6 \
  --batch-size 20 \
  --top 50 \
  --selected-limit 20 \
  --output results/arena-1000.json
```

Search 5,000 seeds:

```bash
npm run find-seeds -- \
  --prefix arena \
  --count 5000 \
  --workers 6 \
  --batch-size 25 \
  --min-score 220 \
  --top 50 \
  --selected-limit 30 \
  --output results/arena-5000.json
```

Useful options:

```text
--workers <n>          Parallel logic workers, maximum 8
--batch-size <n>       Seeds assigned to one worker call
--sample-every <n>     State sample interval in simulation frames
--details              Include components and readable reasons
--all-results          Retain every result, not only bounded candidates
--min-score <n>        Selection score threshold
--min-tier <tier>      S, A, B, C, or D
--top <n>              Number of globally highest seeds retained
--selected-limit <n>   Maximum threshold-passing seeds retained
```

For maximum throughput, do not pass `--details` or `--all-results`.

## Bounded memory behavior

Without `--all-results`, each worker retains only:

```text
max(topK, selectedLimit)
```

candidate objects. A 5,000-seed run therefore does not build a 5,000-match JSON structure in browser memory. The final file contains `top[]`, `selected[]`, statistics, and execution performance.

## Output

Results are sorted from highest to lowest Drama Score:

```json
{
  "execution": {
    "logicOnly": true,
    "parallelWorkers": 6,
    "batchSize": 25,
    "sampleEveryFrames": 30,
    "elapsedSeconds": 612.4,
    "seedsPerSecond": 8.165
  },
  "selected": [
    {
      "rank": 1,
      "seed": "arena-417",
      "score": 348.72,
      "tier": "S",
      "summary": {
        "winnerTeamId": "cyan",
        "finalWinnerHealthPercent": 6.4,
        "minimumWinnerHealthPercent": 3.1,
        "worstWinnerDeficitFactor": 4.1,
        "leadChanges": 5,
        "flags": [
          "near-death-finish",
          "major-comeback",
          "one-vs-many-clutch"
        ]
      }
    }
  ]
}
```

Readable reason strings and component breakdowns are only added with `--details`.

## Correctness-preserving runtime optimizations

The following optimizations are shared by normal play and seed search without changing outcomes:

- Per-frame wall collider cache.
- Per-frame wall polygon cache.
- Cached wall sine/cosine values.
- Broad-phase distance/AABB rejection before exact collision tests.
- Reuse of projectile colliders within a frame.
- Pickup broad-phase rejection before exact SAT collision.
- In-place removal of inactive entities instead of repeated array filtering.
- Compact logic-only event records.
- Logic-only immutable-view reductions where no plugin can observe mutation.

The project intentionally does **not** reduce AI decision frequency or skip simulation frames, because that could make a selected seed play differently when recorded.

## Performance expectations

Runtime depends on CPU cooling, AI complexity, projectile count, and worker count. The command prints live seeds-per-second and ETA, so use a short benchmark first:

```bash
npm run find-seeds -- --prefix benchmark --count 100 --workers 6
```

Then estimate:

```text
estimated seconds = requested seed count / measured seeds per second
```

Increasing workers helps until CPU execution units or thermal limits are saturated. More workers after that point can make the search slower.

## Drama Score

The `engaging-v2` evaluator prioritizes outcomes that are rare and tension-building:

- Collective near-death victory, using total winning-team health relative to its starting total.
- Sustained last-place recovery.
- Large health deficit overcome by the winner.
- One-versus-many survival in the final ten seconds.
- A team reaching 2×–4× dominance and still losing.
- Confirmed lead changes with hysteresis.
- Late-match uncertainty and late reversals.
- Meaningful hits, deaths, shield interactions, movement, and powerup use.

It penalizes predictable steamrolls, inactivity, unresolved draws, weak elimination counts, and timeout finishes.

Quality tiers:

```text
S: 300+   Exceptional
A: 190+   Strong recording candidate
B: 130+   Good but not rare
C: 75+    Ordinary
D: <75    Predictable or inactive
```
