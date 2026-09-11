export const metadata = Object.freeze({
    id: 'portrait-circuit',
    name: 'Portrait Circuit',
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
        angle: options.angle || 0,
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

export function createMap({ width, height, options = {} }) {
    const durationSeconds = Math.max(20, Number(options.matchDurationSeconds) || 59);
    const targetFps = Math.max(1, Math.round(Number(options.targetFps) || 60));
    const maxFrames = Math.round(durationSeconds * targetFps);

    return {
        id: metadata.id,
        name: metadata.name,
        match: {
            maxFrames,
            timeoutWinnerRule: 'alive-then-power'
        },
        spawnZones: {
            cyan: formation(250, 535),
            magenta: formation(width - 250, 535),
            gold: formation(250, height - 535),
            lime: formation(width - 250, height - 535)
        },
        walls: [
            // A small central divider creates readable flanking choices without hiding teams.
            wall('center-upper', width / 2, height / 2 - 150, 54, 210, {
                styleVariant: 'solid-static'
            }),
            wall('center-lower', width / 2, height / 2 + 150, 54, 210, {
                styleVariant: 'solid-static'
            }),

            // The yellow striped paddles are the only moving obstacles in this map.
            wall('upper-paddle', width / 2, 720, 300, 38, {
                styleVariant: 'moving-solid',
                motion: { type: 'oscillate', axis: 'x', amplitude: 235, periodFrames: targetFps * 5, phase: 0 }
            }),
            wall('lower-paddle', width / 2, height - 720, 300, 38, {
                styleVariant: 'moving-solid',
                motion: { type: 'oscillate', axis: 'x', amplitude: 235, periodFrames: targetFps * 5, phase: Math.PI }
            }),

            // Short side bumpers keep combat near the visible center lane.
            wall('left-bumper', 240, height / 2, 34, 250, {
                styleVariant: 'solid-static'
            }),
            wall('right-bumper', width - 240, height / 2, 34, 250, {
                styleVariant: 'solid-static'
            })
        ],
        zone: {
            shape: 'rect',
            initialHalfWidth: 510,
            initialHalfHeight: 830,
            stages: [
                {
                    id: 'move-in',
                    atFrame: targetFps * 15,
                    targetHalfWidth: 455,
                    targetHalfHeight: 700,
                    mode: 'linear',
                    shrinkSpeed: 1.15,
                    label: 'The safe box is getting smaller',
                    shortLabel: 'Safe box smaller',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'middle-fight',
                    atFrame: targetFps * 30,
                    targetHalfWidth: 365,
                    targetHalfHeight: 520,
                    mode: 'linear',
                    shrinkSpeed: 1.25,
                    label: 'Move toward the middle',
                    shortLabel: 'Move to middle',
                    rewardPowerups: true,
                    damageActive: false
                },
                {
                    id: 'danger-zone',
                    atFrame: targetFps * 45,
                    targetHalfWidth: 275,
                    targetHalfHeight: 360,
                    mode: 'linear',
                    shrinkSpeed: 1.45,
                    label: 'Outside the red box hurts',
                    shortLabel: 'Red outside hurts',
                    rewardPowerups: true,
                    damageActive: true
                },
                {
                    id: 'final-circle',
                    atFrame: targetFps * 54,
                    targetHalfWidth: 170,
                    targetHalfHeight: 205,
                    mode: 'ease',
                    shrinkSpeed: 0.075,
                    label: 'Final fight',
                    shortLabel: 'Final fight',
                    rewardPowerups: true,
                    damageActive: true
                }
            ],
            damage: { intervalFrames: Math.max(1, Math.round(targetFps * 0.25)), percent: 0.2, base: 3 }
        },
        stageRewardSpawns: [
            { x: 0.39, y: 0.43 },
            { x: 0.61, y: 0.43 },
            { x: 0.39, y: 0.57 },
            { x: 0.61, y: 0.57 }
        ]
    };
}
