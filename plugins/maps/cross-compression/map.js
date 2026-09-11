export const metadata = Object.freeze({
    id: 'cross-compression',
    name: 'Cross Compression',
    apiVersion: 1
});

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
    const thickness = 16;
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
                angularSpeed: 0.035,
                styleVariant: 'bullet-pass-moving'
            }),
            rotatingWall({
                id: 'east-rotor',
                x: centerX + Math.min(180, width * 0.18),
                y: centerY,
                w: 20,
                h: Math.min(160, height * 0.28),
                angularSpeed: -0.035,
                styleVariant: 'bullet-pass-moving'
            })
        ],

        zone: {
            shape: 'rect',
            initialHalfSize,
            stages: [
                {
                    id: 'field-compression',
                    atFrame: 1200,
                    targetHalfSize: initialHalfSize * 0.40,
                    mode: 'linear',
                    shrinkSpeed: 0.60,
                    label: 'Stage 1: Field Compression',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'forced-engagement',
                    atFrame: 2400,
                    targetHalfSize: initialHalfSize * 0.25,
                    mode: 'linear',
                    shrinkSpeed: 0.60,
                    label: 'Stage 2: Forced Engagement',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'sudden-death',
                    atFrame: 3600,
                    targetHalfSize: 160,
                    mode: 'linear',
                    shrinkSpeed: 0.60,
                    label: 'Sudden Death: Damage Active',
                    rewardPowerups: true,
                    damageActive: true
                }
            ],
            damage: {
                intervalFrames: 30,
                percent: 0.15,
                base: 2
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
