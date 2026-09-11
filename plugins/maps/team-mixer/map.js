/**
 * Team Mixer
 *
 * Four protected team growth chambers feed into a large moving central arena.
 * All coordinates in options are expressed against the fixed 1080x1920 design
 * canvas and are scaled when createMap() receives another viewport size.
 */

export const viewport = Object.freeze({
    mode: 'fixed',
    width: 1080,
    height: 1920,
    fit: 'contain'
});

const MAP_ID = 'team-mixer';
const BASE_WIDTH = 1080;
const BASE_HEIGHT = 1920;

const DEFAULTS = Object.freeze({
    teamIds: ['cyan', 'red', 'green', 'amber'],

    layout: {
        borderThickness: 44,
        separatorThickness: 36,
        corridorWallThickness: 28,

        chamberOuterX: 44,
        chamberInnerX: 480,
        chamberTop: 44,
        chamberBottom: 520,

        // The effective clear corridor is gateWidth - corridorWallThickness.
        // At the default values this leaves 232 px of clear space.
        gateWidth: 260,
        minimumGateWidth: 200,
        corridorEndTop: 760,
        corridorStartBottom: 1160,

        spawnYTop: 270,
        spawnYBottom: 1650,
        spawnColumns: 2,
        spawnSpacingX: 92,
        spawnSpacingY: 92
    },

    middle: {
        enabled: true,
        blockProjectiles: true,
        blockVision: true,

        rotorWidth: 430,
        rotorHeight: 32,
        rotorAngularSpeed: 0.012,

        horizontalSliderWidth: 250,
        horizontalSliderHeight: 32,
        horizontalSliderAmplitude: 270,
        horizontalSliderPeriodFrames: 330,
        horizontalSliderOffsetY: 205,

        verticalSliderWidth: 32,
        verticalSliderHeight: 190,
        verticalSliderAmplitude: 165,
        verticalSliderPeriodFrames: 290,
        verticalSliderOffsetX: 285,

        satelliteWidth: 170,
        satelliteHeight: 26,
        satelliteOffsetX: 185,
        satelliteOffsetY: 115,
        satelliteAngularSpeed: 0.018
    },

    match: {
        maxFrames: 3540,
        timeoutWinnerRule: 'alive-then-power'
    },

    zone: {
        firstStageFrame: 2520,
        targetHalfWidth: 355,
        targetHalfHeight: 500,
        shrinkSpeed: 1.35,
        damageIntervalFrames: 15,
        damagePercent: 0.2,
        damageBase: 3
    }
});

function finiteNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function mergeOptions(options = {}) {
    return {
        ...DEFAULTS,
        ...options,
        teamIds: Array.isArray(options.teamIds) ? options.teamIds : DEFAULTS.teamIds,
        layout: { ...DEFAULTS.layout, ...(options.layout || {}) },
        middle: { ...DEFAULTS.middle, ...(options.middle || {}) },
        match: { ...DEFAULTS.match, ...(options.match || {}) },
        zone: { ...DEFAULTS.zone, ...(options.zone || {}) }
    };
}

function solidCollision({ projectiles = true, vision = true } = {}) {
    return {
        entities: true,
        projectiles,
        vision
    };
}

export function createMap({ width = BASE_WIDTH, height = BASE_HEIGHT, options = {}, random = () => 0.5 } = {}) {
    const config = mergeOptions(options);
    const sx = width / BASE_WIDTH;
    const sy = height / BASE_HEIGHT;

    const scaleX = value => value * sx;
    const scaleY = value => value * sy;

    const wall = ({
        id,
        x,
        y,
        w,
        h,
        angle = 0,
        styleVariant = 'static-solid',
        collision = solidCollision(),
        motion
    }) => {
        const result = {
            id,
            shape: 'rect',
            x: scaleX(x),
            y: scaleY(y),
            w: scaleX(w),
            h: scaleY(h),
            angle,
            styleVariant,
            collision
        };

        if (motion) {
            result.motion = { ...motion };
            if (motion.type === 'oscillate') {
                result.motion.amplitude = motion.axis === 'y'
                    ? scaleY(motion.amplitude)
                    : scaleX(motion.amplitude);
            }
            if (motion.type === 'linear') {
                result.motion.velocityX = scaleX(finiteNumber(motion.velocityX, 0));
                result.motion.velocityY = scaleY(finiteNumber(motion.velocityY, 0));
            }
        }

        return result;
    };

    const layout = config.layout;
    const middle = config.middle;

    const borderThickness = clamp(
        finiteNumber(layout.borderThickness, DEFAULTS.layout.borderThickness),
        20,
        90
    );
    const separatorThickness = clamp(
        finiteNumber(layout.separatorThickness, DEFAULTS.layout.separatorThickness),
        20,
        70
    );
    const corridorWallThickness = clamp(
        finiteNumber(layout.corridorWallThickness, DEFAULTS.layout.corridorWallThickness),
        18,
        60
    );

    const configuredMinimumGate = clamp(
        finiteNumber(layout.minimumGateWidth, DEFAULTS.layout.minimumGateWidth),
        180,
        360
    );
    const gateWidth = clamp(
        finiteNumber(layout.gateWidth, DEFAULTS.layout.gateWidth),
        configuredMinimumGate,
        380
    );

    // Team separation walls are joined to the arena frame so the release
    // corridors are the only traversable exits.
    const chamberOuterX = borderThickness;
    const chamberInnerX = clamp(finiteNumber(layout.chamberInnerX, 480), 400, 510);
    const chamberTop = borderThickness;
    const chamberBottom = clamp(finiteNumber(layout.chamberBottom, 520), 430, 680);
    const corridorEndTop = clamp(
        finiteNumber(layout.corridorEndTop, 760),
        chamberBottom + 120,
        890
    );
    const corridorStartBottom = clamp(
        finiteNumber(layout.corridorStartBottom, 1160),
        1030,
        BASE_HEIGHT - chamberBottom - 120
    );

    const leftGateCenter = (chamberOuterX + chamberInnerX) / 2;
    const rightGateCenter = BASE_WIDTH - leftGateCenter;
    const rightChamberOuterX = BASE_WIDTH - chamberOuterX;
    const rightChamberInnerX = BASE_WIDTH - chamberInnerX;

    const gateHalf = gateWidth / 2;
    const leftGateStart = leftGateCenter - gateHalf;
    const leftGateEnd = leftGateCenter + gateHalf;
    const rightGateStart = rightGateCenter - gateHalf;
    const rightGateEnd = rightGateCenter + gateHalf;

    const bottomChamberTop = BASE_HEIGHT - chamberBottom;
    const bottomChamberBottom = BASE_HEIGHT - chamberTop;

    const walls = [];

    // Outer arena frame.
    walls.push(
        wall({
            id: 'border-top',
            x: BASE_WIDTH / 2,
            y: borderThickness / 2,
            w: BASE_WIDTH,
            h: borderThickness,
            styleVariant: 'arena-border'
        }),
        wall({
            id: 'border-bottom',
            x: BASE_WIDTH / 2,
            y: BASE_HEIGHT - borderThickness / 2,
            w: BASE_WIDTH,
            h: borderThickness,
            styleVariant: 'arena-border'
        }),
        wall({
            id: 'border-left',
            x: borderThickness / 2,
            y: BASE_HEIGHT / 2,
            w: borderThickness,
            h: BASE_HEIGHT,
            styleVariant: 'arena-border'
        }),
        wall({
            id: 'border-right',
            x: BASE_WIDTH - borderThickness / 2,
            y: BASE_HEIGHT / 2,
            w: borderThickness,
            h: BASE_HEIGHT,
            styleVariant: 'arena-border'
        })
    );

    const addHorizontalSplitWall = ({ idPrefix, y, outerX, innerX, openingStart, openingEnd }) => {
        const leftWidth = openingStart - outerX;
        const rightWidth = innerX - openingEnd;

        if (leftWidth > 0) {
            walls.push(wall({
                id: `${idPrefix}-left-shoulder`,
                x: outerX + leftWidth / 2,
                y,
                w: leftWidth,
                h: separatorThickness,
                styleVariant: 'team-separator'
            }));
        }

        if (rightWidth > 0) {
            walls.push(wall({
                id: `${idPrefix}-right-shoulder`,
                x: openingEnd + rightWidth / 2,
                y,
                w: rightWidth,
                h: separatorThickness,
                styleVariant: 'team-separator'
            }));
        }
    };

    // Team chamber inner side walls.
    const chamberHeight = chamberBottom - chamberTop;
    const chamberCenterYTop = chamberTop + chamberHeight / 2;
    const chamberCenterYBottom = bottomChamberTop + chamberHeight / 2;

    walls.push(
        wall({
            id: 'cyan-inner-side',
            x: chamberInnerX,
            y: chamberCenterYTop,
            w: separatorThickness,
            h: chamberHeight,
            styleVariant: 'team-separator'
        }),
        wall({
            id: 'red-inner-side',
            x: rightChamberInnerX,
            y: chamberCenterYTop,
            w: separatorThickness,
            h: chamberHeight,
            styleVariant: 'team-separator'
        }),
        wall({
            id: 'green-inner-side',
            x: chamberInnerX,
            y: chamberCenterYBottom,
            w: separatorThickness,
            h: chamberHeight,
            styleVariant: 'team-separator'
        }),
        wall({
            id: 'amber-inner-side',
            x: rightChamberInnerX,
            y: chamberCenterYBottom,
            w: separatorThickness,
            h: chamberHeight,
            styleVariant: 'team-separator'
        })
    );

    // Fill the narrow strip between the left/right inner-side walls. Without this,
    // the strip would become an accessible dead pocket where AI could get stuck.
    const centralDividerWidth = Math.max(
        0,
        rightChamberInnerX - chamberInnerX - separatorThickness
    );
    if (centralDividerWidth > 0) {
        walls.push(
            wall({
                id: 'top-central-divider',
                x: BASE_WIDTH / 2,
                y: chamberCenterYTop,
                w: centralDividerWidth,
                h: chamberHeight,
                styleVariant: 'team-separator'
            }),
            wall({
                id: 'bottom-central-divider',
                x: BASE_WIDTH / 2,
                y: chamberCenterYBottom,
                w: centralDividerWidth,
                h: chamberHeight,
                styleVariant: 'team-separator'
            })
        );
    }

    // Wide release openings. No opening can be configured below minimumGateWidth.
    addHorizontalSplitWall({
        idPrefix: 'cyan-release',
        y: chamberBottom,
        outerX: chamberOuterX,
        innerX: chamberInnerX,
        openingStart: leftGateStart,
        openingEnd: leftGateEnd
    });
    addHorizontalSplitWall({
        idPrefix: 'red-release',
        y: chamberBottom,
        outerX: rightChamberInnerX,
        innerX: rightChamberOuterX,
        openingStart: rightGateStart,
        openingEnd: rightGateEnd
    });
    addHorizontalSplitWall({
        idPrefix: 'green-release',
        y: bottomChamberTop,
        outerX: chamberOuterX,
        innerX: chamberInnerX,
        openingStart: leftGateStart,
        openingEnd: leftGateEnd
    });
    addHorizontalSplitWall({
        idPrefix: 'amber-release',
        y: bottomChamberTop,
        outerX: rightChamberInnerX,
        innerX: rightChamberOuterX,
        openingStart: rightGateStart,
        openingEnd: rightGateEnd
    });

    const addCorridor = ({ idPrefix, centerX, fromY, toY }) => {
        const corridorHeight = Math.abs(toY - fromY);
        const centerY = (fromY + toY) / 2;
        const leftX = centerX - gateHalf;
        const rightX = centerX + gateHalf;

        walls.push(
            wall({
                id: `${idPrefix}-corridor-left`,
                x: leftX,
                y: centerY,
                w: corridorWallThickness,
                h: corridorHeight,
                styleVariant: 'release-corridor'
            }),
            wall({
                id: `${idPrefix}-corridor-right`,
                x: rightX,
                y: centerY,
                w: corridorWallThickness,
                h: corridorHeight,
                styleVariant: 'release-corridor'
            })
        );
    };

    addCorridor({ idPrefix: 'cyan', centerX: leftGateCenter, fromY: chamberBottom, toY: corridorEndTop });
    addCorridor({ idPrefix: 'red', centerX: rightGateCenter, fromY: chamberBottom, toY: corridorEndTop });
    addCorridor({ idPrefix: 'green', centerX: leftGateCenter, fromY: corridorStartBottom, toY: bottomChamberTop });
    addCorridor({ idPrefix: 'amber', centerX: rightGateCenter, fromY: corridorStartBottom, toY: bottomChamberTop });

    // Static angled guide walls direct all four lanes into the moving middle without
    // narrowing any route below the release-gate clearance.
    walls.push(
        wall({
            id: 'northwest-guide',
            x: 360,
            y: 790,
            w: 210,
            h: 28,
            angle: 0.45,
            styleVariant: 'center-guide'
        }),
        wall({
            id: 'northeast-guide',
            x: 720,
            y: 790,
            w: 210,
            h: 28,
            angle: -0.45,
            styleVariant: 'center-guide'
        }),
        wall({
            id: 'southwest-guide',
            x: 360,
            y: 1130,
            w: 210,
            h: 28,
            angle: -0.45,
            styleVariant: 'center-guide'
        }),
        wall({
            id: 'southeast-guide',
            x: 720,
            y: 1130,
            w: 210,
            h: 28,
            angle: 0.45,
            styleVariant: 'center-guide'
        })
    );

    if (middle.enabled !== false) {
        const movingCollision = solidCollision({
            projectiles: middle.blockProjectiles !== false,
            vision: middle.blockVision !== false
        });

        const rotorWidth = clamp(finiteNumber(middle.rotorWidth, 430), 220, 620);
        const rotorHeight = clamp(finiteNumber(middle.rotorHeight, 32), 20, 60);
        const rotorAngularSpeed = clamp(finiteNumber(middle.rotorAngularSpeed, 0.012), -0.05, 0.05);

        walls.push(wall({
            id: 'middle-main-rotor',
            x: BASE_WIDTH / 2,
            y: BASE_HEIGHT / 2,
            w: rotorWidth,
            h: rotorHeight,
            angle: 0,
            styleVariant: 'moving-rotor',
            collision: movingCollision,
            motion: {
                type: 'rotation',
                angularSpeed: rotorAngularSpeed
            }
        }));

        const horizontalOffsetY = clamp(
            finiteNumber(middle.horizontalSliderOffsetY, 205),
            130,
            300
        );
        const horizontalAmplitude = clamp(
            finiteNumber(middle.horizontalSliderAmplitude, 270),
            80,
            340
        );
        const horizontalPeriod = clamp(
            Math.round(finiteNumber(middle.horizontalSliderPeriodFrames, 330)),
            120,
            900
        );

        walls.push(
            wall({
                id: 'middle-north-slider',
                x: BASE_WIDTH / 2,
                y: BASE_HEIGHT / 2 - horizontalOffsetY,
                w: clamp(finiteNumber(middle.horizontalSliderWidth, 250), 120, 380),
                h: clamp(finiteNumber(middle.horizontalSliderHeight, 32), 20, 60),
                styleVariant: 'moving-slider',
                collision: movingCollision,
                motion: {
                    type: 'oscillate',
                    axis: 'x',
                    amplitude: horizontalAmplitude,
                    periodFrames: horizontalPeriod,
                    phase: 0
                }
            }),
            wall({
                id: 'middle-south-slider',
                x: BASE_WIDTH / 2,
                y: BASE_HEIGHT / 2 + horizontalOffsetY,
                w: clamp(finiteNumber(middle.horizontalSliderWidth, 250), 120, 380),
                h: clamp(finiteNumber(middle.horizontalSliderHeight, 32), 20, 60),
                styleVariant: 'moving-slider',
                collision: movingCollision,
                motion: {
                    type: 'oscillate',
                    axis: 'x',
                    amplitude: horizontalAmplitude,
                    periodFrames: horizontalPeriod,
                    phase: 0.5
                }
            })
        );

        const verticalOffsetX = clamp(
            finiteNumber(middle.verticalSliderOffsetX, 285),
            190,
            360
        );
        const verticalAmplitude = clamp(
            finiteNumber(middle.verticalSliderAmplitude, 165),
            60,
            260
        );
        const verticalPeriod = clamp(
            Math.round(finiteNumber(middle.verticalSliderPeriodFrames, 290)),
            120,
            900
        );

        walls.push(
            wall({
                id: 'middle-west-slider',
                x: BASE_WIDTH / 2 - verticalOffsetX,
                y: BASE_HEIGHT / 2,
                w: clamp(finiteNumber(middle.verticalSliderWidth, 32), 20, 60),
                h: clamp(finiteNumber(middle.verticalSliderHeight, 190), 100, 300),
                styleVariant: 'moving-slider',
                collision: movingCollision,
                motion: {
                    type: 'oscillate',
                    axis: 'y',
                    amplitude: verticalAmplitude,
                    periodFrames: verticalPeriod,
                    phase: 0.25
                }
            }),
            wall({
                id: 'middle-east-slider',
                x: BASE_WIDTH / 2 + verticalOffsetX,
                y: BASE_HEIGHT / 2,
                w: clamp(finiteNumber(middle.verticalSliderWidth, 32), 20, 60),
                h: clamp(finiteNumber(middle.verticalSliderHeight, 190), 100, 300),
                styleVariant: 'moving-slider',
                collision: movingCollision,
                motion: {
                    type: 'oscillate',
                    axis: 'y',
                    amplitude: verticalAmplitude,
                    periodFrames: verticalPeriod,
                    phase: 0.75
                }
            })
        );

        const satelliteOffsetX = clamp(finiteNumber(middle.satelliteOffsetX, 185), 120, 270);
        const satelliteOffsetY = clamp(finiteNumber(middle.satelliteOffsetY, 115), 70, 190);
        const satelliteSpeed = clamp(finiteNumber(middle.satelliteAngularSpeed, 0.018), -0.06, 0.06);
        const satelliteWidth = clamp(finiteNumber(middle.satelliteWidth, 170), 90, 260);
        const satelliteHeight = clamp(finiteNumber(middle.satelliteHeight, 26), 18, 50);

        walls.push(
            wall({
                id: 'middle-satellite-nw',
                x: BASE_WIDTH / 2 - satelliteOffsetX,
                y: BASE_HEIGHT / 2 - satelliteOffsetY,
                w: satelliteWidth,
                h: satelliteHeight,
                angle: 0.35,
                styleVariant: 'moving-paddle',
                collision: movingCollision,
                motion: { type: 'rotation', angularSpeed: satelliteSpeed }
            }),
            wall({
                id: 'middle-satellite-se',
                x: BASE_WIDTH / 2 + satelliteOffsetX,
                y: BASE_HEIGHT / 2 + satelliteOffsetY,
                w: satelliteWidth,
                h: satelliteHeight,
                angle: 0.35,
                styleVariant: 'moving-paddle',
                collision: movingCollision,
                motion: { type: 'rotation', angularSpeed: satelliteSpeed }
            }),
            wall({
                id: 'middle-satellite-ne',
                x: BASE_WIDTH / 2 + satelliteOffsetX,
                y: BASE_HEIGHT / 2 - satelliteOffsetY,
                w: satelliteWidth,
                h: satelliteHeight,
                angle: -0.35,
                styleVariant: 'moving-paddle',
                collision: movingCollision,
                motion: { type: 'rotation', angularSpeed: -satelliteSpeed }
            }),
            wall({
                id: 'middle-satellite-sw',
                x: BASE_WIDTH / 2 - satelliteOffsetX,
                y: BASE_HEIGHT / 2 + satelliteOffsetY,
                w: satelliteWidth,
                h: satelliteHeight,
                angle: -0.35,
                styleVariant: 'moving-paddle',
                collision: movingCollision,
                motion: { type: 'rotation', angularSpeed: -satelliteSpeed }
            })
        );
    }

    const teamIds = config.teamIds
        .filter(id => typeof id === 'string' && id.trim())
        .slice(0, 4);
    while (teamIds.length < 4) {
        teamIds.push(DEFAULTS.teamIds[teamIds.length]);
    }

    const spawnColumns = clamp(Math.round(finiteNumber(layout.spawnColumns, 2)), 1, 4);
    const spawnSpacingX = clamp(finiteNumber(layout.spawnSpacingX, 92), 55, 130);
    const spawnSpacingY = clamp(finiteNumber(layout.spawnSpacingY, 92), 55, 130);
    const spawnYTop = clamp(finiteNumber(layout.spawnYTop, 270), chamberTop + 80, chamberBottom - 110);
    const spawnYBottom = clamp(
        finiteNumber(layout.spawnYBottom, 1650),
        bottomChamberTop + 110,
        bottomChamberBottom - 80
    );

    const formation = (x, y) => ({
        shape: 'formation',
        x: scaleX(x),
        y: scaleY(y),
        columns: spawnColumns,
        spacingX: scaleX(spawnSpacingX),
        spacingY: scaleY(spawnSpacingY)
    });

    const spawnZones = {
        [teamIds[0]]: formation(leftGateCenter, spawnYTop),
        [teamIds[1]]: formation(rightGateCenter, spawnYTop),
        [teamIds[2]]: formation(leftGateCenter, spawnYBottom),
        [teamIds[3]]: formation(rightGateCenter, spawnYBottom)
    };

    const zoneConfig = config.zone;
    const firstStageFrame = clamp(
        Math.round(finiteNumber(zoneConfig.firstStageFrame, 2520)),
        300,
        10000
    );

    // The layout is intentionally symmetric; seeded randomness is available for
    // future map variants but is not consumed by this deterministic base layout.
    void random;

    return {
        id: MAP_ID,
        name: 'Team Mixer',
        match: {
            maxFrames: clamp(
                Math.round(finiteNumber(config.match.maxFrames, DEFAULTS.match.maxFrames)),
                600,
                18000
            ),
            timeoutWinnerRule: config.match.timeoutWinnerRule === 'power-only'
                ? 'power-only'
                : 'alive-then-power'
        },
        spawnZones,
        walls,
        zone: {
            initialHalfWidth: scaleX((BASE_WIDTH - borderThickness * 2) / 2),
            initialHalfHeight: scaleY((BASE_HEIGHT - borderThickness * 2) / 2),
            stages: [{
                id: 'central-convergence',
                atFrame: firstStageFrame,
                targetHalfWidth: scaleX(clamp(
                    finiteNumber(zoneConfig.targetHalfWidth, 355),
                    220,
                    500
                )),
                targetHalfHeight: scaleY(clamp(
                    finiteNumber(zoneConfig.targetHalfHeight, 500),
                    300,
                    820
                )),
                mode: 'linear',
                shrinkSpeed: clamp(
                    finiteNumber(zoneConfig.shrinkSpeed, 1.35),
                    0.1,
                    8
                ),
                rewardPowerups: true,
                damageActive: true
            }],
            damage: {
                intervalFrames: clamp(
                    Math.round(finiteNumber(zoneConfig.damageIntervalFrames, 15)),
                    1,
                    240
                ),
                percent: clamp(finiteNumber(zoneConfig.damagePercent, 0.2), 0, 100),
                base: clamp(finiteNumber(zoneConfig.damageBase, 3), 0, 10000)
            }
        },
        stageRewardSpawns: []
    };
}
