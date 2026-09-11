import {
    FALLBACK_POWERUP,
    FALLBACK_TEAM,
    FONT_STACK,
    POWERUP_VISUALS,
    TEAM_VISUALS
} from './palette.js';
import {
    alphaColor,
    clamp,
    deterministicUnit,
    drawPanelLine,
    drawPowerupIcon,
    formatHealth,
    roundedRectPath,
    stableHash
} from './canvas-utils.js';
import { createFlyingCitadelParticles } from './effects.js';

function drawStarfield(ctx, game) {
    const width = game.width;
    const height = game.height;
    const time = (game.frameCount || 0) * 0.012;
    ctx.save();
    for (let index = 0; index < 84; index += 1) {
        const x = deterministicUnit(index, 2.7) * width;
        const y = deterministicUnit(index, 8.1) * height * 0.32;
        const radius = 0.45 + deterministicUnit(index, 14.2) * 1.45;
        const twinkle = 0.34 + 0.34 * (0.5 + Math.sin(time + index * 1.71) * 0.5);
        const tint = index % 9 === 0 ? '#79e9ff' : (index % 13 === 0 ? '#ffd298' : '#f2f7ff');
        ctx.fillStyle = alphaColor(tint, twinkle);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawMoonAndCitadel(ctx, game) {
    const width = game.width;
    const height = game.height;
    const moonX = width * 0.79;
    const moonY = height * 0.12;
    const moonRadius = Math.min(width * 0.115, height * 0.075);

    ctx.save();
    const glow = ctx.createRadialGradient(moonX, moonY, moonRadius * 0.25, moonX, moonY, moonRadius * 2.5);
    glow.addColorStop(0, 'rgba(229, 247, 255, 0.34)');
    glow.addColorStop(0.35, 'rgba(112, 185, 220, 0.12)');
    glow.addColorStop(1, 'rgba(40, 76, 106, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    const moon = ctx.createRadialGradient(moonX - moonRadius * 0.28, moonY - moonRadius * 0.34, moonRadius * 0.08, moonX, moonY, moonRadius);
    moon.addColorStop(0, '#ffffff');
    moon.addColorStop(0.58, '#d9e6ea');
    moon.addColorStop(1, '#91aebc');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
    ctx.fill();
    for (let index = 0; index < 8; index += 1) {
        const angle = deterministicUnit(index, 31) * Math.PI * 2;
        const distance = moonRadius * deterministicUnit(index, 33) * 0.58;
        const craterRadius = moonRadius * (0.05 + deterministicUnit(index, 35) * 0.09);
        ctx.fillStyle = `rgba(74, 103, 116, ${0.08 + deterministicUnit(index, 37) * 0.08})`;
        ctx.beginPath();
        ctx.arc(moonX + Math.cos(angle) * distance, moonY + Math.sin(angle) * distance, craterRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    const horizon = height * 0.245;
    const silhouette = '#0a1621';
    ctx.fillStyle = silhouette;
    ctx.beginPath();
    ctx.moveTo(0, horizon + height * 0.014);
    for (let index = 0; index <= 12; index += 1) {
        const x = width * index / 12;
        const y = horizon - deterministicUnit(index, 41) * height * 0.028;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizon + height * 0.05);
    ctx.lineTo(0, horizon + height * 0.05);
    ctx.closePath();
    ctx.fill();

    const baseY = horizon + height * 0.024;
    const towers = [
        { x: width * 0.18, w: width * 0.11, h: height * 0.065 },
        { x: width * 0.30, w: width * 0.15, h: height * 0.10 },
        { x: width * 0.49, w: width * 0.12, h: height * 0.078 },
        { x: width * 0.62, w: width * 0.18, h: height * 0.12 },
        { x: width * 0.82, w: width * 0.12, h: height * 0.085 }
    ];
    for (const [index, tower] of towers.entries()) {
        const x = tower.x - tower.w / 2;
        const y = baseY - tower.h;
        const gradient = ctx.createLinearGradient(x, y, x + tower.w, baseY);
        gradient.addColorStop(0, '#213541');
        gradient.addColorStop(0.45, '#142631');
        gradient.addColorStop(1, '#09141d');
        ctx.fillStyle = gradient;
        roundedRectPath(ctx, x, y, tower.w, tower.h, Math.min(12, tower.w * 0.12));
        ctx.fill();
        ctx.fillStyle = '#273d48';
        ctx.beginPath();
        ctx.arc(tower.x, y + 2, tower.w * 0.46, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = index % 2 === 0 ? 'rgba(255, 132, 64, 0.74)' : 'rgba(255, 92, 68, 0.66)';
        for (let lamp = 0; lamp < 3; lamp += 1) {
            const lampX = x + tower.w * (0.24 + lamp * 0.25);
            const lampY = y + tower.h * (0.42 + (lamp % 2) * 0.18);
            ctx.fillRect(lampX, lampY, Math.max(2, tower.w * 0.022), Math.max(2, tower.w * 0.022));
        }
    }
    ctx.restore();
}

function drawArenaFloor(ctx, game) {
    const width = game.width;
    const height = game.height;
    const floorTop = height * 0.22;
    const floor = ctx.createLinearGradient(0, floorTop, 0, height);
    floor.addColorStop(0, '#182630');
    floor.addColorStop(0.42, '#121c25');
    floor.addColorStop(1, '#080e14');
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorTop, width, height - floorTop);

    ctx.save();
    ctx.strokeStyle = 'rgba(155, 190, 205, 0.055)';
    ctx.lineWidth = 1;
    const horizontalSpacing = Math.max(78, height * 0.057);
    for (let y = floorTop; y < height; y += horizontalSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    const vanishingX = width * 0.5;
    for (let index = -8; index <= 8; index += 1) {
        ctx.beginPath();
        ctx.moveTo(vanishingX + index * width * 0.022, floorTop);
        ctx.lineTo(vanishingX + index * width * 0.115, height);
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(37, 211, 229, 0.035)';
    ctx.lineWidth = 2;
    for (let index = 0; index < 9; index += 1) {
        const y = floorTop + deterministicUnit(index, 52) * (height - floorTop);
        const x = deterministicUnit(index, 54) * width;
        const length = width * (0.04 + deterministicUnit(index, 56) * 0.09);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(Math.min(width, x + length), y);
        ctx.stroke();
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.5, width * 0.18, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.68, 'rgba(0, 0, 0, 0.10)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.52)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
}

function drawHealthChip(ctx, bot, visual, radius) {
    const display = formatHealth(bot.power);
    const hash = stableHash(bot.id);
    const side = hash % 2 === 0 ? -1 : 1;
    const offsetX = side * Math.min(10, radius * 0.32);
    const chipWidth = clamp(56 + display.length * 8.5, 78, 118);
    const chipHeight = 32;
    const chipX = offsetX - chipWidth / 2;
    const chipY = -radius - chipHeight - 13;

    ctx.save();
    ctx.translate(bot.x, bot.y);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    roundedRectPath(ctx, chipX, chipY, chipWidth, chipHeight, 6);
    ctx.fillStyle = 'rgba(4, 12, 18, 0.90)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = alphaColor(visual.main, 0.86);
    ctx.lineWidth = 1.7;
    ctx.stroke();

    ctx.fillStyle = visual.main;
    ctx.beginPath();
    ctx.moveTo(offsetX - 4, chipY + chipHeight);
    ctx.lineTo(offsetX + 4, chipY + chipHeight);
    ctx.lineTo(offsetX, chipY + chipHeight + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = alphaColor(visual.light, 0.78);
    ctx.font = `700 8px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP', chipX + 6, chipY + chipHeight * 0.43);

    ctx.fillStyle = '#ffffff';
    ctx.font = `750 ${display.length > 7 ? 13 : 16}px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(display, chipX + chipWidth - 7, chipY + chipHeight * 0.43);

    const barX = chipX + 6;
    const barY = chipY + chipHeight - 6;
    const barWidth = chipWidth - 12;
    const segments = 7;
    const gap = 2;
    const segmentWidth = (barWidth - gap * (segments - 1)) / segments;
    const magnitude = Math.log10(Math.max(1, bot.power));
    const fillLevel = clamp(1 + Math.floor((magnitude % 1) * 6), 1, segments);
    for (let index = 0; index < segments; index += 1) {
        roundedRectPath(ctx, barX + index * (segmentWidth + gap), barY, segmentWidth, 2.5, 1.25);
        ctx.fillStyle = index < fillLevel ? visual.main : 'rgba(255,255,255,0.12)';
        ctx.fill();
    }
    ctx.restore();
}

function drawBotPowerupRings(ctx, bot, style, radius, game) {
    const effects = bot.activePowerups.slice(0, 2);
    effects.forEach((effect, index) => {
        const color = style.getPowerupVisual(effect.id).color;
        const ringRadius = radius + 8 + index * 8;
        const direction = index === 0 ? 1 : -1;
        const rotation = (game?.frameCount || 0) * 0.035 * direction + index * 0.8;
        ctx.save();
        ctx.translate(bot.x, bot.y);
        ctx.rotate(rotation);
        ctx.strokeStyle = alphaColor(color, index === 0 ? 0.82 : 0.62);
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.lineWidth = index === 0 ? 2.3 : 1.8;
        ctx.setLineDash(index === 0 ? [8, 9] : [3, 10]);
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    });
}

export function createStyle({ options = {} } = {}) {
    const showPowerupLabels = options.showPowerupLabels !== false;
    const showMatchClock = options.showMatchClock !== false;
    const showHealthChips = options.showHealthChips !== false;

    return {
        id: 'flying-citadel',

        getGeometry(kind, entity) {
            if (kind === 'bot') {
                const healthScale = Math.log2(Math.max(1, entity.power) + 1);
                return { shape: 'circle', radius: 22.5 + Math.min(7.5, healthScale * 1.25) };
            }
            if (kind === 'food') return { shape: 'circle', radius: 6.5 };
            if (kind === 'powerup') return { shape: 'circle', radius: 29 };
            if (kind === 'wall') return { shape: 'rect', width: entity.w, height: entity.h, rotation: entity.angle || 0 };
            if (kind === 'projectile') {
                const focused = entity.visualVariant === 'focused';
                const overcharged = entity.visualVariant === 'overcharged';
                return {
                    shape: 'rect',
                    width: overcharged ? 42 : (focused ? 34 : 28),
                    height: overcharged ? 13 : (focused ? 8 : 7),
                    rotation: entity.angle || 0
                };
            }
            return { shape: 'circle', radius: 1 };
        },

        createEffectParticles(effectName, data, game) {
            return createFlyingCitadelParticles(effectName, data, game);
        },

        getTeamVisual(teamId) {
            return TEAM_VISUALS[teamId] || FALLBACK_TEAM;
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || FALLBACK_POWERUP;
        },

        styleTeamElement(element, teamId) {
            const visual = this.getTeamVisual(teamId);
            element.style.setProperty('--team-color', visual.main);
            element.style.setProperty('--team-light', visual.light);
            element.style.setProperty('--team-border', visual.border);
            element.style.setProperty('--team-dark', visual.dark);
            element.style.setProperty('--team-mid', visual.mid);
        },

        applyDocument() {
            document.documentElement.dataset.kineticStyle = 'flying-citadel';
        },

        formatStageText() {
            return '';
        },

        formatWinnerText(team) {
            return team ? `${team.label.toUpperCase()} DOMINATES` : 'STALEMATE';
        },

        drawBackground(ctx, game) {
            const sky = ctx.createLinearGradient(0, 0, 0, game.height);
            sky.addColorStop(0, '#06131d');
            sky.addColorStop(0.21, '#0a1d2b');
            sky.addColorStop(0.44, '#12202a');
            sky.addColorStop(1, '#080e14');
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, game.width, game.height);
            drawStarfield(ctx, game);
            drawMoonAndCitadel(ctx, game);
            drawArenaFloor(ctx, game);
        },

        drawZone(ctx, arena, game) {
    const bounds = arena.getBounds();
    const danger = arena.damageActive;
    const edgeColor = danger ? '#ff4f68' : '#48e4ed';
    const edgeLight = danger ? '#ff9aa8' : '#c5fbff';
    const edgeDark = danger ? '#6f0b20' : '#063c47';

    const inset = Math.max(
        5,
        Math.min(11, Math.min(bounds.width, bounds.height) * 0.008)
    );

    const cornerLength = Math.max(
        22,
        Math.min(54, Math.min(bounds.width, bounds.height) * 0.055)
    );

    ctx.save();

    // Dim only the area outside the active arena.
    ctx.beginPath();
    ctx.rect(0, 0, game.width, game.height);
    ctx.rect(bounds.left, bounds.top, bounds.width, bounds.height);
    ctx.fillStyle = danger
        ? 'rgba(75, 0, 14, 0.34)'
        : 'rgba(0, 6, 11, 0.30)';
    ctx.fill('evenodd');

    // Wide atmospheric boundary glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alphaColor(edgeColor, danger ? 0.20 : 0.13);
    ctx.lineWidth = danger ? 18 : 12;
    ctx.shadowColor = edgeColor;
    ctx.shadowBlur = danger ? 26 : 18;
    ctx.strokeRect(
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height
    );
    ctx.restore();

    // Dark structural rail beneath the luminous boundary.
    ctx.strokeStyle = danger
        ? 'rgba(44, 3, 11, 0.96)'
        : 'rgba(2, 19, 25, 0.96)';
    ctx.lineWidth = danger ? 8 : 6;
    ctx.strokeRect(
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height
    );

    // Primary containment line.
    ctx.strokeStyle = alphaColor(
        edgeColor,
        danger ? 0.94 : 0.78
    );
    ctx.lineWidth = danger ? 4.2 : 3;
    ctx.shadowColor = edgeColor;
    ctx.shadowBlur = danger ? 14 : 8;
    ctx.strokeRect(
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height
    );
    ctx.shadowBlur = 0;

    // Secondary inner containment rail.
    ctx.strokeStyle = alphaColor(
        edgeLight,
        danger ? 0.34 : 0.24
    );
    ctx.lineWidth = 1.1;
    ctx.strokeRect(
        bounds.left + inset,
        bounds.top + inset,
        Math.max(0, bounds.width - inset * 2),
        Math.max(0, bounds.height - inset * 2)
    );

    // Symmetric engineered corner locks.
    const corners = [
        [bounds.left, bounds.top, 1, 1],
        [bounds.left + bounds.width, bounds.top, -1, 1],
        [
            bounds.left + bounds.width,
            bounds.top + bounds.height,
            -1,
            -1
        ],
        [bounds.left, bounds.top + bounds.height, 1, -1]
    ];

    ctx.lineCap = 'square';

    for (const [x, y, sx, sy] of corners) {
        ctx.save();
        ctx.translate(x, y);

        ctx.strokeStyle = alphaColor(edgeLight, 0.82);
        ctx.lineWidth = danger ? 4 : 3;
        ctx.shadowColor = edgeColor;
        ctx.shadowBlur = danger ? 12 : 7;

        ctx.beginPath();
        ctx.moveTo(sx * inset, sy * cornerLength);
        ctx.lineTo(sx * inset, sy * inset);
        ctx.lineTo(sx * cornerLength, sy * inset);
        ctx.stroke();

        ctx.shadowBlur = 0;

        ctx.fillStyle = alphaColor(
            edgeColor,
            danger ? 0.92 : 0.72
        );
        ctx.strokeStyle = alphaColor(edgeDark, 0.92);
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.arc(
            sx * inset,
            sy * inset,
            danger ? 4.2 : 3.4,
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    // Damage mode warning segments.
    if (danger) {
        const segmentLength = Math.max(
            24,
            Math.min(68, bounds.width * 0.075)
        );

        const gap = segmentLength * 0.82;

        ctx.save();
        ctx.strokeStyle = alphaColor(edgeLight, 0.60);
        ctx.lineWidth = 2;
        ctx.setLineDash([segmentLength, gap]);
        ctx.lineDashOffset = segmentLength * 0.24;

        ctx.beginPath();

        ctx.moveTo(
            bounds.left + cornerLength,
            bounds.top + inset * 0.45
        );
        ctx.lineTo(
            bounds.left + bounds.width - cornerLength,
            bounds.top + inset * 0.45
        );

        ctx.moveTo(
            bounds.left + cornerLength,
            bounds.top + bounds.height - inset * 0.45
        );
        ctx.lineTo(
            bounds.left + bounds.width - cornerLength,
            bounds.top + bounds.height - inset * 0.45
        );

        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    ctx.restore();
},

drawWall(ctx, wall) {
    const moving = Boolean(wall.motion);
    const passThrough =
        wall.collision?.projectiles === false;

    const accent = moving
        ? '#ffbd59'
        : passThrough
            ? '#45e2ed'
            : '#7893a1';

    const accentLight = moving
        ? '#ffe0a3'
        : passThrough
            ? '#c8fbff'
            : '#d7e5eb';

    const halfW = wall.w / 2;
    const halfH = wall.h / 2;

    const radius = Math.min(
        13,
        Math.max(4, wall.h * 0.24)
    );

    const rim = Math.max(
        3,
        Math.min(8, wall.h * 0.11)
    );

    const panelCount = Math.max(
        1,
        Math.floor(wall.w / 88)
    );

    ctx.save();
    ctx.translate(wall.x, wall.y);
    ctx.rotate(wall.angle || 0);

    // Grounded 3D shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.76)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';

    roundedRectPath(
        ctx,
        -halfW,
        -halfH,
        wall.w,
        wall.h,
        radius
    );

    ctx.fill();
    ctx.restore();

    // Main armored body.
    const body = ctx.createLinearGradient(
        -halfW,
        -halfH,
        halfW,
        halfH
    );

    if (moving) {
        body.addColorStop(0, '#52452f');
        body.addColorStop(0.22, '#343127');
        body.addColorStop(0.52, '#232620');
        body.addColorStop(0.82, '#171c1c');
        body.addColorStop(1, '#0a1012');
    } else {
        body.addColorStop(0, '#50626c');
        body.addColorStop(0.20, '#344650');
        body.addColorStop(0.52, '#202f38');
        body.addColorStop(0.82, '#131e25');
        body.addColorStop(1, '#080e12');
    }

    roundedRectPath(
        ctx,
        -halfW,
        -halfH,
        wall.w,
        wall.h,
        radius
    );

    ctx.fillStyle = body;
    ctx.fill();

    ctx.strokeStyle = alphaColor(
        accent,
        moving ? 0.88 : 0.56
    );
    ctx.lineWidth = moving ? 2.8 : 2.1;
    ctx.stroke();

    // Clip surface machining to the wall.
    ctx.save();

    roundedRectPath(
        ctx,
        -halfW,
        -halfH,
        wall.w,
        wall.h,
        radius
    );

    ctx.clip();

    // Metallic upper bevel.
    const topBevel = ctx.createLinearGradient(
        0,
        -halfH,
        0,
        -halfH + rim * 2.4
    );

    topBevel.addColorStop(
        0,
        'rgba(235, 248, 252, 0.34)'
    );
    topBevel.addColorStop(
        0.32,
        'rgba(192, 219, 228, 0.12)'
    );
    topBevel.addColorStop(
        1,
        'rgba(192, 219, 228, 0)'
    );

    ctx.fillStyle = topBevel;
    ctx.fillRect(
        -halfW,
        -halfH,
        wall.w,
        rim * 2.4
    );

    // Lower depth face.
    const lowerDepth = ctx.createLinearGradient(
        0,
        halfH - rim * 2.2,
        0,
        halfH
    );

    lowerDepth.addColorStop(
        0,
        'rgba(0, 0, 0, 0)'
    );
    lowerDepth.addColorStop(
        1,
        'rgba(0, 0, 0, 0.56)'
    );

    ctx.fillStyle = lowerDepth;
    ctx.fillRect(
        -halfW,
        halfH - rim * 2.2,
        wall.w,
        rim * 2.2
    );

    // Symmetric central recessed spine.
    const spineHeight = Math.max(
        3,
        Math.min(8, wall.h * 0.14)
    );

    const spine = ctx.createLinearGradient(
        0,
        -spineHeight / 2,
        0,
        spineHeight / 2
    );

    spine.addColorStop(
        0,
        'rgba(235, 247, 251, 0.12)'
    );
    spine.addColorStop(
        0.46,
        'rgba(6, 13, 17, 0.66)'
    );
    spine.addColorStop(
        1,
        'rgba(0, 0, 0, 0.36)'
    );

    ctx.fillStyle = spine;
    ctx.fillRect(
        -halfW,
        -spineHeight / 2,
        wall.w,
        spineHeight
    );

    // Repeating armor panels.
    ctx.strokeStyle = 'rgba(221, 239, 246, 0.14)';
    ctx.lineWidth = 1;

    for (
        let index = 1;
        index < panelCount;
        index += 1
    ) {
        const x =
            -halfW +
            wall.w * index / panelCount;

        drawPanelLine(
            ctx,
            x,
            -halfH * 0.66,
            x,
            halfH * 0.66,
            0.14
        );
    }

    // Fine inset rails.
    ctx.strokeStyle = alphaColor(
        accentLight,
        moving ? 0.16 : 0.10
    );
    ctx.lineWidth = 1;

    ctx.beginPath();

    ctx.moveTo(
        -halfW + radius + 8,
        -halfH + rim * 1.55
    );
    ctx.lineTo(
        halfW - radius - 8,
        -halfH + rim * 1.55
    );

    ctx.moveTo(
        -halfW + radius + 8,
        halfH - rim * 1.55
    );
    ctx.lineTo(
        halfW - radius - 8,
        halfH - rim * 1.55
    );

    ctx.stroke();
    ctx.restore();

    // Embedded state nodes.
    const nodeCount = Math.max(
        2,
        Math.min(10, Math.round(wall.w / 58))
    );

    for (let i = 0; i < nodeCount; i += 1) {
        const x = nodeCount === 1
            ? 0
            : (
                -halfW +
                radius +
                12 +
                i *
                (
                    wall.w -
                    (radius + 12) * 2
                ) /
                (nodeCount - 1)
            );

        const nodeGlow = moving
            ? 0.82
            : passThrough
                ? 0.72
                : 0.30;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = alphaColor(
            accent,
            nodeGlow
        );
        ctx.shadowColor = accent;
        ctx.shadowBlur = moving ? 9 : 5;

        ctx.beginPath();
        ctx.arc(
            x,
            -halfH + Math.max(7, rim * 0.82),
            moving ? 2.6 : 2.1,
            0,
            Math.PI * 2
        );
        ctx.fill();

        ctx.restore();
    }

    // Mirrored actuator marks for moving walls.
    if (moving) {
        const actuatorCount = Math.max(
            1,
            Math.floor(wall.w / 105)
        );

        ctx.strokeStyle = alphaColor(
            accentLight,
            0.66
        );
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';

        for (
            let i = 0;
            i < actuatorCount;
            i += 1
        ) {
            const x =
                -halfW +
                (i + 0.5) *
                wall.w /
                actuatorCount;

            const size = Math.min(
                9,
                halfH * 0.34
            );

            ctx.beginPath();

            ctx.moveTo(
                x - size,
                -size * 0.55
            );
            ctx.lineTo(x, 0);
            ctx.lineTo(
                x - size,
                size * 0.55
            );

            ctx.moveTo(
                x + size,
                -size * 0.55
            );
            ctx.lineTo(x, 0);
            ctx.lineTo(
                x + size,
                size * 0.55
            );

            ctx.stroke();
        }
    }

    // Energy membrane for projectile-passable walls.
    if (passThrough) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = alphaColor(
            accent,
            0.48
        );
        ctx.lineWidth = 1.5;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 8;

        roundedRectPath(
            ctx,
            -halfW + rim,
            -halfH + rim,
            Math.max(0, wall.w - rim * 2),
            Math.max(0, wall.h - rim * 2),
            Math.max(
                2,
                radius - rim * 0.55
            )
        );

        ctx.stroke();
        ctx.restore();
    }

    ctx.restore();
},

drawFood(ctx, food) {
    const radius = food.radius;

    const phase =
        food.x * 0.017 +
        food.y * 0.013;

    const pulse =
        1 +
        Math.sin(phase) * 0.045;

    const rotation = phase * 0.55;

    ctx.save();
    ctx.translate(food.x, food.y);
    ctx.scale(pulse, pulse);

    // Soft circular pickup halo.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const halo = ctx.createRadialGradient(
        0,
        0,
        radius * 0.12,
        0,
        0,
        radius * 2.15
    );

    halo.addColorStop(
        0,
        'rgba(221, 255, 239, 0.46)'
    );
    halo.addColorStop(
        0.28,
        'rgba(89, 238, 165, 0.30)'
    );
    halo.addColorStop(
        0.66,
        'rgba(29, 181, 113, 0.12)'
    );
    halo.addColorStop(
        1,
        'rgba(29, 181, 113, 0)'
    );

    ctx.fillStyle = halo;

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 2.15,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.restore();

    // Outer containment shell.
    const shell = ctx.createRadialGradient(
        -radius * 0.26,
        -radius * 0.30,
        radius * 0.05,
        0,
        0,
        radius * 1.04
    );

    shell.addColorStop(0, '#d9fff0');
    shell.addColorStop(0.16, '#58dca0');
    shell.addColorStop(0.46, '#163f31');
    shell.addColorStop(0.74, '#0a211a');
    shell.addColorStop(1, '#030a08');

    ctx.fillStyle = shell;
    ctx.strokeStyle =
        'rgba(203, 255, 231, 0.78)';
    ctx.lineWidth = Math.max(
        1,
        radius * 0.11
    );

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.92,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Four-way radial energy braces.
    ctx.save();
    ctx.rotate(rotation);
    ctx.strokeStyle =
        'rgba(128, 255, 195, 0.52)';
    ctx.lineWidth = Math.max(
        1,
        radius * 0.09
    );
    ctx.lineCap = 'round';

    for (let i = 0; i < 4; i += 1) {
        const a = i * Math.PI / 2;
        const c = Math.cos(a);
        const s = Math.sin(a);

        ctx.beginPath();
        ctx.moveTo(
            c * radius * 0.50,
            s * radius * 0.50
        );
        ctx.lineTo(
            c * radius * 0.72,
            s * radius * 0.72
        );
        ctx.stroke();
    }

    ctx.restore();

    // Bright nutrient core.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const core = ctx.createRadialGradient(
        -radius * 0.13,
        -radius * 0.16,
        0,
        0,
        0,
        radius * 0.60
    );

    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.18, '#d9ffeb');
    core.addColorStop(0.48, '#62f1ad');
    core.addColorStop(0.78, '#1cad70');
    core.addColorStop(
        1,
        'rgba(17, 142, 86, 0.16)'
    );

    ctx.fillStyle = core;
    ctx.shadowColor = '#5cf0ab';
    ctx.shadowBlur = radius * 0.90;

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.48,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.restore();

    // Central mechanical aperture.
    ctx.fillStyle =
        'rgba(4, 24, 16, 0.74)';
    ctx.strokeStyle =
        'rgba(224, 255, 239, 0.72)';
    ctx.lineWidth = Math.max(
        0.8,
        radius * 0.07
    );

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.16,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.restore();
},

drawPowerup(ctx, powerup) {
    const visual =
        this.getPowerupVisual(powerup.type);

    const radius =
        this.getGeometry(
            'powerup',
            powerup
        ).radius;

    const rotation =
        Number.isFinite(powerup.rotation)
            ? powerup.rotation
            : 0;

    const pulse =
        1 +
        Math.sin(rotation * 3.2) * 0.035;

    ctx.save();
    ctx.translate(powerup.x, powerup.y);
    ctx.scale(pulse, pulse);

    // Circular shadow with no directional pedestal.
    const shadow = ctx.createRadialGradient(
        radius * 0.08,
        radius * 0.36,
        radius * 0.05,
        radius * 0.08,
        radius * 0.36,
        radius * 1.15
    );

    shadow.addColorStop(
        0,
        'rgba(0, 0, 0, 0.45)'
    );
    shadow.addColorStop(
        0.58,
        'rgba(0, 0, 0, 0.20)'
    );
    shadow.addColorStop(
        1,
        'rgba(0, 0, 0, 0)'
    );

    ctx.fillStyle = shadow;

    ctx.beginPath();
    ctx.ellipse(
        0,
        radius * 0.30,
        radius * 1.12,
        radius * 0.58,
        0,
        0,
        Math.PI * 2
    );
    ctx.fill();

    // Large atmospheric halo.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const halo = ctx.createRadialGradient(
        0,
        0,
        radius * 0.18,
        0,
        0,
        radius * 1.95
    );

    halo.addColorStop(
        0,
        alphaColor(visual.light, 0.18)
    );
    halo.addColorStop(
        0.30,
        alphaColor(visual.color, 0.26)
    );
    halo.addColorStop(
        0.62,
        alphaColor(visual.color, 0.10)
    );
    halo.addColorStop(
        1,
        alphaColor(visual.color, 0)
    );

    ctx.fillStyle = halo;

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 1.95,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.restore();

    // Outer armored shell.
    const outerShell = ctx.createRadialGradient(
        -radius * 0.32,
        -radius * 0.38,
        radius * 0.04,
        0,
        0,
        radius * 1.02
    );

    outerShell.addColorStop(0, '#61747e');
    outerShell.addColorStop(0.20, '#354750');
    outerShell.addColorStop(0.48, '#1c2b33');
    outerShell.addColorStop(0.78, '#0c171d');
    outerShell.addColorStop(1, '#03080b');

    ctx.fillStyle = outerShell;
    ctx.strokeStyle = alphaColor(
        visual.light,
        0.66
    );
    ctx.lineWidth = Math.max(
        1.5,
        radius * 0.075
    );
    ctx.shadowColor = alphaColor(
        visual.color,
        0.40
    );
    ctx.shadowBlur = radius * 0.30;

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.96,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Eight identical radial armor sectors.
    ctx.save();
    ctx.rotate(rotation * 0.40);

    for (let i = 0; i < 8; i += 1) {
        const a = i * Math.PI / 4;
        const inner = radius * 0.68;
        const outer = radius * 0.89;
        const halfArc =
            Math.PI / 8 - 0.065;

        const sector =
            ctx.createLinearGradient(
                Math.cos(a) * inner,
                Math.sin(a) * inner,
                Math.cos(a) * outer,
                Math.sin(a) * outer
            );

        sector.addColorStop(
            0,
            '#14232a'
        );
        sector.addColorStop(
            0.48,
            alphaColor(
                visual.color,
                0.36
            )
        );
        sector.addColorStop(
            1,
            '#071116'
        );

        ctx.fillStyle = sector;
        ctx.strokeStyle = alphaColor(
            visual.light,
            0.18
        );
        ctx.lineWidth = Math.max(
            0.7,
            radius * 0.026
        );

        ctx.beginPath();
        ctx.arc(
            0,
            0,
            outer,
            a - halfArc,
            a + halfArc
        );
        ctx.lineTo(
            Math.cos(a + halfArc) * inner,
            Math.sin(a + halfArc) * inner
        );
        ctx.arc(
            0,
            0,
            inner,
            a + halfArc,
            a - halfArc,
            true
        );
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();

    // Recessed inner housing.
    const innerHousing =
        ctx.createRadialGradient(
            -radius * 0.18,
            -radius * 0.22,
            radius * 0.03,
            0,
            0,
            radius * 0.68
        );

    innerHousing.addColorStop(
        0,
        '#41545e'
    );
    innerHousing.addColorStop(
        0.28,
        '#1c2d35'
    );
    innerHousing.addColorStop(
        0.68,
        '#09151b'
    );
    innerHousing.addColorStop(
        1,
        '#020609'
    );

    ctx.fillStyle = innerHousing;
    ctx.strokeStyle = alphaColor(
        visual.color,
        0.76
    );
    ctx.lineWidth = Math.max(
        1.2,
        radius * 0.065
    );

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.64,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Counter-rotating containment arcs.
    ctx.save();
    ctx.rotate(-rotation * 0.72);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alphaColor(
        visual.color,
        0.68
    );
    ctx.lineWidth = Math.max(
        1.5,
        radius * 0.072
    );
    ctx.lineCap = 'round';
    ctx.shadowColor = visual.color;
    ctx.shadowBlur = radius * 0.22;

    for (let i = 0; i < 4; i += 1) {
        const start =
            i * Math.PI / 2 + 0.14;

        ctx.beginPath();
        ctx.arc(
            0,
            0,
            radius * 0.52,
            start,
            start + Math.PI * 0.31
        );
        ctx.stroke();
    }

    ctx.restore();

    // Central icon chamber.
    const chamber =
        ctx.createRadialGradient(
            -radius * 0.11,
            -radius * 0.13,
            0,
            0,
            0,
            radius * 0.46
        );

    chamber.addColorStop(
        0,
        alphaColor(visual.light, 0.26)
    );
    chamber.addColorStop(
        0.30,
        alphaColor(visual.color, 0.16)
    );
    chamber.addColorStop(
        0.74,
        '#061116'
    );
    chamber.addColorStop(
        1,
        '#010406'
    );

    ctx.fillStyle = chamber;
    ctx.strokeStyle = alphaColor(
        visual.light,
        0.56
    );
    ctx.lineWidth = Math.max(
        1,
        radius * 0.045
    );

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius * 0.42,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = visual.color;
    ctx.shadowBlur = radius * 0.30;

    drawPowerupIcon(
        ctx,
        powerup.type,
        0,
        0,
        radius * 0.54,
        visual.light
    );

    ctx.restore();

    // Symmetric edge illumination nodes.
    ctx.save();
    ctx.rotate(rotation * 0.40);

    for (let i = 0; i < 8; i += 1) {
        const a =
            (i + 0.5) * Math.PI / 4;

        const x =
            Math.cos(a) *
            radius *
            0.80;

        const y =
            Math.sin(a) *
            radius *
            0.80;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = alphaColor(
            visual.light,
            0.74
        );
        ctx.shadowColor = visual.color;
        ctx.shadowBlur = radius * 0.14;

        ctx.beginPath();
        ctx.arc(
            x,
            y,
            Math.max(
                1.2,
                radius * 0.040
            ),
            0,
            Math.PI * 2
        );
        ctx.fill();

        ctx.restore();
    }

    ctx.restore();
    ctx.restore();

    if (showPowerupLabels) {
        const labelWidth = Math.max(
            62,
            visual.label.length * 9 + 22
        );

        const labelY =
            powerup.y -
            radius -
            24;

        ctx.save();

        roundedRectPath(
            ctx,
            powerup.x - labelWidth / 2,
            labelY - 11,
            labelWidth,
            22,
            6
        );

        const labelFill =
            ctx.createLinearGradient(
                powerup.x,
                labelY - 11,
                powerup.x,
                labelY + 11
            );

        labelFill.addColorStop(
            0,
            'rgba(18, 33, 40, 0.96)'
        );
        labelFill.addColorStop(
            1,
            'rgba(3, 10, 14, 0.94)'
        );

        ctx.fillStyle = labelFill;
        ctx.fill();

        ctx.strokeStyle = alphaColor(
            visual.color,
            0.64
        );
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = visual.light;
        ctx.font =
            `750 11px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillText(
            visual.label,
            powerup.x,
            labelY + 0.5
        );

        ctx.restore();
    }
},

drawProjectile(ctx, projectile) {
    const visual =
        this.getTeamVisual(
            projectile.team.id
        );

    const geometry =
        this.getGeometry(
            'projectile',
            projectile
        );

    const speed = Math.max(
        0.0001,
        Math.hypot(
            projectile.vx,
            projectile.vy
        )
    );

    const nx = projectile.vx / speed;
    const ny = projectile.vy / speed;

    const angle =
        Number.isFinite(projectile.angle)
            ? projectile.angle
            : Math.atan2(
                projectile.vy,
                projectile.vx
            );

    const focused =
        projectile.visualVariant ===
        'focused';

    const overcharged =
        projectile.visualVariant ===
        'overcharged';

    const trailLength = overcharged
        ? 94
        : focused
            ? 76
            : 58;

    const outerWidth = overcharged
        ? 15
        : focused
            ? 10
            : 8;

    const coreWidth = overcharged
        ? 5.4
        : focused
            ? 3.6
            : 3.0;

    const energyColor = overcharged
        ? '#ff4f93'
        : visual.main;

    const coreColor = focused
        ? '#dcfbff'
        : '#fff8e8';

    // Layered plasma trail.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    const wake = ctx.createLinearGradient(
        projectile.x - nx * trailLength,
        projectile.y - ny * trailLength,
        projectile.x +
            nx * geometry.width * 0.52,
        projectile.y +
            ny * geometry.width * 0.52
    );

    wake.addColorStop(
        0,
        alphaColor(energyColor, 0)
    );

    wake.addColorStop(
        0.38,
        alphaColor(
            energyColor,
            overcharged ? 0.14 : 0.08
        )
    );

    wake.addColorStop(
        0.72,
        alphaColor(
            energyColor,
            overcharged ? 0.48 : 0.34
        )
    );

    wake.addColorStop(
        0.91,
        alphaColor(visual.light, 0.86)
    );

    wake.addColorStop(1, '#ffffff');

    ctx.strokeStyle = wake;
    ctx.lineWidth = outerWidth;
    ctx.shadowColor = energyColor;
    ctx.shadowBlur = overcharged
        ? 28
        : 18;

    ctx.beginPath();

    ctx.moveTo(
        projectile.x - nx * trailLength,
        projectile.y - ny * trailLength
    );

    ctx.lineTo(
        projectile.x +
            nx * geometry.width * 0.52,
        projectile.y +
            ny * geometry.width * 0.52
    );

    ctx.stroke();

    // Narrow white-hot trail core.
    const coreTrail =
        ctx.createLinearGradient(
            projectile.x -
                nx *
                trailLength *
                0.72,
            projectile.y -
                ny *
                trailLength *
                0.72,
            projectile.x +
                nx *
                geometry.width *
                0.58,
            projectile.y +
                ny *
                geometry.width *
                0.58
        );

    coreTrail.addColorStop(
        0,
        alphaColor(coreColor, 0)
    );

    coreTrail.addColorStop(
        0.58,
        alphaColor(coreColor, 0.42)
    );

    coreTrail.addColorStop(
        0.88,
        coreColor
    );

    coreTrail.addColorStop(
        1,
        '#ffffff'
    );

    ctx.strokeStyle = coreTrail;
    ctx.lineWidth = coreWidth;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = overcharged
        ? 20
        : 12;

    ctx.beginPath();

    ctx.moveTo(
        projectile.x -
            nx *
            trailLength *
            0.72,
        projectile.y -
            ny *
            trailLength *
            0.72
    );

    ctx.lineTo(
        projectile.x +
            nx *
            geometry.width *
            0.58,
        projectile.y +
            ny *
            geometry.width *
            0.58
    );

    ctx.stroke();

    // Overcharged side filaments.
    if (overcharged) {
        const px = -ny;
        const py = nx;

        const offset = Math.max(
            2.2,
            geometry.height * 0.68
        );

        ctx.strokeStyle = alphaColor(
            energyColor,
            0.38
        );
        ctx.lineWidth = 1.4;
        ctx.shadowColor = energyColor;
        ctx.shadowBlur = 12;

        for (const side of [-1, 1]) {
            ctx.beginPath();

            ctx.moveTo(
                projectile.x -
                    nx *
                    trailLength *
                    0.48 +
                    px *
                    offset *
                    side,
                projectile.y -
                    ny *
                    trailLength *
                    0.48 +
                    py *
                    offset *
                    side
            );

            ctx.lineTo(
                projectile.x -
                    nx *
                    geometry.width *
                    0.10 +
                    px *
                    offset *
                    0.30 *
                    side,
                projectile.y -
                    ny *
                    geometry.width *
                    0.10 +
                    py *
                    offset *
                    0.30 *
                    side
            );

            ctx.stroke();
        }
    }

    ctx.restore();

    // Detailed projectile body.
    ctx.save();
    ctx.translate(
        projectile.x,
        projectile.y
    );
    ctx.rotate(angle);

    const width = Math.max(
        geometry.width,
        geometry.height * 1.8
    );

    const height = geometry.height;
    const rearX = -width * 0.52;
    const noseX = width * 0.58;

    // Body aura.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const bodyAura =
        ctx.createRadialGradient(
            0,
            0,
            0,
            0,
            0,
            width * 0.92
        );

    bodyAura.addColorStop(
        0,
        alphaColor(coreColor, 0.34)
    );

    bodyAura.addColorStop(
        0.42,
        alphaColor(energyColor, 0.22)
    );

    bodyAura.addColorStop(
        1,
        alphaColor(energyColor, 0)
    );

    ctx.fillStyle = bodyAura;

    ctx.beginPath();
    ctx.ellipse(
        0,
        0,
        width * 0.92,
        height * 1.65,
        0,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.restore();

    // Dark metallic casing.
    const casing =
        ctx.createLinearGradient(
            rearX,
            -height / 2,
            noseX,
            height / 2
        );

    casing.addColorStop(
        0,
        '#081116'
    );
    casing.addColorStop(
        0.18,
        '#24353d'
    );
    casing.addColorStop(
        0.48,
        alphaColor(
            energyColor,
            0.82
        )
    );
    casing.addColorStop(
        0.76,
        visual.light
    );
    casing.addColorStop(
        1,
        '#ffffff'
    );

    ctx.fillStyle = casing;
    ctx.strokeStyle = alphaColor(
        visual.light,
        0.72
    );
    ctx.lineWidth = Math.max(
        0.8,
        height * 0.11
    );
    ctx.shadowColor = energyColor;
    ctx.shadowBlur = overcharged
        ? 18
        : 10;

    ctx.beginPath();

    ctx.moveTo(
        rearX,
        -height * 0.34
    );

    ctx.quadraticCurveTo(
        rearX - height * 0.12,
        0,
        rearX,
        height * 0.34
    );

    ctx.lineTo(
        width * 0.26,
        height * 0.47
    );

    ctx.lineTo(noseX, 0);

    ctx.lineTo(
        width * 0.26,
        -height * 0.47
    );

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Central energy channel.
    const channel =
        ctx.createLinearGradient(
            -width * 0.20,
            0,
            width * 0.48,
            0
        );

    channel.addColorStop(
        0,
        alphaColor(energyColor, 0.18)
    );
    channel.addColorStop(
        0.48,
        coreColor
    );
    channel.addColorStop(
        1,
        '#ffffff'
    );

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = channel;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = overcharged
        ? 14
        : 8;

    roundedRectPath(
        ctx,
        -width * 0.18,
        -height * 0.15,
        width * 0.58,
        height * 0.30,
        height * 0.15
    );

    ctx.fill();
    ctx.restore();

    // Symmetric casing ribs.
    ctx.strokeStyle = alphaColor(
        visual.light,
        0.38
    );
    ctx.lineWidth = Math.max(
        0.7,
        height * 0.08
    );

    for (
        const x of [
            -width * 0.22,
            width * 0.04
        ]
    ) {
        ctx.beginPath();

        ctx.moveTo(
            x,
            -height * 0.34
        );

        ctx.lineTo(
            x + height * 0.10,
            0
        );

        ctx.lineTo(
            x,
            height * 0.34
        );

        ctx.stroke();
    }

    // Bright nose aperture.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = overcharged
        ? 16
        : 9;

    ctx.beginPath();
    ctx.arc(
        noseX - height * 0.12,
        0,
        Math.max(
            1.2,
            height * 0.16
        ),
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.restore();
    ctx.restore();
},

        drawParticle(ctx, particle) {
            const alpha = clamp(particle.life / particle.maxLife, 0, 1);
            let color = particle.colorToken;
            if (color?.startsWith('team:')) color = this.getTeamVisual(color.slice(5)).main;
            else if (color?.startsWith('powerup:')) color = this.getPowerupVisual(color.slice(8)).color;
            else if (color === 'shield') color = this.getPowerupVisual('AEGIS').color;
            else if (color === 'danger') color = '#ff5368';
            else if (color === 'ember') color = '#ff9b43';

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation || 0);
            ctx.globalCompositeOperation = particle.variant === 'arc' ? 'source-over' : 'lighter';
            ctx.fillStyle = alphaColor(color || '#ffffff', alpha);
            ctx.strokeStyle = alphaColor(color || '#ffffff', alpha);
            ctx.shadowColor = color || '#ffffff';
            ctx.shadowBlur = particle.variant === 'spark' ? 8 : 4;
            if (particle.variant === 'spark') {
                roundedRectPath(ctx, -particle.radius * 2.8, -particle.radius * 0.42, particle.radius * 5.6, particle.radius * 0.84, particle.radius * 0.42);
                ctx.fill();
            } else if (particle.variant === 'shard') {
                ctx.beginPath();
                ctx.moveTo(particle.radius * 2.4, 0);
                ctx.lineTo(-particle.radius, particle.radius * 0.8);
                ctx.lineTo(-particle.radius * 0.55, -particle.radius * 0.9);
                ctx.closePath();
                ctx.fill();
            } else if (particle.variant === 'arc') {
                ctx.lineWidth = 2.3;
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius * 2.5, -0.8, 0.9);
                ctx.stroke();
            } else if (particle.variant === 'glyph') {
                ctx.lineWidth = 1.7;
                ctx.strokeRect(-particle.radius, -particle.radius, particle.radius * 2, particle.radius * 2);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        },

        drawBot(ctx, bot, game) {
    const visual = this.getTeamVisual(bot.team.id);
    const radius = this.getGeometry('bot', bot).radius;
    const speed = Math.hypot(bot.vx, bot.vy);

    if (speed > 0.12) {
        bot._flyingCitadelAngle = Math.atan2(bot.vy, bot.vx);
    }

    if (!Number.isFinite(bot._flyingCitadelAngle)) {
        bot._flyingCitadelAngle =
            (stableHash(bot.id) % 360) * Math.PI / 180;
    }

    const angle = bot._flyingCitadelAngle;
    const thrust = clamp(speed / 4, 0.18, 1);
    const hash = stableHash(bot.id);
    const detailRotation = ((hash % 8) / 8) * Math.PI * 2;

    ctx.save();
    ctx.translate(bot.x, bot.y);

    /*
     * Soft circular ground shadow.
     * It deliberately does not rotate with the bot.
     */
    const shadowGradient = ctx.createRadialGradient(
        radius * 0.10,
        radius * 0.30,
        radius * 0.08,
        radius * 0.10,
        radius * 0.30,
        radius * 1.34
    );

    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.54)');
    shadowGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.30)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = shadowGradient;
    ctx.beginPath();
    ctx.ellipse(
        radius * 0.10,
        radius * 0.30,
        radius * 1.35,
        radius * 0.84,
        0,
        0,
        Math.PI * 2
    );
    ctx.fill();

    /*
     * Symmetric levitation halo.
     * The halo grows with speed without revealing movement direction.
     */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const flightHalo = ctx.createRadialGradient(
        0,
        0,
        radius * 0.48,
        0,
        0,
        radius * (1.42 + thrust * 0.16)
    );

    flightHalo.addColorStop(0, alphaColor(visual.light, 0));
    flightHalo.addColorStop(0.36, alphaColor(visual.main, 0.09));
    flightHalo.addColorStop(0.62, alphaColor(visual.main, 0.20 + thrust * 0.10));
    flightHalo.addColorStop(0.78, alphaColor(visual.light, 0.10 + thrust * 0.10));
    flightHalo.addColorStop(1, alphaColor(visual.main, 0));

    ctx.fillStyle = flightHalo;
    ctx.beginPath();
    ctx.arc(0, 0, radius * (1.50 + thrust * 0.12), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = alphaColor(visual.light, 0.18 + thrust * 0.18);
    ctx.lineWidth = Math.max(1, radius * 0.035);
    ctx.shadowColor = visual.main;
    ctx.shadowBlur = radius * (0.34 + thrust * 0.20);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.13, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    /*
     * Rotate only the mechanically detailed section.
     * The eight-way symmetry makes the rotation difficult to notice.
     */
    ctx.rotate(angle + detailRotation);

    /*
     * Eight evenly distributed propulsion nodes.
     */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const px = Math.cos(a) * radius * 1.02;
        const py = Math.sin(a) * radius * 1.02;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);

        const thrusterGlow = ctx.createRadialGradient(
            radius * 0.04,
            0,
            0,
            radius * 0.04,
            0,
            radius * (0.34 + thrust * 0.14)
        );

        thrusterGlow.addColorStop(0, alphaColor(visual.light, 0.88));
        thrusterGlow.addColorStop(0.25, alphaColor(visual.main, 0.54));
        thrusterGlow.addColorStop(1, alphaColor(visual.main, 0));

        ctx.fillStyle = thrusterGlow;
        ctx.beginPath();
        ctx.ellipse(
            radius * 0.09,
            0,
            radius * (0.34 + thrust * 0.10),
            radius * 0.20,
            0,
            0,
            Math.PI * 2
        );
        ctx.fill();

        ctx.restore();
    }

    ctx.restore();

    /*
     * Outer armored rim.
     */
    const outerHull = ctx.createRadialGradient(
        -radius * 0.32,
        -radius * 0.38,
        radius * 0.08,
        0,
        0,
        radius * 1.18
    );

    outerHull.addColorStop(0, '#70818a');
    outerHull.addColorStop(0.20, visual.armor);
    outerHull.addColorStop(0.48, '#273640');
    outerHull.addColorStop(0.74, '#121d24');
    outerHull.addColorStop(1, '#050b0f');

    ctx.fillStyle = outerHull;
    ctx.strokeStyle = alphaColor(visual.light, 0.62);
    ctx.lineWidth = Math.max(1.3, radius * 0.055);
    ctx.shadowColor = alphaColor(visual.main, 0.46);
    ctx.shadowBlur = radius * 0.34;

    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;

    /*
     * Radial armor sectors.
     */
    for (let i = 0; i < 8; i++) {
        const centerAngle = (i / 8) * Math.PI * 2;
        const halfWidth = Math.PI / 8 - 0.055;

        const innerRadius = radius * 0.72;
        const outerRadius = radius * 0.96;

        const a0 = centerAngle - halfWidth;
        const a1 = centerAngle + halfWidth;

        const sectorGradient = ctx.createLinearGradient(
            Math.cos(centerAngle) * innerRadius,
            Math.sin(centerAngle) * innerRadius,
            Math.cos(centerAngle) * outerRadius,
            Math.sin(centerAngle) * outerRadius
        );

        sectorGradient.addColorStop(0, '#1b2931');
        sectorGradient.addColorStop(0.42, visual.armor);
        sectorGradient.addColorStop(0.72, '#25343c');
        sectorGradient.addColorStop(1, '#0b1318');

        ctx.fillStyle = sectorGradient;
        ctx.strokeStyle = alphaColor(visual.light, 0.25);
        ctx.lineWidth = Math.max(0.8, radius * 0.027);

        ctx.beginPath();
        ctx.arc(0, 0, outerRadius, a0, a1);
        ctx.lineTo(
            Math.cos(a1) * innerRadius,
            Math.sin(a1) * innerRadius
        );
        ctx.arc(0, 0, innerRadius, a1, a0, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    /*
     * Outer separator cuts.
     */
    ctx.strokeStyle = 'rgba(225, 241, 247, 0.22)';
    ctx.lineWidth = Math.max(0.8, radius * 0.025);

    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        ctx.beginPath();
        ctx.moveTo(
            cos * radius * 0.74,
            sin * radius * 0.74
        );
        ctx.lineTo(
            cos * radius * 0.94,
            sin * radius * 0.94
        );
        ctx.stroke();
    }

    /*
     * Recessed mechanical ring.
     */
    const mechanicalRing = ctx.createRadialGradient(
        -radius * 0.20,
        -radius * 0.24,
        radius * 0.06,
        0,
        0,
        radius * 0.76
    );

    mechanicalRing.addColorStop(0, '#42535d');
    mechanicalRing.addColorStop(0.38, '#19262e');
    mechanicalRing.addColorStop(0.73, '#0a1217');
    mechanicalRing.addColorStop(1, '#020609');

    ctx.fillStyle = mechanicalRing;
    ctx.strokeStyle = alphaColor(visual.main, 0.72);
    ctx.lineWidth = Math.max(1.1, radius * 0.045);

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.70, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    /*
     * Illuminated radial conduits.
     */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);

        const inner = radius * 0.43;
        const outer = radius * 0.64;

        const conduitGradient = ctx.createLinearGradient(
            cos * inner,
            sin * inner,
            cos * outer,
            sin * outer
        );

        conduitGradient.addColorStop(0, alphaColor(visual.light, 0.18));
        conduitGradient.addColorStop(0.48, alphaColor(visual.main, 0.88));
        conduitGradient.addColorStop(1, alphaColor(visual.light, 0.24));

        ctx.strokeStyle = conduitGradient;
        ctx.lineWidth = Math.max(1.2, radius * 0.055);
        ctx.shadowColor = visual.main;
        ctx.shadowBlur = radius * 0.16;

        ctx.beginPath();
        ctx.moveTo(cos * inner, sin * inner);
        ctx.lineTo(cos * outer, sin * outer);
        ctx.stroke();
    }

    ctx.restore();

    /*
     * Small symmetric fastening nodes.
     */
    for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        const px = Math.cos(a) * radius * 0.57;
        const py = Math.sin(a) * radius * 0.57;

        const fastener = ctx.createRadialGradient(
            px - radius * 0.025,
            py - radius * 0.025,
            0,
            px,
            py,
            radius * 0.085
        );

        fastener.addColorStop(0, '#d8e2e7');
        fastener.addColorStop(0.18, '#697981');
        fastener.addColorStop(0.62, '#182329');
        fastener.addColorStop(1, '#050a0d');

        ctx.fillStyle = fastener;
        ctx.strokeStyle = 'rgba(230, 244, 250, 0.25)';
        ctx.lineWidth = Math.max(0.6, radius * 0.018);

        ctx.beginPath();
        ctx.arc(px, py, radius * 0.065, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    /*
     * Central reactor housing.
     */
    const reactorHousing = ctx.createRadialGradient(
        -radius * 0.14,
        -radius * 0.18,
        radius * 0.03,
        0,
        0,
        radius * 0.47
    );

    reactorHousing.addColorStop(0, '#60717a');
    reactorHousing.addColorStop(0.28, '#28373f');
    reactorHousing.addColorStop(0.62, '#101a20');
    reactorHousing.addColorStop(1, '#03080b');

    ctx.fillStyle = reactorHousing;
    ctx.strokeStyle = alphaColor(visual.light, 0.64);
    ctx.lineWidth = Math.max(1.1, radius * 0.045);

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    /*
     * Reactor containment ring.
     */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    ctx.strokeStyle = alphaColor(visual.main, 0.82);
    ctx.lineWidth = Math.max(1.4, radius * 0.07);
    ctx.shadowColor = visual.main;
    ctx.shadowBlur = radius * 0.24;

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.33, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    /*
     * Energy core.
     */
    const energyCore = ctx.createRadialGradient(
        -radius * 0.07,
        -radius * 0.09,
        0,
        0,
        0,
        radius * 0.29
    );

    energyCore.addColorStop(0, '#ffffff');
    energyCore.addColorStop(0.14, alphaColor(visual.light, 1));
    energyCore.addColorStop(0.42, alphaColor(visual.main, 0.94));
    energyCore.addColorStop(0.74, alphaColor(visual.mid, 0.78));
    energyCore.addColorStop(1, alphaColor(visual.dark, 0.28));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = energyCore;
    ctx.shadowColor = visual.main;
    ctx.shadowBlur = radius * (0.30 + thrust * 0.16);

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.27, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    /*
     * Core glass highlight.
     */
    const glassHighlight = ctx.createRadialGradient(
        -radius * 0.10,
        -radius * 0.11,
        0,
        -radius * 0.07,
        -radius * 0.08,
        radius * 0.18
    );

    glassHighlight.addColorStop(0, 'rgba(255, 255, 255, 0.82)');
    glassHighlight.addColorStop(0.30, 'rgba(255, 255, 255, 0.24)');
    glassHighlight.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = glassHighlight;
    ctx.beginPath();
    ctx.arc(
        -radius * 0.065,
        -radius * 0.075,
        radius * 0.18,
        0,
        Math.PI * 2
    );
    ctx.fill();

    /*
     * Fine concentric technical lines.
     */
    ctx.strokeStyle = 'rgba(225, 241, 247, 0.16)';
    ctx.lineWidth = Math.max(0.65, radius * 0.018);

    for (const ringRadius of [
        radius * 0.50,
        radius * 0.79,
        radius * 0.89
    ]) {
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    /*
     * Symmetric edge illumination nodes.
     */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        const px = Math.cos(a) * radius * 0.91;
        const py = Math.sin(a) * radius * 0.91;

        ctx.fillStyle = alphaColor(visual.light, 0.72);
        ctx.shadowColor = visual.main;
        ctx.shadowBlur = radius * 0.16;

        ctx.beginPath();
        ctx.arc(px, py, radius * 0.035, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
    ctx.restore();

    drawBotPowerupRings(ctx, bot, this, radius, game);

    if (showHealthChips) {
        drawHealthChip(ctx, bot, visual, radius);
    }
},

        drawDisplayText(ctx, game, config) {
    const text = String(config?.text || '').trim();
    if (!text) return;

    const fps = Math.max(1, Number(game.gameConfig.targetFps) || 60);
    const start = Math.max(0, Number(config.startSeconds) || 0) * fps;
    const endSeconds = Number(config.endSeconds) || 0;
    const end = endSeconds > 0 ? endSeconds * fps : Infinity;

    if (game.frameCount < start || game.frameCount > end) return;

    const transitionFrames = Math.max(1, Math.round(fps * 0.48));
    const elapsed = game.frameCount - start;

    const inProgress = clamp(elapsed / transitionFrames, 0, 1);
    const outProgress = Number.isFinite(end)
        ? clamp((end - game.frameCount) / transitionFrames, 0, 1)
        : 1;

    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const easeInOut = t => t * t * (3 - 2 * t);

    const alpha = Math.min(
        easeOutCubic(inProgress),
        easeOutCubic(outProgress)
    );

    const appear = easeOutCubic(inProgress);
    const disappear = easeInOut(outProgress);

    const x = Number.isFinite(Number(config.x))
        ? Number(config.x)
        : game.width * 0.5;

    const baseY = Number.isFinite(Number(config.y))
        ? Number(config.y)
        : game.height * 0.36;

    const fontSize = Math.max(28, Math.min(58, game.width * 0.046));
    const kickerSize = Math.max(9, fontSize * 0.22);
    const upperText = text.toUpperCase();
    const kicker = String(config?.kicker || 'TACTICAL DIRECTIVE').toUpperCase();

    const accent = config?.accent || '#72f4ff';
    const secondaryAccent = config?.secondaryAccent || '#7d8dff';

    const maxWidth = game.width * 0.76;

    ctx.save();

    ctx.font = `800 ${fontSize}px ${FONT_STACK}`;

    const textMetrics = ctx.measureText(upperText);
    const desiredWidth = textMetrics.width + fontSize * 2.25;
    const panelWidth = Math.min(maxWidth, Math.max(fontSize * 5.2, desiredWidth));
    const panelHeight = fontSize * 2.05;

    const entranceOffset = (1 - appear) * 22;
    const exitOffset = (1 - disappear) * -10;
    const y = baseY + entranceOffset + exitOffset;

    const scaleX = 0.88 + appear * 0.12;
    const scaleY = 0.94 + appear * 0.06;

    const localTime = elapsed / fps;
    const pulse = 0.5 + 0.5 * Math.sin(localTime * 3.4);
    const fastPulse = 0.5 + 0.5 * Math.sin(localTime * 8.5);

    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scaleX, scaleY);

    const left = -panelWidth * 0.5;
    const top = -panelHeight * 0.5;

    /*
     * Wide atmospheric glow.
     */
    const atmosphericGlow = ctx.createRadialGradient(
        0,
        0,
        panelWidth * 0.06,
        0,
        0,
        panelWidth * 0.62
    );

    atmosphericGlow.addColorStop(0, alphaColor(accent, 0.12 + pulse * 0.035));
    atmosphericGlow.addColorStop(0.48, alphaColor(secondaryAccent, 0.055));
    atmosphericGlow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = atmosphericGlow;
    ctx.fillRect(
        -panelWidth * 0.72,
        -panelHeight * 1.25,
        panelWidth * 1.44,
        panelHeight * 2.5
    );

    /*
     * Deep projected shadow.
     */
    ctx.save();
    ctx.translate(0, 9);
    roundedRectPath(
        ctx,
        left + 8,
        top + 7,
        panelWidth - 16,
        panelHeight - 8,
        11
    );
    ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.86)';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.restore();

    /*
     * Outer holographic frame.
     */
    const outerFrameGradient = ctx.createLinearGradient(
        left,
        top,
        -left,
        -top
    );

    outerFrameGradient.addColorStop(0, alphaColor(accent, 0.16));
    outerFrameGradient.addColorStop(0.25, 'rgba(8, 21, 34, 0.94)');
    outerFrameGradient.addColorStop(0.72, 'rgba(5, 13, 25, 0.95)');
    outerFrameGradient.addColorStop(1, alphaColor(secondaryAccent, 0.18));

    roundedRectPath(
        ctx,
        left,
        top,
        panelWidth,
        panelHeight,
        12
    );

    ctx.fillStyle = outerFrameGradient;
    ctx.shadowColor = alphaColor(accent, 0.38);
    ctx.shadowBlur = 24 + pulse * 8;
    ctx.fill();

    /*
     * Main border.
     */
    const borderGradient = ctx.createLinearGradient(left, 0, -left, 0);
    borderGradient.addColorStop(0, alphaColor(accent, 0.15));
    borderGradient.addColorStop(0.2, alphaColor(accent, 0.76));
    borderGradient.addColorStop(0.5, 'rgba(220, 253, 255, 0.88)');
    borderGradient.addColorStop(0.8, alphaColor(secondaryAccent, 0.72));
    borderGradient.addColorStop(1, alphaColor(secondaryAccent, 0.13));

    ctx.strokeStyle = borderGradient;
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.shadowBlur = 0;

    /*
     * Inner glass surface.
     */
    roundedRectPath(
        ctx,
        left + 7,
        top + 7,
        panelWidth - 14,
        panelHeight - 14,
        8
    );

    const glassGradient = ctx.createLinearGradient(0, top, 0, -top);
    glassGradient.addColorStop(0, 'rgba(10, 27, 41, 0.88)');
    glassGradient.addColorStop(0.4, 'rgba(3, 13, 23, 0.96)');
    glassGradient.addColorStop(0.72, 'rgba(2, 9, 17, 0.98)');
    glassGradient.addColorStop(1, 'rgba(13, 30, 43, 0.88)');

    ctx.fillStyle = glassGradient;
    ctx.fill();

    ctx.strokeStyle = 'rgba(193, 249, 255, 0.11)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /*
     * Top glass reflection.
     */
    ctx.save();
    roundedRectPath(
        ctx,
        left + 9,
        top + 9,
        panelWidth - 18,
        panelHeight * 0.42,
        7
    );
    ctx.clip();

    const reflection = ctx.createLinearGradient(0, top, 0, top + panelHeight * 0.5);
    reflection.addColorStop(0, 'rgba(255,255,255,0.11)');
    reflection.addColorStop(0.5, 'rgba(131,238,255,0.025)');
    reflection.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = reflection;
    ctx.fillRect(left, top, panelWidth, panelHeight * 0.55);
    ctx.restore();

    /*
     * Fine scan-line texture.
     */
    ctx.save();
    roundedRectPath(
        ctx,
        left + 8,
        top + 8,
        panelWidth - 16,
        panelHeight - 16,
        8
    );
    ctx.clip();

    ctx.strokeStyle = 'rgba(132, 239, 255, 0.035)';
    ctx.lineWidth = 1;

    for (let lineY = top + 12; lineY < -top - 8; lineY += 5) {
        ctx.beginPath();
        ctx.moveTo(left + 12, lineY);
        ctx.lineTo(-left - 12, lineY);
        ctx.stroke();
    }

    /*
     * Animated scanning beam.
     */
    const scanRange = panelHeight - 24;
    const scanY = top + 12 + ((localTime * 42) % scanRange);

    const scanGradient = ctx.createLinearGradient(
        0,
        scanY - 14,
        0,
        scanY + 14
    );

    scanGradient.addColorStop(0, 'rgba(90,245,255,0)');
    scanGradient.addColorStop(0.5, alphaColor(accent, 0.10 + fastPulse * 0.05));
    scanGradient.addColorStop(1, 'rgba(90,245,255,0)');

    ctx.fillStyle = scanGradient;
    ctx.fillRect(left + 8, scanY - 14, panelWidth - 16, 28);
    ctx.restore();

    /*
     * Top central telemetry ornament.
     */
    const topRailWidth = Math.min(panelWidth * 0.32, 180);
    const topRailY = top + 15;

    ctx.strokeStyle = alphaColor(accent, 0.48);
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(-topRailWidth * 0.5, topRailY);
    ctx.lineTo(-18, topRailY);
    ctx.lineTo(-10, topRailY + 6);
    ctx.lineTo(10, topRailY + 6);
    ctx.lineTo(18, topRailY);
    ctx.lineTo(topRailWidth * 0.5, topRailY);
    ctx.stroke();

    ctx.fillStyle = alphaColor(accent, 0.82);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.arc(0, topRailY + 6, 2.2 + pulse * 0.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    /*
     * Symmetric side brackets.
     */
    const bracketLength = Math.min(28, fontSize * 0.52);
    const bracketInset = 13;

    ctx.strokeStyle = alphaColor(accent, 0.74);
    ctx.lineWidth = 2;

    const drawCornerBracket = (cornerX, cornerY, directionX, directionY) => {
        ctx.beginPath();
        ctx.moveTo(cornerX, cornerY + directionY * bracketLength);
        ctx.lineTo(cornerX, cornerY);
        ctx.lineTo(cornerX + directionX * bracketLength, cornerY);
        ctx.stroke();
    };

    drawCornerBracket(
        left + bracketInset,
        top + bracketInset,
        1,
        1
    );

    drawCornerBracket(
        -left - bracketInset,
        top + bracketInset,
        -1,
        1
    );

    drawCornerBracket(
        left + bracketInset,
        -top - bracketInset,
        1,
        -1
    );

    drawCornerBracket(
        -left - bracketInset,
        -top - bracketInset,
        -1,
        -1
    );

    /*
     * Side energy nodes.
     */
    const sideNodeX = panelWidth * 0.5 - 4;

    for (const direction of [-1, 1]) {
        ctx.save();
        ctx.translate(direction * sideNodeX, 0);

        ctx.fillStyle = alphaColor(accent, 0.20);
        ctx.shadowColor = accent;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(direction * 7, -4);
        ctx.lineTo(direction * 7, 4);
        ctx.lineTo(0, 11);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = alphaColor(accent, 0.72);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    ctx.shadowBlur = 0;

    /*
     * Kicker text.
     */
    ctx.font = `700 ${kickerSize}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const letterSpacingSimulation = kicker
        .split('')
        .join('\u2009');

    ctx.fillStyle = alphaColor(accent, 0.82);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 5;
    ctx.fillText(
        letterSpacingSimulation,
        0,
        -fontSize * 0.48,
        panelWidth - 80
    );

    /*
     * Main title shadow/extrusion.
     */
    ctx.font = `800 ${fontSize}px ${FONT_STACK}`;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.shadowBlur = 0;
    ctx.fillText(
        upperText,
        0,
        fontSize * 0.14 + 3,
        panelWidth - 44
    );

    /*
     * Main title metallic-holographic fill.
     */
    const textGradient = ctx.createLinearGradient(
        0,
        -fontSize * 0.5,
        0,
        fontSize * 0.65
    );

    textGradient.addColorStop(0, '#ffffff');
    textGradient.addColorStop(0.28, '#e9fdff');
    textGradient.addColorStop(0.56, '#aeeef5');
    textGradient.addColorStop(0.76, '#f6ffff');
    textGradient.addColorStop(1, '#8dcbd7');

    ctx.fillStyle = textGradient;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 9 + pulse * 5;
    ctx.fillText(
        upperText,
        0,
        fontSize * 0.14,
        panelWidth - 44
    );

    /*
     * Thin highlight pass.
     */
    ctx.globalAlpha = alpha * 0.48;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.8;
    ctx.shadowBlur = 2;
    ctx.strokeText(
        upperText,
        0,
        fontSize * 0.14,
        panelWidth - 44
    );

    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 0;

    /*
     * Bottom status rail.
     */
    const railY = panelHeight * 0.5 - 17;
    const railWidth = panelWidth - 76;
    const centerGap = 34;

    ctx.strokeStyle = alphaColor(secondaryAccent, 0.38);
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(-railWidth * 0.5, railY);
    ctx.lineTo(-centerGap * 0.5, railY);
    ctx.moveTo(centerGap * 0.5, railY);
    ctx.lineTo(railWidth * 0.5, railY);
    ctx.stroke();

    for (const direction of [-1, 1]) {
        const nodeX = direction * centerGap * 0.5;

        ctx.fillStyle = alphaColor(accent, 0.65 + pulse * 0.2);
        ctx.beginPath();
        ctx.arc(nodeX, railY, 1.7, 0, Math.PI * 2);
        ctx.fill();
    }

    /*
     * Moving signal marker along bottom rail.
     */
    const markerRange = railWidth * 0.5 - centerGap * 0.5;
    const markerProgress = (localTime * 0.42) % 1;
    const markerX = -railWidth * 0.5 + markerRange * markerProgress;

    ctx.fillStyle = alphaColor(accent, 0.82);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 7;

    ctx.fillRect(markerX, railY - 1, 12, 2);

    ctx.restore();
},

drawOverlay(ctx, game) {
    if (!showMatchClock) return;

    const fps = Math.max(1, Number(game.gameConfig.targetFps) || 60);
    const maxFrames = Math.max(1, Number(game.match.maxFrames) || 1);
    const remainingFrames = Math.max(0, maxFrames - game.frameCount);
    const remainingSeconds = Math.ceil(remainingFrames / fps);

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, '0');
    const ratio = clamp(remainingFrames / maxFrames, 0, 1);

    const dangerActive = Boolean(game.arena.damageActive);
    const criticalTime = ratio <= 0.18;
    const warningTime = ratio <= 0.45 && !criticalTime;

    const time = game.frameCount / fps;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.8);
    const urgentPulse = 0.5 + 0.5 * Math.sin(time * 9.5);

    const accent = dangerActive || criticalTime
        ? '#ff526d'
        : warningTime
            ? '#ffd260'
            : '#72eff8';

    const secondaryAccent = dangerActive || criticalTime
        ? '#ff8d75'
        : warningTime
            ? '#ffec9a'
            : '#778aff';

    const width = Math.max(268, Math.min(320, game.width * 0.29));
    const height = 78;
    const x = game.width * 0.5 - width * 0.5;
    const y = 20;

    ctx.save();

    /*
     * Ambient top-center glow.
     */
    const ambientGlow = ctx.createRadialGradient(
        game.width * 0.5,
        y + height * 0.25,
        4,
        game.width * 0.5,
        y + height * 0.25,
        width * 0.72
    );

    ambientGlow.addColorStop(
        0,
        alphaColor(accent, dangerActive ? 0.13 + urgentPulse * 0.06 : 0.10)
    );
    ambientGlow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = ambientGlow;
    ctx.fillRect(
        game.width * 0.5 - width,
        0,
        width * 2,
        height * 1.9
    );

    /*
     * Long symmetric HUD rails.
     */
    const railY = y + 9;
    const centerGap = width * 0.62;
    const outerMargin = 30;

    const railGradientLeft = ctx.createLinearGradient(
        outerMargin,
        0,
        game.width * 0.5 - centerGap * 0.5,
        0
    );

    railGradientLeft.addColorStop(0, 'rgba(114,239,248,0)');
    railGradientLeft.addColorStop(0.55, alphaColor(accent, 0.18));
    railGradientLeft.addColorStop(1, alphaColor(accent, 0.58));

    ctx.strokeStyle = railGradientLeft;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(outerMargin, railY);
    ctx.lineTo(game.width * 0.5 - centerGap * 0.5 - 18, railY);
    ctx.lineTo(game.width * 0.5 - centerGap * 0.5 - 8, railY + 6);
    ctx.stroke();

    const railGradientRight = ctx.createLinearGradient(
        game.width * 0.5 + centerGap * 0.5,
        0,
        game.width - outerMargin,
        0
    );

    railGradientRight.addColorStop(0, alphaColor(accent, 0.58));
    railGradientRight.addColorStop(0.45, alphaColor(accent, 0.18));
    railGradientRight.addColorStop(1, 'rgba(114,239,248,0)');

    ctx.strokeStyle = railGradientRight;

    ctx.beginPath();
    ctx.moveTo(game.width * 0.5 + centerGap * 0.5 + 8, railY + 6);
    ctx.lineTo(game.width * 0.5 + centerGap * 0.5 + 18, railY);
    ctx.lineTo(game.width - outerMargin, railY);
    ctx.stroke();

    /*
     * Panel shadow.
     */
    ctx.save();
    ctx.translate(0, 7);

    roundedRectPath(
        ctx,
        x + 7,
        y + 4,
        width - 14,
        height - 5,
        10
    );

    ctx.fillStyle = 'rgba(0,0,0,0.44)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 22;
    ctx.fill();

    ctx.restore();

    /*
     * Main timer chassis.
     */
    const chassisGradient = ctx.createLinearGradient(x, y, x + width, y + height);

    chassisGradient.addColorStop(0, alphaColor(accent, 0.14));
    chassisGradient.addColorStop(0.12, 'rgba(7,19,29,0.96)');
    chassisGradient.addColorStop(0.52, 'rgba(2,9,16,0.97)');
    chassisGradient.addColorStop(0.88, 'rgba(7,17,30,0.96)');
    chassisGradient.addColorStop(1, alphaColor(secondaryAccent, 0.16));

    roundedRectPath(ctx, x, y, width, height, 10);
    ctx.fillStyle = chassisGradient;
    ctx.shadowColor = alphaColor(accent, 0.28 + pulse * 0.08);
    ctx.shadowBlur = 16;
    ctx.fill();

    ctx.shadowBlur = 0;

    const frameGradient = ctx.createLinearGradient(x, 0, x + width, 0);
    frameGradient.addColorStop(0, alphaColor(accent, 0.16));
    frameGradient.addColorStop(0.24, alphaColor(accent, 0.72));
    frameGradient.addColorStop(0.5, alphaColor('#ffffff', 0.72));
    frameGradient.addColorStop(0.76, alphaColor(secondaryAccent, 0.62));
    frameGradient.addColorStop(1, alphaColor(secondaryAccent, 0.14));

    ctx.strokeStyle = frameGradient;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    /*
     * Inner glass.
     */
    roundedRectPath(
        ctx,
        x + 6,
        y + 6,
        width - 12,
        height - 12,
        7
    );

    const innerGradient = ctx.createLinearGradient(0, y, 0, y + height);
    innerGradient.addColorStop(0, 'rgba(19,39,52,0.72)');
    innerGradient.addColorStop(0.36, 'rgba(4,15,24,0.88)');
    innerGradient.addColorStop(1, 'rgba(2,8,15,0.94)');

    ctx.fillStyle = innerGradient;
    ctx.fill();

    ctx.strokeStyle = 'rgba(222,250,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /*
     * Angular side braces.
     */
    const braceInset = 12;
    const braceLength = 22;

    ctx.strokeStyle = alphaColor(accent, 0.72);
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(x + braceInset, y + 25);
    ctx.lineTo(x + braceInset, y + braceInset);
    ctx.lineTo(x + braceInset + braceLength, y + braceInset);

    ctx.moveTo(x + width - braceInset, y + 25);
    ctx.lineTo(x + width - braceInset, y + braceInset);
    ctx.lineTo(x + width - braceInset - braceLength, y + braceInset);
    ctx.stroke();

    /*
     * Header label.
     */
    const statusLabel = dangerActive
        ? 'ARENA COLLAPSE'
        : criticalTime
            ? 'FINAL PHASE'
            : warningTime
                ? 'TIME WARNING'
                : 'MATCH TIME';

    ctx.font = `700 9px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = alphaColor(accent, 0.82);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 4;

    ctx.fillText(
        statusLabel.split('').join('\u2009'),
        game.width * 0.5,
        y + 15
    );

    /*
     * Timer digits.
     */
    ctx.font = `800 30px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const timerY = y + 40;

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(
        `${minutes}:${seconds}`,
        game.width * 0.5,
        timerY + 2
    );

    const digitGradient = ctx.createLinearGradient(
        0,
        timerY - 17,
        0,
        timerY + 17
    );

    digitGradient.addColorStop(0, '#ffffff');
    digitGradient.addColorStop(0.42, '#e8fdff');
    digitGradient.addColorStop(0.7, accent);
    digitGradient.addColorStop(1, '#9abec6');

    ctx.fillStyle = digitGradient;
    ctx.shadowColor = accent;
    ctx.shadowBlur = dangerActive || criticalTime
        ? 7 + urgentPulse * 9
        : 7 + pulse * 4;

    ctx.fillText(
        `${minutes}:${seconds}`,
        game.width * 0.5,
        timerY
    );

    ctx.shadowBlur = 0;

    /*
     * Timer-side micro indicators.
     */
    const indicatorY = timerY;
    const indicatorOffset = 63;

    for (const side of [-1, 1]) {
        const indicatorX = game.width * 0.5 + side * indicatorOffset;

        ctx.strokeStyle = alphaColor(accent, 0.44);
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(indicatorX, indicatorY - 8);
        ctx.lineTo(indicatorX + side * 13, indicatorY);
        ctx.lineTo(indicatorX, indicatorY + 8);
        ctx.stroke();

        ctx.fillStyle = alphaColor(
            accent,
            0.45 + (dangerActive ? urgentPulse : pulse) * 0.45
        );

        ctx.beginPath();
        ctx.arc(indicatorX + side * 17, indicatorY, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    /*
     * Segmented progress rail.
     */
    const barX = x + 18;
    const barY = y + height - 17;
    const barWidth = width - 36;
    const barHeight = 6;

    roundedRectPath(ctx, barX, barY, barWidth, barHeight, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.075)';
    ctx.fill();

    const progressWidth = Math.max(3, barWidth * ratio);

    if (progressWidth > 0) {
        ctx.save();

        roundedRectPath(
            ctx,
            barX,
            barY,
            progressWidth,
            barHeight,
            3
        );
        ctx.clip();

        const progressGradient = ctx.createLinearGradient(
            barX,
            0,
            barX + barWidth,
            0
        );

        progressGradient.addColorStop(0, secondaryAccent);
        progressGradient.addColorStop(0.48, accent);
        progressGradient.addColorStop(1, '#f2ffff');

        ctx.fillStyle = progressGradient;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 8;
        ctx.fillRect(barX, barY, progressWidth, barHeight);

        ctx.restore();
    }

    /*
     * Segment dividers.
     */
    const segmentCount = 12;

    ctx.strokeStyle = 'rgba(1,7,12,0.72)';
    ctx.lineWidth = 1;

    for (let i = 1; i < segmentCount; i++) {
        const segmentX = barX + (barWidth * i) / segmentCount;

        ctx.beginPath();
        ctx.moveTo(segmentX, barY);
        ctx.lineTo(segmentX, barY + barHeight);
        ctx.stroke();
    }

    /*
     * Progress leading edge.
     */
    const edgeX = barX + progressWidth;

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.fillRect(
        Math.min(barX + barWidth - 1, edgeX - 1),
        barY,
        1.5,
        barHeight
    );

    /*
     * Lower decorative nodes.
     */
    ctx.shadowBlur = 0;

    for (const side of [-1, 1]) {
        const nodeX = game.width * 0.5 + side * (width * 0.5 - 11);

        ctx.fillStyle = alphaColor(accent, 0.54 + pulse * 0.24);
        ctx.beginPath();
        ctx.arc(nodeX, y + height - 14, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
},

drawClimaxRing(ctx, game, radius, alpha, team) {
    if (!team || alpha <= 0 || radius <= 0) return;

    const visual = this.getTeamVisual(team.id);
    const color = visual.main;
    const secondary = visual.light || '#ffffff';

    const fps = Math.max(1, Number(game.gameConfig.targetFps) || 60);
    const time = game.frameCount / fps;

    const cx = game.arena.centerX;
    const cy = game.arena.centerY;

    const pulse = 0.5 + 0.5 * Math.sin(time * 5.2);
    const fastPulse = 0.5 + 0.5 * Math.sin(time * 11.5);

    const rotationA = time * 0.42;
    const rotationB = -time * 0.28;
    const rotationC = time * 0.16;

    ctx.save();
    ctx.translate(cx, cy);

    /*
     * Large atmospheric energy field.
     */
    const aura = ctx.createRadialGradient(
        0,
        0,
        Math.max(0, radius - 60),
        0,
        0,
        radius + 75
    );

    aura.addColorStop(0, 'rgba(0,0,0,0)');
    aura.addColorStop(0.58, 'rgba(0,0,0,0)');
    aura.addColorStop(0.78, alphaColor(color, alpha * 0.07));
    aura.addColorStop(0.9, alphaColor(color, alpha * 0.15));
    aura.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = aura;
    ctx.fillRect(
        -radius - 100,
        -radius - 100,
        radius * 2 + 200,
        radius * 2 + 200
    );

    /*
     * Soft exterior energy ring.
     */
    ctx.strokeStyle = alphaColor(color, alpha * (0.16 + pulse * 0.08));
    ctx.lineWidth = 28;
    ctx.shadowColor = color;
    ctx.shadowBlur = 42;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;

    /*
     * Outer segmented mechanical ring.
     */
    ctx.save();
    ctx.rotate(rotationA);

    ctx.strokeStyle = alphaColor(color, alpha * 0.72);
    ctx.lineWidth = 12;
    ctx.lineCap = 'butt';
    ctx.setLineDash([34, 15, 9, 15]);
    ctx.lineDashOffset = -time * 36;

    ctx.shadowColor = color;
    ctx.shadowBlur = 20;

    ctx.beginPath();
    ctx.arc(0, 0, radius + 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    /*
     * Counter-rotating inner segmented ring.
     */
    ctx.save();
    ctx.rotate(rotationB);

    ctx.strokeStyle = alphaColor(secondary, alpha * 0.42);
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 13]);
    ctx.lineDashOffset = time * 24;

    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(0, 0, radius - 13, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    /*
     * Precision guide rings.
     */
    ctx.strokeStyle = alphaColor(color, alpha * 0.24);
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(0, 0, radius + 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = alphaColor('#ffffff', alpha * 0.17);

    ctx.beginPath();
    ctx.arc(0, 0, radius - 24, 0, Math.PI * 2);
    ctx.stroke();

    /*
     * Symmetric radial targeting marks.
     */
    const spokeCount = 16;

    ctx.save();
    ctx.rotate(rotationC);

    for (let i = 0; i < spokeCount; i++) {
        const angle = (i / spokeCount) * Math.PI * 2;
        const major = i % 4 === 0;

        const innerRadius = radius + (major ? 18 : 20);
        const outerRadius = radius + (major ? 43 : 31);

        const x1 = Math.cos(angle) * innerRadius;
        const y1 = Math.sin(angle) * innerRadius;
        const x2 = Math.cos(angle) * outerRadius;
        const y2 = Math.sin(angle) * outerRadius;

        ctx.strokeStyle = alphaColor(
            major ? '#ffffff' : color,
            alpha * (major ? 0.48 : 0.25)
        );

        ctx.lineWidth = major ? 2.2 : 1;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (major) {
            const nodeRadius = radius + 50;
            const nodeX = Math.cos(angle) * nodeRadius;
            const nodeY = Math.sin(angle) * nodeRadius;

            ctx.fillStyle = alphaColor(
                color,
                alpha * (0.65 + fastPulse * 0.25)
            );

            ctx.shadowColor = color;
            ctx.shadowBlur = 12;

            ctx.beginPath();
            ctx.arc(
                nodeX,
                nodeY,
                3.2 + pulse * 1.2,
                0,
                Math.PI * 2
            );
            ctx.fill();

            ctx.shadowBlur = 0;
        }
    }

    ctx.restore();

    /*
     * Four symmetric locking brackets.
     */
    const bracketRadius = radius - 36;
    const bracketArc = Math.PI * 0.095;

    ctx.save();
    ctx.rotate(-rotationC * 0.55);

    for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI * 0.5;

        ctx.strokeStyle = alphaColor(
            secondary,
            alpha * (0.5 + pulse * 0.16)
        );

        ctx.lineWidth = 5;
        ctx.lineCap = 'square';
        ctx.shadowColor = color;
        ctx.shadowBlur = 13;

        ctx.beginPath();
        ctx.arc(
            0,
            0,
            bracketRadius,
            angle - bracketArc,
            angle + bracketArc
        );
        ctx.stroke();

        const leftAngle = angle - bracketArc;
        const rightAngle = angle + bracketArc;

        for (const endpointAngle of [leftAngle, rightAngle]) {
            const innerX = Math.cos(endpointAngle) * (bracketRadius - 8);
            const innerY = Math.sin(endpointAngle) * (bracketRadius - 8);
            const outerX = Math.cos(endpointAngle) * (bracketRadius + 8);
            const outerY = Math.sin(endpointAngle) * (bracketRadius + 8);

            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(innerX, innerY);
            ctx.lineTo(outerX, outerY);
            ctx.stroke();
        }
    }

    ctx.restore();

    /*
     * Traveling energy packets.
     */
    const packetCount = 8;

    for (let i = 0; i < packetCount; i++) {
        const packetAngle =
            rotationA * 1.8 +
            (i / packetCount) * Math.PI * 2;

        const packetRadius = radius + 4;
        const packetX = Math.cos(packetAngle) * packetRadius;
        const packetY = Math.sin(packetAngle) * packetRadius;

        ctx.fillStyle = alphaColor('#ffffff', alpha * 0.74);
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;

        ctx.beginPath();
        ctx.arc(
            packetX,
            packetY,
            1.6 + fastPulse * 1.1,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    ctx.shadowBlur = 0;

    /*
     * Subtle interior radial pulse.
     */
    ctx.strokeStyle = alphaColor(
        color,
        alpha * (0.11 + pulse * 0.07)
    );
    ctx.lineWidth = 7 + pulse * 3;

    ctx.beginPath();
    ctx.arc(
        0,
        0,
        radius - 48 - pulse * 5,
        0,
        Math.PI * 2
    );
    ctx.stroke();

    ctx.restore();
}
    };
}
