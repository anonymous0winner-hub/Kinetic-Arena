// ==========================================
// --- MAP CONFIGURATION & FINE TUNING ---
// Change these values to fit or adjust the contraptions
// ==========================================
const CONFIG = {
    // --- STAGE TIMINGS (Frames) ---
    // Assuming 60 FPS: 1200 frames = 20 seconds
    stage1Frame: 500,          // Start of first field compression
    stage2Frame: 1600,          // Start of forced engagement compression
    stage3Frame: 4000,          // Start of sudden death (damage activates)

    // --- ZONE SHRINKING ---
    shrinkSpeed: 0.55,          // Speed at which the safe zone borders close in
    stage1TargetPercent: 0.40,  // Target size for stage 1 (40% of initial)
    stage2TargetPercent: 0.25,  // Target size for stage 2 (25% of initial)
    stage3TargetSize: 300,      // Final sudden death absolute size in pixels

    // --- DAMAGE SETTINGS (Active in Stage 3) ---
    damageIntervalFrames: 30,   // How often damage ticks (30 frames = 0.5 sec)
    damagePercent: 0.05,        // 15% max health damage per tick
    damageBase: 1,              // Flat base damage added per tick

    // --- ROTORS & WALLS ---
    rotorSpeed: 0.035,          // Angular speed of the rotating walls
    wallThickness: 16           // Thickness of the static map dividers
};
// ==========================================

export const metadata = Object.freeze({
    id: 'cross-compression',
    name: 'Cross Compression',
    apiVersion: 1
});

// Locks the map to exactly 1080x1920 (Portrait), naturally rotating and fitting the responsive math
export const viewport = {
    mode: 'fixed',
    width: 1080,
    height: 1920,
    fit: 'contain'
};

function rectWall({ id, x, y, w, h, collision, styleVariant }) {
    return {
        id,
        shape: 'rect',
        x: x + w / 2,
        y: y + h / 2,
        w,
        h,
        angle: 0,
        motion: null,
        collision: {
            entities: true,
            projectiles: true,
            vision: true,
            ...collision
        },
        styleVariant
    };
}

function rotatingWall({ id, x, y, w, h, angularSpeed, collision, styleVariant }) {
    return {
        id,
        shape: 'rect',
        x,
        y,
        w,
        h,
        angle: 0,
        motion: {
            type: 'rotation',
            angularSpeed
        },
        collision: {
            entities: true,
            projectiles: false,
            vision: false,
            ...collision
        },
        styleVariant
    };
}

/**
 * Map plugin API.
 * All coordinates may be generated responsively from the supplied viewport.
 */
export function createMap({ width, height }) {
    const centerX = width / 2;
    const centerY = height / 2;
    const thickness = CONFIG.wallThickness;
    const centerGap = Math.min(360, Math.max(220, Math.min(width, height) * 0.42));
    const initialHalfSize = Math.max(width, height);

    return {
        id: metadata.id,
        name: metadata.name,

        spawnZones: {
            cyan: { shape: 'circle', x: width * 0.15, y: height * 0.15, radius: 75 },
            magenta: { shape: 'circle', x: width * 0.85, y: height * 0.15, radius: 75 },
            gold: { shape: 'circle', x: width * 0.15, y: height * 0.85, radius: 75 },
            lime: { shape: 'circle', x: width * 0.85, y: height * 0.85, radius: 75 }
        },

        walls: [
            rectWall({
                id: 'north-divider',
                x: centerX - thickness / 2,
                y: 0,
                w: thickness,
                h: Math.max(0, centerY - centerGap / 2),
                styleVariant: 'solid-static'
            }),
            rectWall({
                id: 'south-divider',
                x: centerX - thickness / 2,
                y: centerY + centerGap / 2,
                w: thickness,
                h: Math.max(0, height - (centerY + centerGap / 2)),
                styleVariant: 'solid-static'
            }),
            rectWall({
                id: 'west-divider',
                x: 0,
                y: centerY - thickness / 2,
                w: Math.max(0, centerX - centerGap / 2),
                h: thickness,
                styleVariant: 'solid-static'
            }),
            rectWall({
                id: 'east-divider',
                x: centerX + centerGap / 2,
                y: centerY - thickness / 2,
                w: Math.max(0, width - (centerX + centerGap / 2)),
                h: thickness,
                styleVariant: 'solid-static'
            }),
            rotatingWall({
                id: 'west-rotor',
                x: centerX - Math.min(180, width * 0.18),
                y: centerY,
                w: 20,
                h: Math.min(160, height * 0.28),
                angularSpeed: CONFIG.rotorSpeed,
                styleVariant: 'bullet-pass-moving'
            }),
            rotatingWall({
                id: 'east-rotor',
                x: centerX + Math.min(180, width * 0.18),
                y: centerY,
                w: 20,
                h: Math.min(160, height * 0.28),
                angularSpeed: -CONFIG.rotorSpeed, // Spins opposite direction
                styleVariant: 'bullet-pass-moving'
            })
        ],

        zone: {
            shape: 'rect',
            initialHalfSize,
            stages: [
                {
                    id: 'field-compression',
                    atFrame: CONFIG.stage1Frame,
                    targetHalfSize: initialHalfSize * CONFIG.stage1TargetPercent,
                    mode: 'linear',
                    shrinkSpeed: CONFIG.shrinkSpeed,
                    label: '',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'forced-engagement',
                    atFrame: CONFIG.stage2Frame,
                    targetHalfSize: initialHalfSize * CONFIG.stage2TargetPercent,
                    mode: 'linear',
                    shrinkSpeed: CONFIG.shrinkSpeed,
                    label: 'Stage 1: Forced Engagement',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'sudden-death',
                    atFrame: CONFIG.stage3Frame,
                    targetHalfSize: CONFIG.stage3TargetSize,
                    mode: 'linear',
                    shrinkSpeed: CONFIG.shrinkSpeed,
                    label: 'Stage 2: Damage Active',
                    rewardPowerups: true,
                    damageActive: true
                }
            ],
            damage: {
                intervalFrames: CONFIG.damageIntervalFrames,
                percent: CONFIG.damagePercent,
                base: CONFIG.damageBase
            }
        },

        // Coordinates normalized to viewport width/height. The core adds small jitter.
        stageRewardSpawns: [
            { x: 0.25, y: 0.25 },
            { x: 0.75, y: 0.25 },
            { x: 0.25, y: 0.75 },
            { x: 0.75, y: 0.75 }
        ]
    };
}