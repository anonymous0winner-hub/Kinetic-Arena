export const DEFAULT_CONFIG = Object.freeze({
    THRUST_FORCE: 0.16,
    FRICTION: 0.93,
    BOUNCE: 0.8,
    STARTING_POWER: 10,
    INITIAL_FOOD: 250,
    MAX_FOOD: 250,
    FOOD_SPAWN_CHANCE: 0.6,
    FOOD_ATTRACTION_RANGE: 0,
    FOOD_ATTRACTION_STRENGTH: 0,
    POWERUP_SPAWN_FRAMES: 200,
    MAX_POWERUPS: 5,
    WEAPON_COOLDOWN_BASE: 75,
    WEAPON_SPEED_BASE: 11,
    WEAPON_DAMAGE_BASE: 4,
    WEAPON_DAMAGE_PCT: 0.15,
    MAX_SHOTS_PER_DECISION: 5,
    MELEE_DRAIN_BASE: 10,
    MELEE_DRAIN_PCT: 0.5
});

// Mutable by design: ES modules importing CONFIG retain this object reference.
// game-config.json is applied once before entities are created.
export const CONFIG = { ...DEFAULT_CONFIG };

export function applySimulationConfig(overrides = {}) {
    for (const key of Object.keys(CONFIG)) delete CONFIG[key];
    Object.assign(CONFIG, DEFAULT_CONFIG);

    for (const [key, value] of Object.entries(overrides || {})) {
        if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown simulation setting "${key}" in game-config.json.`);
        if (!Number.isFinite(value)) throw new Error(`Simulation setting "${key}" must be numeric.`);
        CONFIG[key] = value;
    }
    return CONFIG;
}

// Semantic identities remain stable so styles and maps can target known teams.
// Labels may be overridden by game-config.json.
export const TEAMS = Object.freeze({
    cyan: Object.freeze({ id: 'cyan', label: 'Cyan Swarm' }),
    magenta: Object.freeze({ id: 'magenta', label: 'Magenta Swarm' }),
    gold: Object.freeze({ id: 'gold', label: 'Gold Swarm' }),
    lime: Object.freeze({ id: 'lime', label: 'Lime Swarm' })
});
