const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({ main: '#3b76ff', light: '#93b4ff', dark: '#183a91', border: '#07090e', accent: '#141822' }),
    magenta: Object.freeze({ main: '#ff2a42', light: '#ff99a4', dark: '#7a0000', border: '#07090e', accent: '#141822' }),
    gold: Object.freeze({ main: '#ffdd47', light: '#ffef99', dark: '#7a6504', border: '#07090e', accent: '#141822' }),
    lime: Object.freeze({ main: '#10b981', light: '#6ee7b7', dark: '#054d38', border: '#07090e', accent: '#141822' })
});

const FONT_STACK = '"Aptos", "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DISPLAY_FONT_STACK = '"Aptos Display", "Avenir Next", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Vibrant powerup palette tuned for high contrast against a dark slate arena.
const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ff944d', label: 'POWER', icon: 'bolt' }),
    AEGIS: Object.freeze({ color: '#26d6ea', label: 'SHIELD', icon: 'shield' }),
    TURBO: Object.freeze({ color: '#3b82f6', label: 'SPEED', icon: 'turbo' }),
    REGEN: Object.freeze({ color: '#54d66b', label: 'HEAL', icon: 'plus' }),
    FOCUS: Object.freeze({ color: '#b694ff', label: 'AIM', icon: 'target' })
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
    ctx.fillStyle = 'rgba(20, 24, 34, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
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

        ctx.shadowColor = alphaColor(color, (0.14 + current.speedStrength * 0.20) * life);
        ctx.shadowBlur = 5 + radius * (0.10 + current.speedStrength * 0.30);
        ctx.strokeStyle = alphaColor(color, (0.08 + current.speedStrength * 0.14) * life);
        ctx.lineWidth = Math.max(3.2, radius * (0.20 + current.speedStrength * 0.52) * (0.68 + life * 0.32));
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(current.x, current.y);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = alphaColor(color, (0.14 + current.speedStrength * 0.16) * life);
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
                main: '#9ca3af', light: '#e5e7eb', dark: '#374151', border: '#07090e', accent: '#141822'
            };
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || { color: '#b694ff', label: 'POWER', icon: 'target' };
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
            ctx.fillStyle = '#0c0e14';
            ctx.fillRect(0, 0, game.width, game.height);

            // Subtle slate-blue center lift separates the playable arena from the dark exterior.
            const glow = ctx.createRadialGradient(
                game.width * 0.5,
                game.height * 0.46,
                0,
                game.width * 0.5,
                game.height * 0.46,
                Math.max(game.width, game.height) * 0.62
            );
            glow.addColorStop(0, 'rgba(56, 72, 110, 0.16)');
            glow.addColorStop(1, 'rgba(12, 14, 20, 0)');
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
                ctx.fillStyle = `rgba(255, 42, 66, ${0.14 + pulse * 0.05})`;
                ctx.fill('evenodd');

                // Strong solid boundary plus a moving inner dashed warning line.
                ctx.shadowColor = `rgba(255, 42, 66, ${0.42 + pulse * 0.24})`;
                ctx.shadowBlur = 11 + pulse * 6;
                ctx.strokeStyle = '#ff2a42';
                ctx.lineWidth = 5;
                ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
                ctx.shadowBlur = 0;

                const inset = 8;
                ctx.strokeStyle = `rgba(255, 90, 110, ${0.75 + pulse * 0.22})`;
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
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
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

            ctx.shadowColor = moving ? 'rgba(59, 130, 246, 0.28)' : 'rgba(0, 0, 0, 0.55)';
            ctx.shadowBlur = moving ? 12 : 8;
            ctx.shadowOffsetY = moving ? 1 : 2;

            roundedRectPath(ctx, -wall.w / 2, -wall.h / 2, wall.w, wall.h, 2);
            ctx.fillStyle = moving ? '#283246' : '#1b202c';
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = moving ? '#60a5fa' : '#384152';
            ctx.lineWidth = moving ? 3.1 : 2.8;
            ctx.stroke();

            if (wall.w > 14 && wall.h > 14) {
                const inset = Math.min(5, wall.w * 0.08, wall.h * 0.08);
                ctx.lineCap = 'round';
                ctx.lineWidth = 1.15;
                ctx.strokeStyle = moving ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.12)';
                ctx.beginPath();
                ctx.moveTo(-wall.w / 2 + inset, -wall.h / 2 + inset);
                ctx.lineTo(wall.w / 2 - inset, -wall.h / 2 + inset);
                ctx.moveTo(-wall.w / 2 + inset, -wall.h / 2 + inset);
                ctx.lineTo(-wall.w / 2 + inset, wall.h / 2 - inset);
                ctx.stroke();

                ctx.strokeStyle = moving ? 'rgba(15, 23, 42, 0.65)' : 'rgba(0, 0, 0, 0.48)';
                ctx.beginPath();
                ctx.moveTo(-wall.w / 2 + inset, wall.h / 2 - inset);
                ctx.lineTo(wall.w / 2 - inset, wall.h / 2 - inset);
                ctx.stroke();

                if (moving) {
                    ctx.strokeStyle = 'rgba(147, 197, 253, 0.45)';
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
            ctx.shadowColor = 'rgba(255, 221, 71, 0.28)';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#ffdd4788';
            ctx.strokeStyle = '#07090e';
            ctx.lineWidth = 2.1;
            ctx.beginPath();
            ctx.rect(-food.radius*0.8, -food.radius*0.8, food.radius * 2*0.8, food.radius * 2*0.8);
            ctx.fill();
            ctx.shadowBlur = 0;
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

            // Fast rotating segmented orbit.
            ctx.save();
            ctx.rotate(rotation * 3.2);
            ctx.strokeStyle = alphaColor(visual.color, 0.82);
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

            ctx.shadowColor = alphaColor(visual.color, 0.45);
            ctx.shadowBlur = 14;
            ctx.fillStyle = '#141822';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = alphaColor(visual.color, powerup.type === 'TURBO' ? 0.22 : 0.15);
            ctx.beginPath();
            ctx.arc(0, 0, radius - 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Broken inner ring.
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
                ctx.font = `${labelWeight} ${labelFontSize}px ${FONT_STACK}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'rgba(7, 9, 14, 0.85)';
                ctx.lineWidth = 4;
                ctx.lineJoin = 'round';
                ctx.strokeText(visual.label, powerup.x, powerup.y + radius + labelOffsetY);
                ctx.fillStyle = '#f3f4f6';
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
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.lineWidth = geometry.height + 3;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.strokeStyle = alphaColor(visual.main, overcharged ? 0.68 : 0.52);
            ctx.lineWidth = Math.max(3.2, geometry.height * 0.55);
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.translate(projectile.x, projectile.y);
            ctx.rotate(angle);
            ctx.shadowColor = alphaColor(visual.main, 0.5);
            ctx.shadowBlur = overcharged ? 14 : 8;
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
            ctx.strokeStyle = '#07090e';
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
            ctx.fillStyle = '#f8fafc';
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
            else if (color === 'danger') color = '#ff2a42';
            color ||= '#f3f4f6';

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation || 0);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (particle.variant === 'ring') {
                ctx.shadowColor = alphaColor(color, alpha * 0.55);
                ctx.shadowBlur = 8;
                ctx.strokeStyle = alphaColor('#05070b', alpha * 0.65);
                ctx.lineWidth = 4.4;
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius * 2.35, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = alphaColor(color, alpha);
                ctx.lineWidth = 2.4;
                ctx.stroke();
            } else if (particle.variant === 'dot') {
                ctx.shadowColor = alphaColor(color, alpha * 0.58);
                ctx.shadowBlur = 7;
                ctx.fillStyle = alphaColor('#05070b', alpha * 0.82);
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

                ctx.shadowColor = alphaColor(color, alpha * 0.7);
                ctx.shadowBlur = 9;
                ctx.strokeStyle = alphaColor('#05070b', alpha * 0.82);
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
                ctx.shadowColor = alphaColor(color, alpha * 0.52);
                ctx.shadowBlur = 7;
                ctx.fillStyle = alphaColor('#05070b', alpha * 0.78);
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

            const VISUAL_JITTER_SMOOTHNESS = 1;
            const jitterStepLimit = Math.max(2, radius * 0.24);
            const immediateCatchupDistance = Math.max(
                jitterStepLimit * 3.2,
                radius * 0.95
            );

            const frameGap = Number.isFinite(bot._visualRenderFrame)
                ? frame - bot._visualRenderFrame
                : Infinity;

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

            const combinedStepLength = Math.hypot(
                actualStepX + previousStepX,
                actualStepY + previousStepY
            );

            const cancellationRatio =
                actualStepLength + previousStepLength > 0.0001
                    ? combinedStepLength / (actualStepLength + previousStepLength)
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
            const visualErrorDistance = Math.hypot(visualErrorX, visualErrorY);

            const smoothstep = (start, end, value) => {
                if (end <= start) return value >= end ? 1 : 0;
                const t = clamp01((value - start) / (end - start));
                return t * t * (3 - 2 * t);
            };

            let visualFollow;

            if (
                visualErrorDistance >= immediateCatchupDistance ||
                actualStepLength >= immediateCatchupDistance
            ) {
                visualFollow = 1;
            } else {
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

                visualFollow = baseFollow + (1 - baseFollow) * catchup;
            }

            bot._visualX += (bot.x - bot._visualX) * visualFollow;
            bot._visualY += (bot.y - bot._visualY) * visualFollow;

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

                for (let index = 1; index < history.length; index += 1) {
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
                        const ratio = Math.max(0, usableLength / segmentLength);

                        points.push({
                            x: previous.x + (current.x - previous.x) * ratio,
                            y: previous.y + (current.y - previous.y) * ratio,
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

                    for (let index = points.length - 2; index >= 0; index -= 1) {
                        const current = points[index];
                        const next = points[index + 1];

                        const currentProgress = Math.min(
                            1,
                            current.distance / Math.max(1, targetTrailLength)
                        );

                        const nextProgress = Math.min(
                            1,
                            next.distance / Math.max(1, targetTrailLength)
                        );

                        const currentHalfWidth =
                            startHalfWidth * Math.pow(1 - currentProgress, 1.18);

                        const nextHalfWidth =
                            startHalfWidth * Math.pow(1 - nextProgress, 1.18);

                        const previousPoint = points[Math.max(0, index - 1)];
                        const followingPoint = points[Math.min(points.length - 1, index + 2)];

                        let currentTangentX = next.x - previousPoint.x;
                        let currentTangentY = next.y - previousPoint.y;
                        let currentTangentLength = Math.hypot(currentTangentX, currentTangentY) || 1;
                        currentTangentX /= currentTangentLength;
                        currentTangentY /= currentTangentLength;

                        let nextTangentX = followingPoint.x - current.x;
                        let nextTangentY = followingPoint.y - current.y;
                        let nextTangentLength = Math.hypot(nextTangentX, nextTangentY) || 1;
                        nextTangentX /= nextTangentLength;
                        nextTangentY /= nextTangentLength;

                        const currentNormalX = -currentTangentY;
                        const currentNormalY = currentTangentX;
                        const nextNormalX = -nextTangentY;
                        const nextNormalY = nextTangentX;

                        const currentAlpha = 0.65 - currentProgress * 0.35;
                        const nextAlpha = 0.65 - nextProgress * 0.35;
                        const segmentAlpha = (currentAlpha + nextAlpha) * 0.5;

                        ctx.fillStyle = alphaColor(visual.main, segmentAlpha);

                        ctx.beginPath();
                        ctx.moveTo(
                            current.x + currentNormalX * currentHalfWidth,
                            current.y + currentNormalY * currentHalfWidth
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
                            current.x - currentNormalX * currentHalfWidth,
                            current.y - currentNormalY * currentHalfWidth
                        );
                        ctx.closePath();
                        ctx.fill();
                    }

                    ctx.globalAlpha = 0.22;
                    ctx.strokeStyle = visual.light;
                    ctx.lineWidth = Math.max(2, radius * 0.18);

                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);

                    for (let index = 1; index < points.length - 1; index += 1) {
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
             */
            ctx.save();
            ctx.translate(renderX, renderY);

            ctx.shadowColor = alphaColor(visual.main, 0.35);
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 2;

            ctx.fillStyle = visual.main;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = visual.border;
            ctx.lineWidth = 3.2;
            ctx.stroke();

            ctx.fillStyle = visual.accent;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.67, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.font = `850 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(health), 0, 0.5);

            ctx.restore();

            /*
             * Power-up indicators
             */
            const effects = (bot.activePowerups || []).slice(0, 2);

            effects.forEach((effect, index) => {
                const color = this.getPowerupVisual(effect.id).color;
                const ringRadius = radius + 9 + index * 8;
                const direction = index === 0 ? 1 : -1;

                const rotation =
                    frame * 0.065 * direction +
                    index * Math.PI * 0.42;

                const arcLength = 0.1;

                ctx.save();
                //ctx.translate(renderX, renderY);
                //ctx.rotate(rotation);

                ctx.strokeStyle = alphaColor(
                    color,
                    index === 0 ? 0.92 : 0.76
                );

                ctx.lineWidth = index === 0 ? 3 : 2.3;
                ctx.lineCap = 'round';

                ctx.translate(bot.x, bot.y);
                ctx.rotate(performance.now() / 150);
                ctx.beginPath();
                ctx.lineWidth = 3;
                ctx.strokeStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
                ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
                ctx.setLineDash([3, 7]);
                ctx.stroke();

                ctx.restore();
            });
            // const auras = [
            //     [bot.overchargeTimer, this.getPowerupVisual('OVERCHARGE').color, 8],
            //     [bot.shieldTimer, this.getPowerupVisual('AEGIS').color, 11],
            //     [bot.turboTimer, this.getPowerupVisual('TURBO').color, 4],
            //     [bot.regenTimer, this.getPowerupVisual('REGEN').color, 2],
            //     [bot.activePowerups.find(effect => effect.id === 'FOCUS')?.remainingFrames || 0, this.getPowerupVisual('FOCUS').color, 8]
            // ];
            // for (const [timer, color, offset] of auras) {
            //     if (timer <= 0) continue;
            //     ctx.save();
            //     ctx.translate(bot.x, bot.y);
            //     ctx.rotate(performance.now() / 150);
            //     ctx.beginPath();
            //     ctx.arc(0, 0, bot.radius + offset, 0, Math.PI * 2);
            //     ctx.setLineDash([3, 7]);
            //     ctx.lineWidth = 3;
            //     ctx.strokeStyle = color;
            //     ctx.shadowColor = color;
            //     ctx.shadowBlur = 8;
            //     ctx.stroke();
            //     ctx.restore();
            // }

            // ctx.save();
            // ctx.fillStyle = '#ffffff';
            // ctx.font = `bold ${Math.max(16, bot.radius * 0.8)}px ui-monospace, monospace`;
            // ctx.textAlign = 'center';
            // ctx.textBaseline = 'middle';
            // ctx.fillText(Math.floor(bot.power), bot.x, bot.y + 1);
            // ctx.restore();
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

            ctx.fillStyle = '#f8fafc';
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
            // drawPanel(ctx, x, y, boxWidth, boxHeight, 7);
            // ctx.fillStyle = '#f8fafc';
            // ctx.font = `850 ${fontSize}px ${FONT_STACK}`;
            // ctx.textAlign = 'center';
            // ctx.textBaseline = 'middle';
            // ctx.fillText(`${remainingSeconds}s`, game.width / 2, y + textY);

            // const progressX = x + 15;
            // const progressWidth = boxWidth - 30;
            // roundedRectPath(ctx, progressX, progressY, progressWidth, progressHeight, progressHeight / 2);
            // ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            // ctx.fill();
            // roundedRectPath(
            //     ctx,
            //     progressX,
            //     progressY,
            //     Math.max(3, progressWidth * ratio),
            //     progressHeight,
            //     progressHeight / 2
            // );
            // ctx.fillStyle = ratio > 0.5 ? '#10b981' : (ratio > 0.2 ? '#ffdd47' : '#ff2a42');
            // ctx.fill();
            // ctx.restore();
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