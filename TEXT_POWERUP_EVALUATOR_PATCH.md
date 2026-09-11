# Timed Text, Powerup Rings, and Tunable Evaluator

## Timed text
Configure `displayText.text`, `startSeconds`, and `endSeconds` in `game-config.json`. Empty text disables it. Placement and transitions are implemented by each style.

## Powerups
`simulation.MAX_POWERUPS` is now 2. Collected powerups display up to two rotating dotted rings around the bot, with different radii and opposite rotation directions.

## Evaluator tuning
`seedFinder.scoring.categories` exposes `multiplier`, `constant`, and `bonusScale` for every score component. Powerups contribute to effective team strength through `powerupStrengthWeight` and per-powerup multipliers. `dominanceSwingMinimumDifference` and `dominanceSwingMinimumRatio` define a major swing. The new component is `dominanceSwings`, and the flag is `major-dominance-swing`.
