const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({ main: '#2f67ff', light: '#dbe5ff', dark: '#183a91', border: '#111111', accent: '#f8f6f1' }),
    magenta: Object.freeze({ main: '#d90100', light: '#ffd9d6', dark: '#7a0000', border: '#111111', accent: '#f8f6f1' }),
    gold: Object.freeze({ main: '#ffd83e', light: '#fff2b2', dark: '#7a6504', border: '#111111', accent: '#f8f6f1' }),
    lime: Object.freeze({ main: '#097e5c', light: '#d5f0e8', dark: '#054d38', border: '#111111', accent: '#f8f6f1' })
});

const FONT_STACK = '"Aptos", "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DISPLAY_FONT_STACK = '"Aptos Display", "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Keep the same short labels and distinct color language used by minimal-tactical.
const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ff8a3d', label: 'POWER', icon: 'bolt' }),
    AEGIS: Object.freeze({ color: '#26c6da', label: 'SHIELD', icon: 'shield' }),
    // Strong blue remains clearly visible against the warm beige arena.
    TURBO: Object.freeze({ color: '#1769ff', label: 'SPEED', icon: 'turbo' }),
    REGEN: Object.freeze({ color: '#54d66b', label: 'HEAL', icon: 'plus' }),
    FOCUS: Object.freeze({ color: '#a880fe', label: 'AIM', icon: 'target' })
});

function alphaColor(hex, alpha) {
    const clean = String(hex || '#000000').replace('#', '');
    const expanded = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean;
    const value = Number.parseInt(expanded, 16);
    if (!Number.isFinite(value)) return `rgba(0, 0, 0, ${alpha})`;
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, r);
        return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + width, y + height - r);
    ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + height);
    ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
}

function drawPowerupIcon(ctx, type, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2.7, size * 0.105);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const icon = POWERUP_VISUALS[type]?.icon;
    if (icon === 'bolt') {
        ctx.beginPath();
        ctx.moveTo(size * 0.10, -size * 0.58);
        ctx.lineTo(-size * 0.32, -size * 0.02);
        ctx.lineTo(0, -size * 0.02);
        ctx.lineTo(-size * 0.10, size * 0.58);
        ctx.lineTo(size * 0.38, -size * 0.08);
        ctx.lineTo(size * 0.06, -size * 0.08);
        ctx.closePath();
        ctx.fill();
    } else if (icon === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.54);
        ctx.lineTo(size * 0.46, -size * 0.31);
        ctx.lineTo(size * 0.35, size * 0.22);
        ctx.quadraticCurveTo(0, size * 0.58, -size * 0.35, size * 0.22);
        ctx.lineTo(-size * 0.46, -size * 0.31);
        ctx.closePath();
        ctx.stroke();
    } else if (icon === 'turbo') {
        // Two balanced chevrons. Their combined bounds are symmetric around x = 0,
        // avoiding the left-heavy appearance of the previous icon.
        for (const offset of [-size * 0.18, size * 0.18]) {
            ctx.beginPath();
            ctx.moveTo(-size * 0.17 + offset, -size * 0.42);
            ctx.lineTo(size * 0.17 + offset, 0);
            ctx.lineTo(-size * 0.17 + offset, size * 0.42);
            ctx.stroke();
        }
    } else if (icon === 'plus') {
        ctx.fillRect(-size * 0.115, -size * 0.50, size * 0.23, size);
        ctx.fillRect(-size * 0.50, -size * 0.115, size, size * 0.23);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.41, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-size * 0.62, 0); ctx.lineTo(-size * 0.34, 0);
        ctx.moveTo(size * 0.34, 0); ctx.lineTo(size * 0.62, 0);
        ctx.moveTo(0, -size * 0.62); ctx.lineTo(0, -size * 0.34);
        ctx.moveTo(0, size * 0.34); ctx.lineTo(0, size * 0.62);
        ctx.stroke();
    }
    ctx.restore();
}

function createParticles(count, data, game, token, speed, variant = 'dash') {
    const output = [];
    const random = () => game?.randomValue?.('effects') ?? 0.5;
    for (let index = 0; index < count; index += 1) {
        const angle = random() * Math.PI * 2;
        const magnitude = speed * (0.35 + random() * 0.65);
        const life = 15 + random() * 17;
        output.push({
            x: data.x,
            y: data.y,
            vx: Math.cos(angle) * magnitude,
            vy: Math.sin(angle) * magnitude,
            colorToken: token,
            life,
            maxLife: life,
            radius: variant === 'impact' ? 2.4 + random() * 3.2 : 1.8 + random() * 2.8,
            variant,
            rotation: angle,
            spin: (random() - 0.5) * 0.18
        });
    }
    return output;
}

function healthTextSize(value, radius, minimumFontSize = 18, maximumFontSize = 34) {
    const digits = String(Math.max(0, Math.round(value))).length;
    const scale = digits <= 1 ? 1.00 : (digits === 2 ? 0.86 : (digits === 3 ? 0.70 : 0.57));
    return Math.max(minimumFontSize, Math.min(maximumFontSize, radius * scale));
}

function drawPanel(ctx, x, y, width, height, radius = 7) {
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = 'rgba(248, 246, 241, 0.91)';
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.25;
    ctx.stroke();
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function uiNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Draws a short world-space motion blur for every meaningful movement.
 *
 * Samples remain at their emitted world coordinates when the bot turns. Low
 * speed still produces a compact blur; higher speed increases its lifetime,
 * width, opacity, and therefore apparent length.
 */
function drawWorldSpaceMotionBlur(ctx, bot, game, radius, color) {
    const frame = Math.max(0, Number(game?.frameCount) || 0);
    const fps = Math.max(1, Number(game?.gameConfig?.targetFps) || 60);
    const x = Number(bot.x) || 0;
    const y = Number(bot.y) || 0;
    const vx = Number(bot.vx) || 0;
    const vy = Number(bot.vy) || 0;
    const speed = Math.hypot(vx, vy);
    const speedStrength = clamp01(speed / 4.2);

    let state = bot._beigeGlyphMotionBlur;
    if (!state || frame < state.lastFrame) {
        state = bot._beigeGlyphMotionBlur = {
            points: [],
            lastFrame: frame,
            lastX: x,
            lastY: y
        };
    }

    const moved = Math.hypot(x - state.lastX, y - state.lastY);
    const teleported = moved > Math.max(radius * 3.5, speed * 5.5 + 24);
    if (teleported) state.points.length = 0;

    // Emit for ordinary movement as well as boosted movement. A very small
    // displacement threshold only prevents stationary sub-pixel jitter.
    if (moved >= 0.08) {
        const lifeFrames = Math.max(4, Math.round(fps * (0.075 + speedStrength * 0.12)));
        state.points.push({ x, y, frame, speed, speedStrength, lifeFrames });
    }

    state.points = state.points.filter(point => frame - point.frame <= point.lifeFrames);
    if (state.points.length > 18) state.points.splice(0, state.points.length - 18);

    state.lastFrame = frame;
    state.lastX = x;
    state.lastY = y;

    if (state.points.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 1; index < state.points.length; index += 1) {
        const previous = state.points[index - 1];
        const current = state.points[index];
        const age = frame - current.frame;
        const life = clamp01(1 - age / Math.max(1, current.lifeFrames));
        const movementScale = 0.26 + current.speedStrength * 0.74;
        const strength = life * movementScale;
        if (strength <= 0.01) continue;

        // Soft body-colored smear. It is deliberately continuous rather than a
        // series of faded body copies, so it reads as blur instead of ghosting.
        ctx.shadowColor = alphaColor(color, (0.10 + current.speedStrength * 0.15) * life);
        ctx.shadowBlur = 5 + radius * (0.10 + current.speedStrength * 0.30);
        ctx.strokeStyle = alphaColor(color, (0.055 + current.speedStrength * 0.10) * life);
        ctx.lineWidth = Math.max(3.2, radius * (0.20 + current.speedStrength * 0.52) * (0.68 + life * 0.32));
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(current.x, current.y);
        ctx.stroke();

        // A restrained core keeps slow movement readable against the beige floor.
        ctx.shadowBlur = 0;
        ctx.strokeStyle = alphaColor(color, (0.10 + current.speedStrength * 0.12) * life);
        ctx.lineWidth = Math.max(1.8, radius * (0.075 + current.speedStrength * 0.16));
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(current.x, current.y);
        ctx.stroke();
    }

    ctx.restore();
}

export function createStyle({ options = {} } = {}) {
    const showPowerupLabels = options.showPowerupLabels !== false;
    const showMatchClock = options.showMatchClock !== false;

    return {
        id: 'beige-glyph-2',
        backgroundIsStatic: true,

        getGeometry(kind, entity) {
            if (kind === 'bot') {
                return { shape: 'circle', radius: 21 + Math.pow(Math.max(1, entity.power), 0.32) * 2.25 };
            }
            if (kind === 'food') return { shape: 'circle', radius: 7 };
            if (kind === 'powerup') return { shape: 'circle', radius: 29 };
            if (kind === 'wall') return { shape: 'rect', width: entity.w, height: entity.h, rotation: entity.angle || 0 };
            if (kind === 'projectile') {
                const focused = entity.visualVariant === 'focused';
                const overcharged = entity.visualVariant === 'overcharged';
                return {
                    shape: 'rect',
                    width: overcharged ? 37 : (focused ? 31 : 25),
                    height: overcharged ? 13 : (focused ? 10.5 : 8.5),
                    rotation: entity.angle || 0
                };
            }
            return { shape: 'circle', radius: 1 };
        },

        createEffectParticles(effectName, data, game) {
            if (effectName === 'bot-death') return createParticles(22, data, game, `team:${data.teamId}`, 8.4, 'shard');
            if (effectName === 'bot-hit') return createParticles(11, data, game, `team:${data.bot?.team?.id}`, 6.7, 'impact');
            if (effectName === 'shield-hit') return createParticles(12, data, game, 'shield', 4.8, 'ring');
            if (effectName === 'zone-damage') return createParticles(10, data, game, 'danger', 6.2, 'impact');
            if (effectName === 'powerup-collect') return createParticles(15, data, game, `powerup:${data.powerupId}`, 6.0, 'dot');
            if (effectName === 'projectile-wall') return createParticles(9, data, game, `team:${data.projectile?.team?.id}`, 5.8, 'impact');
            return [];
        },

        getTeamVisual(teamId) {
            return TEAM_VISUALS[teamId] || {
                main: '#707070', light: '#efefef', dark: '#242424', border: '#111111', accent: '#f8f6f1'
            };
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || { color: '#a880fe', label: 'POWER', icon: 'target' };
        },

        styleTeamElement(element, teamId) {
            const visual = this.getTeamVisual(teamId);
            element.style.setProperty('--team-color', visual.main);
            element.style.setProperty('--team-light', visual.light);
            element.style.setProperty('--team-border', visual.border);
            element.style.setProperty('--team-dark', visual.dark);
        },

        applyDocument() {
            document.documentElement.dataset.kineticStyle = 'beige-glyph-2';
        },

        formatStageText() {
            return '';
        },

        formatWinnerText(team) {
            return team ? `${team.label.toUpperCase()} WINS` : 'DRAW';
        },

        drawBackground(ctx, game) {
            ctx.fillStyle = '#e4e1da';
            ctx.fillRect(0, 0, game.width, game.height);

            // Extremely subtle center lift: keeps portrait reels clean while
            // separating the battlefield from the outer damage zone.
            const glow = ctx.createRadialGradient(
                game.width * 0.5,
                game.height * 0.46,
                0,
                game.width * 0.5,
                game.height * 0.46,
                Math.max(game.width, game.height) * 0.62
            );
            glow.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
            glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, game.width, game.height);
        },

        drawZone(ctx, arena, game) {
            const bounds = arena.getBounds();
            const frame = Math.max(0, Number(game?.frameCount) || 0);
            const pulse = 0.5 + 0.5 * Math.sin(frame * 0.11);

            ctx.save();
            if (arena.damageActive) {
                // Tint only the unsafe exterior so the playable area remains clean.
                ctx.beginPath();
                ctx.rect(0, 0, game.width, game.height);
                ctx.rect(bounds.left, bounds.top, bounds.width, bounds.height);
                ctx.fillStyle = `rgba(217, 1, 0, ${0.12 + pulse * 0.035})`;
                ctx.fill('evenodd');

                // Strong solid boundary plus a moving inner dashed warning line.
                ctx.shadowColor = `rgba(217, 1, 0, ${0.32 + pulse * 0.20})`;
                ctx.shadowBlur = 9 + pulse * 5;
                ctx.strokeStyle = '#d90100';
                ctx.lineWidth = 5;
                ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
                ctx.shadowBlur = 0;

                const inset = 8;
                ctx.strokeStyle = `rgba(217, 1, 0, ${0.72 + pulse * 0.22})`;
                ctx.lineWidth = 2.4;
                ctx.setLineDash([15, 9]);
                ctx.lineDashOffset = -frame * 0.55;
                ctx.strokeRect(
                    bounds.left + inset,
                    bounds.top + inset,
                    Math.max(0, bounds.width - inset * 2),
                    Math.max(0, bounds.height - inset * 2)
                );
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = 'rgba(17, 17, 17, 0.27)';
                ctx.lineWidth = 2;
                ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
            }
            ctx.restore();
        },

        drawWall(ctx, wall) {
            const moving = Boolean(wall.motion);

            ctx.save();
            ctx.translate(wall.x, wall.y);
            ctx.rotate(wall.angle || 0);

            ctx.shadowColor = moving ? 'rgba(82, 102, 156, 0.25)' : 'rgba(0, 0, 0, 0.12)';
            ctx.shadowBlur = moving ? 10 : 6;
            ctx.shadowOffsetY = moving ? 1 : 2;

            roundedRectPath(ctx, -wall.w / 2, -wall.h / 2, wall.w, wall.h, 2);
            ctx.fillStyle = moving ? '#b9bbc1' : '#bfb5a3';
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = moving ? '#34415f' : '#111111';
            ctx.lineWidth = moving ? 3.1 : 2.8;
            ctx.stroke();

            if (wall.w > 14 && wall.h > 14) {
                const inset = Math.min(5, wall.w * 0.08, wall.h * 0.08);
                ctx.lineCap = 'round';
                ctx.lineWidth = 1.15;
                ctx.strokeStyle = moving ? 'rgba(255, 255, 255, 0.44)' : 'rgba(255, 255, 255, 0.34)';
                ctx.beginPath();
                ctx.moveTo(-wall.w / 2 + inset, -wall.h / 2 + inset);
                ctx.lineTo(wall.w / 2 - inset, -wall.h / 2 + inset);
                ctx.moveTo(-wall.w / 2 + inset, -wall.h / 2 + inset);
                ctx.lineTo(-wall.w / 2 + inset, wall.h / 2 - inset);
                ctx.stroke();

                ctx.strokeStyle = moving ? 'rgba(52, 65, 95, 0.34)' : 'rgba(17, 17, 17, 0.12)';
                ctx.beginPath();
                ctx.moveTo(-wall.w / 2 + inset, wall.h / 2 - inset);
                ctx.lineTo(wall.w / 2 - inset, wall.h / 2 - inset);
                ctx.stroke();

                // A single restrained center rail distinguishes moving walls without
                // introducing a noisy repeated texture.
                if (moving) {
                    ctx.strokeStyle = 'rgba(52, 65, 95, 0.38)';
                    ctx.lineWidth = 1.4;
                    ctx.setLineDash([7, 7]);
                    ctx.beginPath();
                    if (wall.w >= wall.h) {
                        ctx.moveTo(-wall.w * 0.30, 0);
                        ctx.lineTo(wall.w * 0.30, 0);
                    } else {
                        ctx.moveTo(0, -wall.h * 0.30);
                        ctx.lineTo(0, wall.h * 0.30);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
            ctx.restore();
        },

        drawFood(ctx, food) {
            ctx.save();
            ctx.translate(food.x, food.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#ffd83e';
            ctx.strokeStyle = '#111111';
            ctx.lineWidth = 2.1;
            ctx.beginPath();
            ctx.rect(-food.radius, -food.radius, food.radius * 2, food.radius * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        },

        drawPowerup(ctx, powerup, game) {
            const visual = this.getPowerupVisual(powerup.type);
            const radius = this.getGeometry('powerup', powerup).radius;
            const rotation = Number(powerup.rotation) || 0;
            const pulse = 1 + Math.sin(rotation * 4.2) * 0.04;

            ctx.save();
            ctx.translate(powerup.x, powerup.y);
            ctx.scale(pulse, pulse);

            // Fast rotating segmented orbit. The icon and label remain stationary,
            // preserving immediate recognition while still creating visual energy.
            ctx.save();
            ctx.rotate(rotation * 3.2);
            ctx.strokeStyle = alphaColor(visual.color, 0.72);
            ctx.lineWidth = 2.7;
            ctx.lineCap = 'round';
            for (let index = 0; index < 3; index += 1) {
                const start = index * Math.PI * 2 / 3;
                ctx.beginPath();
                ctx.arc(0, 0, radius + 9, start - 0.36, start + 0.36);
                ctx.stroke();

                const markerAngle = start + 0.45;
                ctx.fillStyle = visual.color;
                ctx.beginPath();
                ctx.arc(
                    Math.cos(markerAngle) * (radius + 9),
                    Math.sin(markerAngle) * (radius + 9),
                    2.3,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
            }
            ctx.restore();

            ctx.shadowColor = alphaColor(visual.color, 0.34);
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#f8f6f1';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = alphaColor(visual.color, powerup.type === 'TURBO' ? 0.17 : 0.10);
            ctx.beginPath();
            ctx.arc(0, 0, radius - 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#111111';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Cleaner broken inner ring creates depth without looking mechanically busy.
            ctx.strokeStyle = visual.color;
            ctx.lineWidth = 5.4;
            ctx.lineCap = 'round';
            for (const start of [-Math.PI * 0.82, Math.PI * 0.18]) {
                ctx.beginPath();
                ctx.arc(0, 0, radius * 0.72, start, start + Math.PI * 0.64);
                ctx.stroke();
            }

            drawPowerupIcon(ctx, powerup.type, 0, 0, radius * 0.66, visual.color);
            ctx.restore();

            if (showPowerupLabels) {
                const labelConfig = game?.gameConfig?.ui?.powerupLabels || {};
                const labelFontSize = uiNumber(labelConfig.fontSize, 18);
                const labelOffsetY = uiNumber(labelConfig.offsetY, 24);
                const labelWeight = uiNumber(labelConfig.fontWeight, 800);
                ctx.save();
                ctx.fillStyle = '#111111';
                ctx.font = `${labelWeight} ${labelFontSize}px ${FONT_STACK}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(visual.label, powerup.x, powerup.y + radius + labelOffsetY);
                ctx.restore();
            }
        },

        drawProjectile(ctx, projectile) {
            const visual = this.getTeamVisual(projectile.team.id);
            const geometry = this.getGeometry('projectile', projectile);
            const angle = Number(projectile.angle) || 0;
            const overcharged = projectile.visualVariant === 'overcharged';
            const focused = projectile.visualVariant === 'focused';
            const trailLength = overcharged ? 52 : (focused ? 41 : 31);
            const tailX = projectile.x - Math.cos(angle) * trailLength;
            const tailY = projectile.y - Math.sin(angle) * trailLength;

            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(17, 17, 17, 0.18)';
            ctx.lineWidth = geometry.height + 3;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.strokeStyle = alphaColor(visual.main, overcharged ? 0.58 : 0.44);
            ctx.lineWidth = Math.max(3.2, geometry.height * 0.55);
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.translate(projectile.x, projectile.y);
            ctx.rotate(angle);
            ctx.shadowColor = alphaColor(visual.main, 0.34);
            ctx.shadowBlur = overcharged ? 12 : 7;
            roundedRectPath(
                ctx,
                -geometry.width / 2,
                -geometry.height / 2,
                geometry.width,
                geometry.height,
                geometry.height / 2
            );
            ctx.fillStyle = visual.main;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#111111';
            ctx.lineWidth = 1.8;
            ctx.stroke();

            roundedRectPath(
                ctx,
                -geometry.width * 0.22,
                -geometry.height * 0.22,
                geometry.width * 0.48,
                geometry.height * 0.44,
                geometry.height * 0.22
            );
            ctx.fillStyle = '#f8f6f1';
            ctx.fill();

            if (focused || overcharged) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(geometry.width * 0.29, 0, Math.max(1.8, geometry.height * 0.18), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        },

        drawParticle(ctx, particle) {
            const maximumLife = Math.max(1, Number(particle.maxLife) || Number(particle.life) || 1);
            const alpha = clamp01((Number(particle.life) || 0) / maximumLife);
            let color = particle.colorToken;
            if (color?.startsWith('team:')) color = this.getTeamVisual(color.slice(5)).main;
            else if (color?.startsWith('powerup:')) color = this.getPowerupVisual(color.slice(8)).color;
            else if (color === 'shield') color = this.getPowerupVisual('AEGIS').color;
            else if (color === 'danger') color = '#d90100';
            color ||= '#111111';

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation || 0);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (particle.variant === 'ring') {
                ctx.shadowColor = alphaColor(color, alpha * 0.42);
                ctx.shadowBlur = 7;
                ctx.strokeStyle = alphaColor('#111111', alpha * 0.50);
                ctx.lineWidth = 4.4;
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius * 2.35, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = alphaColor(color, alpha);
                ctx.lineWidth = 2.4;
                ctx.stroke();
            } else if (particle.variant === 'dot') {
                ctx.shadowColor = alphaColor(color, alpha * 0.48);
                ctx.shadowBlur = 6;
                ctx.fillStyle = alphaColor('#111111', alpha * 0.78);
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius + 1.35, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = alphaColor(color, alpha);
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius, 0, Math.PI * 2);
                ctx.fill();
            } else if (particle.variant === 'impact') {
                const length = particle.radius * 4.8;
                const thickness = Math.max(2.2, particle.radius * 0.92);

                // Dark silhouette guarantees contrast for yellow/gold teams; the
                // colored core and white-hot tip make the event read as a bullet hit.
                ctx.shadowColor = alphaColor(color, alpha * 0.62);
                ctx.shadowBlur = 8;
                ctx.strokeStyle = alphaColor('#111111', alpha * 0.78);
                ctx.lineWidth = thickness + 3.2;
                ctx.beginPath();
                ctx.moveTo(-length * 0.55, 0);
                ctx.lineTo(length * 0.45, 0);
                ctx.stroke();

                ctx.shadowBlur = 0;
                ctx.strokeStyle = alphaColor(color, alpha);
                ctx.lineWidth = thickness;
                ctx.beginPath();
                ctx.moveTo(-length * 0.52, 0);
                ctx.lineTo(length * 0.43, 0);
                ctx.stroke();

                ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.92})`;
                ctx.beginPath();
                ctx.arc(length * 0.28, 0, Math.max(1.4, thickness * 0.34), 0, Math.PI * 2);
                ctx.fill();
            } else {
                const shardScale = particle.variant === 'shard' ? 1.22 : 1;
                roundedRectPath(
                    ctx,
                    -particle.radius * 1.8 * shardScale,
                    -particle.radius * 0.52,
                    particle.radius * 3.6 * shardScale,
                    particle.radius * 1.04,
                    particle.radius * 0.48
                );
                ctx.shadowColor = alphaColor(color, alpha * 0.42);
                ctx.shadowBlur = 6;
                ctx.fillStyle = alphaColor('#111111', alpha * 0.72);
                ctx.fill();
                ctx.shadowBlur = 0;

                roundedRectPath(
                    ctx,
                    -particle.radius * 1.52 * shardScale,
                    -particle.radius * 0.34,
                    particle.radius * 3.04 * shardScale,
                    particle.radius * 0.68,
                    particle.radius * 0.34
                );
                ctx.fillStyle = alphaColor(color, alpha);
                ctx.fill();
            }
            ctx.restore();
        },

        drawBot(ctx, bot, game) {

    const visual = this.getTeamVisual(bot.team.id);
    const radius = this.getGeometry('bot', bot).radius;
    const diameter = radius * 2;
    const health = Math.max(0, Math.round(bot.power));
    const botHealthConfig = game?.gameConfig?.ui?.botHealth || {};
    const fontSize = healthTextSize(
        health,
        radius,
        uiNumber(botHealthConfig.minimumFontSize, 18),
        uiNumber(botHealthConfig.maximumFontSize, 34)
    );

    const vx = Number(bot.vx) || 0;
    const vy = Number(bot.vy) || 0;
    const speed = Math.hypot(vx, vy);
    const frame = game?.frameCount || 0;

    /*
     * MAIN TUNING VARIABLE
     *
     * 0.00 = rendered body exactly follows physics.
     * 0.70 = light jitter filtering.
     * 0.82 = recommended.
     * 0.95 = strong filtering of tiny alternating movements.
     *
     * This never modifies bot.x, bot.y, bot.vx or bot.vy.
     */
    const VISUAL_JITTER_SMOOTHNESS = 1;

    /*
     * Small physics steps below this distance can be visually smoothed.
     * Larger movements increasingly bypass smoothing.
     */
    const jitterStepLimit = Math.max(2, radius * 0.24);

    /*
     * If the visible body falls this far behind the real body, smoothing is
     * completely disabled for that frame and the body catches up immediately.
     */
    const immediateCatchupDistance = Math.max(
        jitterStepLimit * 3.2,
        radius * 0.95
    );

    const frameGap = Number.isFinite(bot._visualRenderFrame)
        ? frame - bot._visualRenderFrame
        : Infinity;

    /*
     * Initialize or reset after a render discontinuity, respawn, style switch,
     * recording seek, or another large interruption.
     */
    if (
        !Number.isFinite(bot._visualX) ||
        !Number.isFinite(bot._visualY) ||
        !Number.isFinite(bot._previousActualX) ||
        !Number.isFinite(bot._previousActualY) ||
        frameGap > 4
    ) {
        bot._visualX = bot.x;
        bot._visualY = bot.y;

        bot._previousActualX = bot.x;
        bot._previousActualY = bot.y;

        bot._previousActualStepX = 0;
        bot._previousActualStepY = 0;
    }

    const actualStepX = bot.x - bot._previousActualX;
    const actualStepY = bot.y - bot._previousActualY;
    const actualStepLength = Math.hypot(actualStepX, actualStepY);

    const previousStepX = Number(bot._previousActualStepX) || 0;
    const previousStepY = Number(bot._previousActualStepY) || 0;
    const previousStepLength = Math.hypot(previousStepX, previousStepY);

    /*
     * Detect tiny movements that cancel the previous movement.
     *
     * Examples:
     *   +3px right, then -3px left
     *   +2px up, then -2px down
     *
     * cancellationRatio approaches:
     *   0 when movements cancel each other;
     *   1 when movements continue consistently.
     */
    const combinedStepLength = Math.hypot(
        actualStepX + previousStepX,
        actualStepY + previousStepY
    );

    const cancellationRatio =
        actualStepLength + previousStepLength > 0.0001
            ? combinedStepLength /
              (actualStepLength + previousStepLength)
            : 1;

    const smallCurrentStep = actualStepLength <= jitterStepLimit;
    const smallPreviousStep = previousStepLength <= jitterStepLimit;

    const isSmallOscillation =
        smallCurrentStep &&
        smallPreviousStep &&
        actualStepLength > 0.01 &&
        previousStepLength > 0.01 &&
        cancellationRatio < 0.68;

    const visualErrorX = bot.x - bot._visualX;
    const visualErrorY = bot.y - bot._visualY;
    const visualErrorDistance = Math.hypot(
        visualErrorX,
        visualErrorY
    );

    const clamp01 = value => Math.max(0, Math.min(1, value));

    const smoothstep = (start, end, value) => {
        if (end <= start) return value >= end ? 1 : 0;

        const t = clamp01((value - start) / (end - start));
        return t * t * (3 - 2 * t);
    };

    let visualFollow;

    /*
     * Large actual movements must remain synchronized with physics.
     *
     * Therefore either a large per-frame movement or a large accumulated
     * visual error bypasses interpolation entirely.
     */
    if (
        visualErrorDistance >= immediateCatchupDistance ||
        actualStepLength >= immediateCatchupDistance
    ) {
        visualFollow = 1;
    } else {
        /*
         * Tiny alternating movement receives much stronger filtering.
         *
         * At smoothness 0.82:
         *   oscillationFollow ≈ 0.23
         *   normalSmallFollow ≈ 0.71
         */
        const oscillationFollow = Math.max(
            0.06,
            1 - VISUAL_JITTER_SMOOTHNESS * 0.94
        );

        const normalSmallFollow = Math.max(
            0.18,
            1 - VISUAL_JITTER_SMOOTHNESS * 0.35
        );

        const baseFollow = isSmallOscillation
            ? oscillationFollow
            : normalSmallFollow;

        /*
         * Gradually remove smoothing as either:
         *
         * 1. the rendered body falls farther from physics, or
         * 2. the actual per-frame movement becomes larger.
         */
        const errorCatchup = smoothstep(
            jitterStepLimit * 0.45,
            immediateCatchupDistance,
            visualErrorDistance
        );

        const movementCatchup = smoothstep(
            jitterStepLimit,
            immediateCatchupDistance,
            actualStepLength
        );

        const catchup = Math.max(errorCatchup, movementCatchup);

        visualFollow =
            baseFollow +
            (1 - baseFollow) * catchup;
    }

    bot._visualX += (bot.x - bot._visualX) * visualFollow;
    bot._visualY += (bot.y - bot._visualY) * visualFollow;

    /*
     * Prevent tiny floating-point movement from continually shaking the body.
     */
    if (Math.abs(bot.x - bot._visualX) < 0.015) {
        bot._visualX = bot.x;
    }

    if (Math.abs(bot.y - bot._visualY) < 0.015) {
        bot._visualY = bot.y;
    }

    const renderX = bot._visualX;
    const renderY = bot._visualY;

    bot._previousActualX = bot.x;
    bot._previousActualY = bot.y;
    bot._previousActualStepX = actualStepX;
    bot._previousActualStepY = actualStepY;
    bot._visualRenderFrame = frame;

    /*
     * WORLD-SPACE CURVED MOTION BLUR
     *
     * The history stores the smoothed rendered position, not the physics
     * position. Therefore the blur remains attached to the visible bot body
     * while collisions and gameplay continue using bot.x and bot.y.
     */
    if (!Array.isArray(bot._motionBlurHistory)) {
        bot._motionBlurHistory = [];
    }

    const history = bot._motionBlurHistory;

    const normalSpeed = Math.max(
        0.01,
        Number(
            bot.baseSpeed ??
            bot.normalSpeed ??
            bot.moveSpeed ??
            game?.gameConfig?.botSpeed ??
            2.6
        ) || 2.6
    );

    const movementThreshold = 0.015;
    const speedRatio = speed / normalSpeed;

    /*
     * At normal speed, the blur extends approximately 1.3 bot diameters.
     */
    const targetTrailLength =
        diameter *
        1.3 *
        Math.max(0.28, Math.min(2.15, speedRatio));

    if (speed > movementThreshold) {
        const lastPoint = history[0];

        const distanceFromLast = lastPoint
            ? Math.hypot(
                renderX - lastPoint.x,
                renderY - lastPoint.y
            )
            : Infinity;

        const sampleDistance = Math.max(1.2, radius * 0.075);

        if (
            !lastPoint ||
            distanceFromLast >= sampleDistance ||
            frame - lastPoint.frame >= 2
        ) {
            history.unshift({
                x: renderX,
                y: renderY,
                frame
            });
        }
    }

    let accumulatedDistance = 0;
    let keepCount = Math.min(history.length, 36);

    for (let index = 1; index < keepCount; index += 1) {
        accumulatedDistance += Math.hypot(
            history[index].x - history[index - 1].x,
            history[index].y - history[index - 1].y
        );

        if (accumulatedDistance >= targetTrailLength) {
            keepCount = index + 1;
            break;
        }
    }

    history.length = keepCount;

    if (
        speed <= movementThreshold &&
        history.length > 0 &&
        frame - history[0].frame > 3
    ) {
        history.length = Math.max(0, history.length - 2);
    }

    if (history.length >= 2 && speed > movementThreshold) {
        const points = [];

        const directionX = speed > 0 ? vx / speed : 1;
        const directionY = speed > 0 ? vy / speed : 0;

        points.push({
            x: renderX - directionX * radius * 0.12,
            y: renderY - directionY * radius * 0.12,
            distance: 0
        });

        let travelled = 0;

        for (
            let index = 1;
            index < history.length;
            index += 1
        ) {
            const previous = history[index - 1];
            const current = history[index];

            const segmentLength = Math.hypot(
                current.x - previous.x,
                current.y - previous.y
            );

            if (segmentLength < 0.001) continue;

            travelled += segmentLength;

            if (travelled > targetTrailLength) {
                const overflow = travelled - targetTrailLength;
                const usableLength = segmentLength - overflow;
                const ratio = Math.max(
                    0,
                    usableLength / segmentLength
                );

                points.push({
                    x:
                        previous.x +
                        (current.x - previous.x) * ratio,
                    y:
                        previous.y +
                        (current.y - previous.y) * ratio,
                    distance: targetTrailLength
                });

                break;
            }

            points.push({
                x: current.x,
                y: current.y,
                distance: travelled
            });
        }

        if (points.length >= 2) {
            const startHalfWidth = radius * 0.9;

            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.globalCompositeOperation = 'source-over';

            for (
                let index = points.length - 2;
                index >= 0;
                index -= 1
            ) {
                const current = points[index];
                const next = points[index + 1];

                const currentProgress = Math.min(
                    1,
                    current.distance /
                        Math.max(1, targetTrailLength)
                );

                const nextProgress = Math.min(
                    1,
                    next.distance /
                        Math.max(1, targetTrailLength)
                );

                const currentHalfWidth =
                    startHalfWidth *
                    Math.pow(1 - currentProgress, 1.18);

                const nextHalfWidth =
                    startHalfWidth *
                    Math.pow(1 - nextProgress, 1.18);

                const previousPoint =
                    points[Math.max(0, index - 1)];

                const followingPoint =
                    points[
                        Math.min(
                            points.length - 1,
                            index + 2
                        )
                    ];

                let currentTangentX =
                    next.x - previousPoint.x;

                let currentTangentY =
                    next.y - previousPoint.y;

                let currentTangentLength =
                    Math.hypot(
                        currentTangentX,
                        currentTangentY
                    ) || 1;

                currentTangentX /= currentTangentLength;
                currentTangentY /= currentTangentLength;

                let nextTangentX =
                    followingPoint.x - current.x;

                let nextTangentY =
                    followingPoint.y - current.y;

                let nextTangentLength =
                    Math.hypot(
                        nextTangentX,
                        nextTangentY
                    ) || 1;

                nextTangentX /= nextTangentLength;
                nextTangentY /= nextTangentLength;

                const currentNormalX = -currentTangentY;
                const currentNormalY = currentTangentX;
                const nextNormalX = -nextTangentY;
                const nextNormalY = nextTangentX;

                const currentAlpha =
                    0.70 - currentProgress * 0.30;

                const nextAlpha =
                    0.70 - nextProgress * 0.30;

                const segmentAlpha =
                    (currentAlpha + nextAlpha) * 0.5;

                ctx.fillStyle = alphaColor(
                    visual.main,
                    segmentAlpha
                );

                ctx.beginPath();

                ctx.moveTo(
                    current.x +
                        currentNormalX * currentHalfWidth,
                    current.y +
                        currentNormalY * currentHalfWidth
                );

                ctx.lineTo(
                    next.x + nextNormalX * nextHalfWidth,
                    next.y + nextNormalY * nextHalfWidth
                );

                ctx.lineTo(
                    next.x - nextNormalX * nextHalfWidth,
                    next.y - nextNormalY * nextHalfWidth
                );

                ctx.lineTo(
                    current.x -
                        currentNormalX * currentHalfWidth,
                    current.y -
                        currentNormalY * currentHalfWidth
                );

                ctx.closePath();
                ctx.fill();
            }

            ctx.globalAlpha = 0.16;
            ctx.strokeStyle = visual.light;
            ctx.lineWidth = Math.max(2, radius * 0.18);

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            for (
                let index = 1;
                index < points.length - 1;
                index += 1
            ) {
                const current = points[index];
                const next = points[index + 1];

                ctx.quadraticCurveTo(
                    current.x,
                    current.y,
                    (current.x + next.x) * 0.5,
                    (current.y + next.y) * 0.5
                );
            }

            const finalPoint = points[points.length - 1];
            ctx.lineTo(finalPoint.x, finalPoint.y);
            ctx.stroke();

            ctx.restore();
        }
    }

    /*
     * VISIBLE BOT BODY
     *
     * Only this rendered position is smoothed. Physics remains at bot.x/bot.y.
     */
    ctx.save();
    ctx.translate(renderX, renderY);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = visual.main;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 3.2;
    ctx.stroke();

    ctx.fillStyle = visual.accent;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.67, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(17, 17, 17, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#111111';
    ctx.font = `850 ${fontSize}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(health), 0, 0.5);

    ctx.restore();

    /*
     * Power-up indicators use the rendered position so they remain attached
     * to the visually smoothed bot.
     */
    const effects = (bot.activePowerups || []).slice(0, 2);

    effects.forEach((effect, index) => {
        const color = this.getPowerupVisual(effect.id).color;
        const ringRadius = radius + 9 + index * 8;
        const direction = index === 0 ? 1 : -1;

        const rotation =
            frame * 0.065 * direction +
            index * Math.PI * 0.42;

        const arcLength = index === 0 ? 0.72 : 0.54;

        ctx.save();
        ctx.translate(renderX, renderY);
        ctx.rotate(rotation);

        ctx.strokeStyle = alphaColor(
            color,
            index === 0 ? 0.88 : 0.70
        );

        ctx.lineWidth = index === 0 ? 3 : 2.3;
        ctx.lineCap = 'round';

        for (const offset of [0, Math.PI]) {
            ctx.beginPath();
            ctx.arc(
                0,
                0,
                ringRadius,
                offset - arcLength,
                offset + arcLength
            );
            ctx.stroke();
        }

        ctx.restore();
    });
},

        drawDisplayText(ctx, game, config) {
            const text = String(config?.text || '').trim();
            if (!text) return;

            const fps = Math.max(1, Number(game.gameConfig.targetFps) || 60);
            const frame = Math.max(0, Number(game.frameCount) || 0);
            const start = Math.max(0, Number(config.startSeconds) || 0) * fps;
            const endSeconds = Number(config.endSeconds) || 0;
            const end = endSeconds > 0 ? endSeconds * fps : Infinity;
            if (frame < start || frame > end) return;

            const charactersPerSecond = Math.max(
                1,
                Number(config.typewriterCharactersPerSecond ?? config.charactersPerSecond) || 15
            );
            const framesPerCharacter = Math.max(1, fps / charactersPerSecond);
            const elapsed = Math.max(0, frame - start);
            const introCount = Math.min(text.length, Math.max(1, Math.ceil((elapsed + 1) / framesPerCharacter)));

            let visibleCount = introCount;
            let alpha = 1;
            if (Number.isFinite(end)) {
                const remaining = Math.max(0, end - frame);
                const eraseFrames = text.length * framesPerCharacter;
                if (remaining < eraseFrames) {
                    // Reverse typewriter: ABC -> AB -> A, with every intermediate
                    // string independently centered at the configured x position.
                    const eraseCount = Math.min(text.length, Math.max(0, Math.ceil(remaining / framesPerCharacter)));
                    visibleCount = Math.min(introCount, eraseCount);
                    alpha = clamp01(remaining / Math.max(1, framesPerCharacter * 0.85));
                }
            }

            if (visibleCount <= 0) return;
            const visibleText = text.slice(0, visibleCount);
            const baseX = Number.isFinite(Number(config.x)) ? Number(config.x) : game.width * 0.5;
            const y = Number.isFinite(Number(config.y)) ? Number(config.y) : game.height * 0.36;
            const textUi = game.gameConfig.ui?.displayText || {};
            const minimumFontSize = uiNumber(textUi.minimumFontSize, 34);
            const maximumFontSize = uiNumber(textUi.maximumFontSize, 60);
            const configuredFontSize = uiNumber(textUi.fontSize, 54);
            const fontSize = Math.max(minimumFontSize, Math.min(maximumFontSize, configuredFontSize));
            const panelPaddingX = uiNumber(textUi.panelPaddingX, 58);
            const panelHeightScale = uiNumber(textUi.panelHeightScale, 1.58);
            const maxWidth = game.width * 0.82;

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `760 ${fontSize}px ${DISPLAY_FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Width follows the currently typed substring, so A, AB and ABC remain
            // centered while naturally expanding and contracting around the midpoint.
            const measuredWidth = ctx.measureText(visibleText).width;
            const panelWidth = Math.min(maxWidth, Math.max(fontSize * 1.32, measuredWidth + panelPaddingX));
            drawPanel(
                ctx,
                baseX - panelWidth / 2,
                y - fontSize * panelHeightScale / 2,
                panelWidth,
                fontSize * panelHeightScale,
                8
            );

            ctx.fillStyle = '#111111';
            ctx.fillText(visibleText, baseX, y, maxWidth - 14);
            ctx.restore();
        },

        drawOverlay(ctx, game) {
            if (!showMatchClock) return;
            const remainingFrames = Math.max(0, game.match.maxFrames - game.frameCount);
            const remainingSeconds = Math.ceil(remainingFrames / game.gameConfig.targetFps);
            const ratio = Math.max(0, Math.min(1, remainingFrames / game.match.maxFrames));
            const clockConfig = game.gameConfig.ui?.matchClock || {};
            const boxWidth = uiNumber(clockConfig.boxWidth, 226);
            const boxHeight = uiNumber(clockConfig.boxHeight, 66);
            const fontSize = uiNumber(clockConfig.fontSize, 35);
            const y = uiNumber(clockConfig.y, 28);
            const textY = uiNumber(clockConfig.textY, 27);
            const progressY = y + uiNumber(clockConfig.progressY, 49);
            const progressHeight = uiNumber(clockConfig.progressHeight, 8);
            const x = game.width / 2 - boxWidth / 2;

            ctx.save();
            drawPanel(ctx, x, y, boxWidth, boxHeight, 7);
            ctx.fillStyle = '#111111';
            ctx.font = `850 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${remainingSeconds}s`, game.width / 2, y + textY);

            const progressX = x + 15;
            const progressWidth = boxWidth - 30;
            roundedRectPath(ctx, progressX, progressY, progressWidth, progressHeight, progressHeight / 2);
            ctx.fillStyle = 'rgba(17, 17, 17, 0.13)';
            ctx.fill();
            roundedRectPath(
                ctx,
                progressX,
                progressY,
                Math.max(3, progressWidth * ratio),
                progressHeight,
                progressHeight / 2
            );
            ctx.fillStyle = ratio > 0.5 ? '#097e5c' : (ratio > 0.2 ? '#ffd83e' : '#d90100');
            ctx.fill();
            ctx.restore();
        },

        drawClimaxRing(ctx, game, radius, alpha, team) {
            ctx.save();
            ctx.strokeStyle = alphaColor(this.getTeamVisual(team.id).main, alpha);
            ctx.lineWidth = 8;
            ctx.setLineDash([8, 12]);
            ctx.beginPath();
            ctx.arc(game.arena.centerX, game.arena.centerY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    };
}