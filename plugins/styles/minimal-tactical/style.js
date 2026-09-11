const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({ main: '#2ea7ff', light: '#bfe7ff', dark: '#08375d', border: 'rgba(46, 167, 255, 0.48)', symbol: '●' }),
    magenta: Object.freeze({ main: '#ff4fa3', light: '#ffd0e6', dark: '#68113d', border: 'rgba(255, 79, 163, 0.48)', symbol: '●' }),
    gold: Object.freeze({ main: '#ffd43b', light: '#fff1a8', dark: '#614b00', border: 'rgba(255, 212, 59, 0.5)', symbol: '●' }),
    lime: Object.freeze({ main: '#58d568', light: '#c8f6ce', dark: '#164c20', border: 'rgba(88, 213, 104, 0.48)', symbol: '●' })
});

const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif';

const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ff8a3d', label: 'POWER', icon: 'bolt' }),
    AEGIS: Object.freeze({ color: '#26c6da', label: 'SHIELD', icon: 'shield' }),
    TURBO: Object.freeze({ color: '#ffd43b', label: 'SPEED', icon: 'turbo' }),
    REGEN: Object.freeze({ color: '#54d66b', label: 'HEAL', icon: 'plus' }),
    FOCUS: Object.freeze({ color: '#a78bfa', label: 'AIM', icon: 'target' })
});

function alphaColor(hex, alpha) {
    const clean = hex.replace('#', '');
    const value = Number.parseInt(clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
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
    ctx.lineWidth = Math.max(3, size * 0.11);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const icon = POWERUP_VISUALS[type]?.icon;
    if (icon === 'bolt') {
        ctx.beginPath();
        ctx.moveTo(size * 0.08, -size * 0.58);
        ctx.lineTo(-size * 0.34, size * 0.02);
        ctx.lineTo(-size * 0.02, size * 0.02);
        ctx.lineTo(-size * 0.12, size * 0.58);
        ctx.lineTo(size * 0.38, -size * 0.12);
        ctx.lineTo(size * 0.05, -size * 0.12);
        ctx.closePath();
        ctx.fill();
    } else if (icon === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.55);
        ctx.lineTo(size * 0.48, -size * 0.33);
        ctx.lineTo(size * 0.38, size * 0.24);
        ctx.quadraticCurveTo(0, size * 0.6, 0, size * 0.6);
        ctx.quadraticCurveTo(0, size * 0.6, -size * 0.38, size * 0.24);
        ctx.lineTo(-size * 0.48, -size * 0.33);
        ctx.closePath();
        ctx.stroke();
    } else if (icon === 'turbo') {
        for (const offset of [-size * 0.18, size * 0.18]) {
            ctx.beginPath();
            ctx.moveTo(-size * 0.42 + offset, -size * 0.42);
            ctx.lineTo(size * 0.05 + offset, 0);
            ctx.lineTo(-size * 0.42 + offset, size * 0.42);
            ctx.stroke();
        }
    } else if (icon === 'plus') {
        ctx.fillRect(-size * 0.12, -size * 0.52, size * 0.24, size * 1.04);
        ctx.fillRect(-size * 0.52, -size * 0.12, size * 1.04, size * 0.24);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.44, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.13, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-size * 0.65, 0);
        ctx.lineTo(-size * 0.35, 0);
        ctx.moveTo(size * 0.35, 0);
        ctx.lineTo(size * 0.65, 0);
        ctx.moveTo(0, -size * 0.65);
        ctx.lineTo(0, -size * 0.35);
        ctx.moveTo(0, size * 0.35);
        ctx.lineTo(0, size * 0.65);
        ctx.stroke();
    }
    ctx.restore();
}

function createParticles(count, data, game, token, speed, variant = 'dot') {
    const output = [];
    const random = () => game?.randomValue?.('effects') ?? 0.5;
    for (let index = 0; index < count; index += 1) {
        const angle = random() * Math.PI * 2;
        const magnitude = speed * (0.35 + random() * 0.65);
        output.push({
            x: data.x,
            y: data.y,
            vx: Math.cos(angle) * magnitude,
            vy: Math.sin(angle) * magnitude,
            colorToken: token,
            life: 18 + random() * 18,
            radius: 2 + random() * 3,
            variant,
            rotation: angle,
            spin: (random() - 0.5) * 0.22
        });
    }
    return output;
}

function healthTextSize(value, radius) {
    const digits = String(Math.max(0, Math.round(value))).length;
    const scale = digits <= 1 ? 1.02 : (digits === 2 ? 0.88 : (digits === 3 ? 0.70 : 0.58));
    return Math.max(13, Math.min(30, radius * scale));
}

export function createStyle({ config, options = {} } = {}) {
    const showPowerupLabels = options.showPowerupLabels !== false;
    const showMatchClock = options.showMatchClock !== false;

    return {
        id: 'minimal-tactical',
        backgroundIsStatic: true,

        getGeometry(kind, entity) {
            if (kind === 'bot') {
                return {
                    shape: 'circle',
                    radius: 21 + Math.pow(Math.max(1, entity.power), 0.32) * 2.25
                };
            }
            if (kind === 'food') return { shape: 'circle', radius: 7 };
            if (kind === 'powerup') return { shape: 'circle', radius: 30 };
            if (kind === 'wall') return { shape: 'rect', width: entity.w, height: entity.h, rotation: entity.angle || 0 };
            if (kind === 'projectile') {
                const focused = entity.visualVariant === 'focused';
                const overcharged = entity.visualVariant === 'overcharged';
                return {
                    shape: 'rect',
                    width: overcharged ? 34 : (focused ? 30 : 24),
                    height: overcharged ? 12 : (focused ? 10 : 8),
                    rotation: entity.angle || 0
                };
            }
            return { shape: 'circle', radius: 1 };
        },

        createEffectParticles(effectName, data, game) {
            if (effectName === 'bot-death') return createParticles(18, data, game, `team:${data.teamId}`, 8, 'dash');
            if (effectName === 'bot-hit') return createParticles(7, data, game, `team:${data.bot?.team?.id}`, 5.2, 'dash');
            if (effectName === 'shield-hit') return createParticles(10, data, game, 'shield', 4, 'ring');
            if (effectName === 'zone-damage') return createParticles(9, data, game, 'danger', 5, 'dash');
            if (effectName === 'powerup-collect') return createParticles(12, data, game, `powerup:${data.powerupId}`, 5.8, 'dash');
            if (effectName === 'projectile-wall') return createParticles(6, data, game, `team:${data.projectile?.team?.id}`, 4.2, 'dash');
            return [];
        },

        getTeamVisual(teamId) {
            return TEAM_VISUALS[teamId] || { main: '#e2e8f0', light: '#ffffff', dark: '#1e293b', border: 'rgba(226,232,240,0.3)' };
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || { color: '#e2e8f0', label: 'POWER', icon: 'target' };
        },

        styleTeamElement(element, teamId) {
            const visual = this.getTeamVisual(teamId);
            element.style.setProperty('--team-color', visual.main);
            element.style.setProperty('--team-light', visual.light);
            element.style.setProperty('--team-border', visual.border);
            element.style.setProperty('--team-dark', visual.dark);
        },

        applyDocument() {
            document.documentElement.dataset.kineticStyle = 'minimal-tactical';
        },

        formatStageText() {
            return '';
        },

        formatWinnerText(team) {
            return team ? `${team.label.toUpperCase()} WINS` : 'DRAW';
        },

        drawBackground(ctx, game) {
            const gradient = ctx.createLinearGradient(0, 0, 0, game.height);
            gradient.addColorStop(0, '#102238');
            gradient.addColorStop(0.5, '#0d1b2d');
            gradient.addColorStop(1, '#102238');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, game.width, game.height);

            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
            ctx.lineWidth = 1;
            const spacing = 96;
            for (let x = 0; x <= game.width; x += spacing) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, game.height);
                ctx.stroke();
            }
            for (let y = 0; y <= game.height; y += spacing) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(game.width, y);
                ctx.stroke();
            }


            ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(game.arena.centerX, game.arena.centerY, 72, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(game.arena.centerX - 24, game.arena.centerY);
            ctx.lineTo(game.arena.centerX + 24, game.arena.centerY);
            ctx.moveTo(game.arena.centerX, game.arena.centerY - 24);
            ctx.lineTo(game.arena.centerX, game.arena.centerY + 24);
            ctx.stroke();
            ctx.restore();
        },

        drawZone(ctx, arena, game) {
            const bounds = arena.getBounds();
            ctx.save();

            ctx.beginPath();
            ctx.rect(0, 0, game.width, game.height);
            ctx.rect(bounds.left, bounds.top, bounds.width, bounds.height);
            ctx.fillStyle = arena.damageActive ? 'rgba(174, 25, 45, 0.22)' : 'rgba(3, 10, 20, 0.18)';
            ctx.fill('evenodd');

            ctx.fillStyle = arena.damageActive ? 'rgba(255, 255, 255, 0.015)' : 'rgba(59, 214, 122, 0.018)';
            ctx.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);

            ctx.strokeStyle = arena.damageActive ? '#ff566d' : '#66e39a';
            ctx.shadowColor = arena.damageActive ? '#ff304f' : '#45d985';
            ctx.shadowBlur = arena.damageActive ? 20 : 12;
            ctx.lineWidth = arena.damageActive ? 9 : 6;
            ctx.setLineDash(arena.damageActive ? [22, 14] : []);
            ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
            ctx.setLineDash([]);

            if (arena.damageActive) {
                ctx.fillStyle = 'rgba(255, 86, 109, 0.94)';
                ctx.font = `700 21px ${FONT_STACK}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('DANGER', game.width / 2, Math.max(34, bounds.top - 28));
                ctx.fillText('DANGER', game.width / 2, Math.min(game.height - 34, bounds.bottom + 28));
            }
            ctx.restore();
        },

        drawWall(ctx, wall) {
            const moving = Boolean(wall.motion);
            ctx.save();
            ctx.translate(wall.x, wall.y);
            ctx.rotate(wall.angle || 0);

            roundedRectPath(ctx, -wall.w / 2, -wall.h / 2, wall.w, wall.h, Math.min(14, wall.h / 2));
            ctx.fillStyle = moving ? '#f4c430' : '#46566c';
            ctx.fill();
            ctx.strokeStyle = moving ? '#fff1a8' : '#9fb0c4';
            ctx.lineWidth = moving ? 5 : 4;
            ctx.stroke();

            ctx.save();
            roundedRectPath(ctx, -wall.w / 2, -wall.h / 2, wall.w, wall.h, Math.min(14, wall.h / 2));
            ctx.clip();
            if (moving) {
                ctx.strokeStyle = 'rgba(35, 30, 8, 0.62)';
                ctx.lineWidth = 12;
                for (let x = -wall.w; x < wall.w; x += 34) {
                    ctx.beginPath();
                    ctx.moveTo(x, wall.h / 2);
                    ctx.lineTo(x + wall.h, -wall.h / 2);
                    ctx.stroke();
                }
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.11)';
                ctx.fillRect(-wall.w / 2 + 6, -wall.h / 2 + 6, wall.w - 12, Math.max(3, wall.h * 0.18));
            }
            ctx.restore();

            ctx.restore();
        },

        drawFood(ctx, food) {
            const pulse = 1 + Math.sin((food.x + food.y) * 0.02) * 0.08;
            ctx.save();
            ctx.translate(food.x, food.y);
            ctx.scale(pulse, pulse);
            ctx.shadowColor = '#6ff58a';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#4cdf6a';
            ctx.beginPath();
            ctx.arc(0, 0, food.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-1.5, -food.radius * 0.58, 3, food.radius * 1.16);
            ctx.fillRect(-food.radius * 0.58, -1.5, food.radius * 1.16, 3);
            ctx.restore();
        },

        drawPowerup(ctx, powerup) {
            const visual = this.getPowerupVisual(powerup.type);
            const radius = this.getGeometry('powerup', powerup).radius;
            const pulse = 1 + Math.sin(powerup.rotation * 3) * 0.06;
            ctx.save();
            ctx.translate(powerup.x, powerup.y);
            ctx.scale(pulse, pulse);
            ctx.shadowColor = visual.color;
            ctx.shadowBlur = 20;
            ctx.fillStyle = '#f8fbff';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = visual.color;
            ctx.lineWidth = 7;
            ctx.stroke();
            drawPowerupIcon(ctx, powerup.type, 0, 0, radius * 0.78, visual.color);
            ctx.restore();

            if (showPowerupLabels) {
                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.font = `700 14px ${FONT_STACK}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 5;
                ctx.fillText(visual.label, powerup.x, powerup.y + radius + 19);
                ctx.restore();
            }
        },

        drawProjectile(ctx, projectile) {
            const visual = this.getTeamVisual(projectile.team.id);
            const geometry = this.getGeometry('projectile', projectile);
            ctx.save();
            ctx.strokeStyle = alphaColor(visual.main, 0.48);
            ctx.lineWidth = geometry.height * 1.45;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(projectile.previousX, projectile.previousY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.translate(projectile.x, projectile.y);
            ctx.rotate(projectile.angle || 0);
            ctx.shadowColor = visual.main;
            ctx.shadowBlur = 12;
            ctx.fillStyle = visual.main;
            roundedRectPath(ctx, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height, geometry.height / 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-geometry.width * 0.22, -geometry.height * 0.2, geometry.width * 0.44, geometry.height * 0.4);
            ctx.restore();
        },

        drawParticle(ctx, particle) {
            const alpha = Math.max(0, particle.life / particle.maxLife);
            let color = particle.colorToken;
            if (color?.startsWith('team:')) color = this.getTeamVisual(color.slice(5)).main;
            else if (color?.startsWith('powerup:')) color = this.getPowerupVisual(color.slice(8)).color;
            else if (color === 'shield') color = this.getPowerupVisual('AEGIS').color;
            else if (color === 'danger') color = '#ff566d';

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation || 0);
            ctx.fillStyle = alphaColor(color || '#ffffff', alpha);
            ctx.strokeStyle = alphaColor(color || '#ffffff', alpha);
            if (particle.variant === 'dash') {
                roundedRectPath(ctx, -particle.radius * 2, -particle.radius / 2, particle.radius * 4, particle.radius, particle.radius / 2);
                ctx.fill();
            } else if (particle.variant === 'ring') {
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius * 2.2, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.fillRect(-particle.radius, -particle.radius, particle.radius * 2, particle.radius * 2);
            }
            ctx.restore();
        },

        drawBot(ctx, bot, game) {
            const visual = this.getTeamVisual(bot.team.id);
            const radius = this.getGeometry('bot', bot).radius;
            const health = Math.max(0, Math.round(bot.power));
            const fontSize = healthTextSize(health, radius);

            ctx.save();
            ctx.translate(bot.x, bot.y);

            // Restrained depth: the team color identifies ownership, while the dark
            // centre creates a stable high-contrast surface for the health value.
            ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.fillStyle = visual.main;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = 'rgba(5, 12, 20, 0.72)';
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(12, radius * 0.68), 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = `750 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 2;
            ctx.fillText(String(health), 0, 0.5);
            ctx.restore();

            const effects = bot.activePowerups.slice(0, 2);
            effects.forEach((effect, index) => {
                const color = this.getPowerupVisual(effect.id).color;
                const ringRadius = radius + 9 + index * 10;
                const direction = index === 0 ? 1 : -1;
                const rotation = (game?.frameCount || 0) * 0.045 * direction + index * Math.PI * 0.35;
                ctx.save();
                ctx.translate(bot.x, bot.y);
                ctx.rotate(rotation);
                ctx.strokeStyle = alphaColor(color, index === 0 ? 0.92 : 0.76);
                ctx.lineWidth = index === 0 ? 3.2 : 2.6;
                ctx.setLineDash(index === 0 ? [7, 6] : [4, 8]);
                ctx.lineDashOffset = index * 3;
                ctx.beginPath();
                ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            });
        },

        drawDisplayText(ctx, game, config) {
            const text = String(config?.text || '').trim();
            if (!text) return;
            const fps = Math.max(1, game.gameConfig.targetFps || 60);
            const start = Math.max(0, Number(config.startSeconds) || 0) * fps;
            const endSeconds = Number(config.endSeconds) || 0;
            const end = endSeconds > 0 ? endSeconds * fps : Infinity;
            if (game.frameCount < start || game.frameCount > end) return;
            const transitionFrames = Math.max(1, Math.round(fps * 0.45));
            const inProgress = Math.min(1, Math.max(0, (game.frameCount - start) / transitionFrames));
            const outProgress = Number.isFinite(end) ? Math.min(1, Math.max(0, (end - game.frameCount) / transitionFrames)) : 1;
            const eased = value => 1 - Math.pow(1 - value, 3);
            const alpha = Math.min(eased(inProgress), eased(outProgress));
            const baseX = Number.isFinite(Number(config.x)) ? Number(config.x) : game.width * 0.5;
            const baseY = Number.isFinite(Number(config.y)) ? Number(config.y) : game.height * 0.365;
            const y = baseY + (1 - eased(inProgress)) * 18 - (1 - eased(outProgress)) * 10;
            const maxWidth = game.width * 0.72;
            const fontSize = Math.max(28, Math.min(54, game.width * 0.043));
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `650 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const measured = Math.min(maxWidth, ctx.measureText(text).width + 64);
            roundedRectPath(ctx, baseX - measured / 2, y - fontSize * 0.78, measured, fontSize * 1.56, 10);
            ctx.fillStyle = 'rgba(5, 14, 25, 0.76)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#f4f7fb';
            ctx.shadowColor = 'rgba(0,0,0,0.65)';
            ctx.shadowBlur = 4;
            ctx.fillText(text, baseX, y, maxWidth - 24);
            ctx.restore();
        },

        drawOverlay(ctx, game) {
            if (!showMatchClock) return;
            const remainingFrames = Math.max(0, game.match.maxFrames - game.frameCount);
            const remainingSeconds = Math.ceil(remainingFrames / game.gameConfig.targetFps);
            const ratio = Math.max(0, Math.min(1, remainingFrames / game.match.maxFrames));
            const boxWidth = 220;
            const boxHeight = 62;
            const x = game.width / 2 - boxWidth / 2;
            const y = 32;

            ctx.save();
            roundedRectPath(ctx, x, y, boxWidth, boxHeight, 10);
            ctx.fillStyle = 'rgba(5, 15, 28, 0.82)';
            ctx.fill();
            ctx.strokeStyle = game.arena.damageActive ? '#ff566d' : '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = `700 30px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${remainingSeconds}s`, game.width / 2, y + 27);

            const progressX = x + 18;
            const progressY = y + 47;
            const progressWidth = boxWidth - 36;
            roundedRectPath(ctx, progressX, progressY, progressWidth, 8, 4);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fill();
            roundedRectPath(ctx, progressX, progressY, Math.max(3, progressWidth * ratio), 8, 4);
            ctx.fillStyle = ratio > 0.5 ? '#66e39a' : (ratio > 0.2 ? '#ffd43b' : '#ff566d');
            ctx.fill();

            if (game.frameCount < game.gameConfig.targetFps * 7) {
                const legendY = game.height - 58;
                ctx.fillStyle = 'rgba(4, 13, 25, 0.74)';
                roundedRectPath(ctx, game.width / 2 - 290, legendY - 28, 580, 54, 8);
                ctx.fill();
                ctx.font = `650 15px ${FONT_STACK}`;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
                ctx.fillText('GREEN: GROW     RINGS: BOOST     RED: DAMAGE', game.width / 2, legendY);
            }
            ctx.restore();
        },

        drawClimaxRing(ctx, game, radius, alpha, team) {
            ctx.save();
            const color = this.getTeamVisual(team.id).main;
            ctx.strokeStyle = alphaColor(color, alpha);
            ctx.shadowColor = color;
            ctx.shadowBlur = 24;
            ctx.lineWidth = 18;
            ctx.beginPath();
            ctx.arc(game.arena.centerX, game.arena.centerY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    };
}
