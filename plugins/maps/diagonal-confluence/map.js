export const metadata = Object.freeze({
    id: 'diagonal-confluence',
    name: 'Diagonal Confluence',
    apiVersion: 3
});

export const viewport = Object.freeze({
    mode: 'fixed',
    width: 1080,
    height: 1920,
    fit: 'contain'
});

function wall(id, x, y, w, h, options = {}) {
    return {
        id,
        shape: 'rect',
        x,
        y,
        w,
        h,
        angle: Number(options.angle) || 0,
        styleVariant: options.styleVariant || 'solid-static',
        collision: {
            entities: true,
            projectiles: true,
            vision: true,
            ...(options.collision || {})
        },
        motion: options.motion || null
    };
}

function formation(x, y) {
    return {
        shape: 'formation',
        x,
        y,
        columns: 2,
        spacingX: 76,
        spacingY: 76
    };
}

/**
 * A portrait arena built around an open central chamber.
 * Four angled rails create readable funnels, while two side shuttles alter the
 * approach routes without covering the central fight or creating closed rooms.
 */
export function createMap({ width, height, options = {} }) {
    const durationSeconds = Math.max(30, Number(options.matchDurationSeconds) || 59);
    const targetFps = Math.max(1, Math.round(Number(options.targetFps) || 60));
    const maxFrames = Math.round(durationSeconds * targetFps);
    const centerY = height / 2;

    return {
        id: metadata.id,
        name: metadata.name,
        match: {
            maxFrames,
            timeoutWinnerRule: 'alive-then-power'
        },

        spawnZones: {
            cyan: formation(245, 390),
            magenta: formation(width - 245, 390),
            gold: formation(245, height - 390),
            lime: formation(width - 245, height - 390)
        },

        walls: [
            // Upper funnel. The central gap remains wide enough for direct combat.
            wall('upper-left-rail', 315, 735, 310, 38, {
                angle: 0.30,
                styleVariant: 'solid-static'
            }),
            wall('upper-right-rail', width - 315, 735, 310, 38, {
                angle: -0.30,
                styleVariant: 'solid-static'
            }),

            // Lower funnel mirrors the upper pair and preserves visual symmetry.
            wall('lower-left-rail', 315, height - 735, 310, 38, {
                angle: -0.30,
                styleVariant: 'solid-static'
            }),
            wall('lower-right-rail', width - 315, height - 735, 310, 38, {
                angle: 0.30,
                styleVariant: 'solid-static'
            }),

            // Side shuttles move in opposite phases. They create route variation,
            // but remain outside the final central chamber to avoid late trapping.
            wall('left-shuttle', 220, centerY, 38, 220, {
                styleVariant: 'moving-solid',
                motion: {
                    type: 'oscillate',
                    axis: 'y',
                    amplitude: 165,
                    periodFrames: targetFps * 6,
                    phase: 0
                }
            }),
            wall('right-shuttle', width - 220, centerY, 38, 220, {
                styleVariant: 'moving-solid',
                motion: {
                    type: 'oscillate',
                    axis: 'y',
                    amplitude: 165,
                    periodFrames: targetFps * 6,
                    phase: Math.PI
                }
            })
        ],

        zone: {
            shape: 'rect',
            initialHalfWidth: 510,
            initialHalfHeight: 875,
            stages: [
                {
                    id: 'outer-lanes-close',
                    atFrame: targetFps * 12,
                    targetHalfWidth: 460,
                    targetHalfHeight: 720,
                    mode: 'linear',
                    shrinkSpeed: 1.12,
                    label: 'Outer lanes closing',
                    shortLabel: 'Lanes closing',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'funnel-engagement',
                    atFrame: targetFps * 27,
                    targetHalfWidth: 375,
                    targetHalfHeight: 535,
                    mode: 'linear',
                    shrinkSpeed: 1.28,
                    label: 'Fight through the funnels',
                    shortLabel: 'Funnels closing',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'central-pressure',
                    atFrame: targetFps * 42,
                    targetHalfWidth: 285,
                    targetHalfHeight: 375,
                    mode: 'linear',
                    shrinkSpeed: 1.48,
                    label: 'Central pressure active',
                    shortLabel: 'Central pressure',
                    rewardPowerups: true,
                    damageActive: true
                },
                {
                    id: 'open-chamber-final',
                    atFrame: targetFps * 52,
                    targetHalfWidth: 190,
                    targetHalfHeight: 245,
                    mode: 'ease',
                    shrinkSpeed: 0.078,
                    label: 'Final chamber',
                    shortLabel: 'Final chamber',
                    rewardPowerups: true,
                    damageActive: true
                }
            ],
            damage: {
                intervalFrames: Math.max(1, Math.round(targetFps * 0.25)),
                percent: 0.19,
                base: 3
            }
        },

        stageRewardSpawns: [
            { x: 0.42, y: 0.43 },
            { x: 0.58, y: 0.43 },
            { x: 0.42, y: 0.57 },
            { x: 0.58, y: 0.57 }
        ]
    };
}
