const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({ main: '#2f67ff', light: '#94adff', dark: '#16357f', border: '#000000', accent: '#edf3ff' }),
    gold: Object.freeze({ main: '#ffd83e', light: '#fff0ab', dark: '#7a6504', border: '#000000', accent: '#fff9de' }),
    lime: Object.freeze({ main: '#097e5c', light: '#7fd3bc', dark: '#064b37', border: '#000000', accent: '#e2f7f0' }),
    magenta: Object.freeze({ main: '#d90100', light: '#f39a98', dark: '#740000', border: '#000000', accent: '#ffe9e8' })
});

const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ff6600', label: 'POWER', icon: 'bolt' }),
    AEGIS: Object.freeze({ color: '#00e1ff', label: 'SHIELD', icon: 'shield' }),
    TURBO: Object.freeze({ color: '#ffcc00', label: 'SPEED', icon: 'turbo' }),
    REGEN: Object.freeze({ color: '#00ff2f', label: 'HEAL', icon: 'plus' }),
    FOCUS: Object.freeze({ color: '#5100ff', label: 'AIM', icon: 'target' })
});

function alphaColor(hex, alpha) {
    const clean = hex.replace('#', '');
    const value = Number.parseInt(clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean, 16);
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
    ctx.lineWidth = Math.max(2.4, size * 0.10);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const icon = POWERUP_VISUALS[type]?.icon;
    if (icon === 'bolt') {
        ctx.beginPath();
        ctx.moveTo(size * 0.1, -size * 0.56);
        ctx.lineTo(-size * 0.3, -size * 0.04);
        ctx.lineTo(size * 0.02, -size * 0.04);
        ctx.lineTo(-size * 0.08, size * 0.56);
        ctx.lineTo(size * 0.35, 0);
        ctx.lineTo(size * 0.06, 0);
        ctx.closePath();
        ctx.fill();
    } else if (icon === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.52);
        ctx.lineTo(size * 0.44, -size * 0.30);
        ctx.lineTo(size * 0.34, size * 0.2);
        ctx.quadraticCurveTo(0, size * 0.54, -size * 0.34, size * 0.2);
        ctx.lineTo(-size * 0.44, -size * 0.30);
        ctx.closePath();
        ctx.stroke();
    } else if (icon === 'turbo') {
        ctx.beginPath();
        ctx.moveTo(-size * 0.52, -size * 0.30);
        ctx.lineTo(size * 0.04, -size * 0.30);
        ctx.moveTo(-size * 0.52, 0);
        ctx.lineTo(size * 0.24, 0);
        ctx.moveTo(-size * 0.52, size * 0.30);
        ctx.lineTo(size * 0.04, size * 0.30);
        ctx.stroke();
    } else if (icon === 'plus') {
        ctx.fillRect(-size * 0.11, -size * 0.48, size * 0.22, size * 0.96);
        ctx.fillRect(-size * 0.48, -size * 0.11, size * 0.96, size * 0.22);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-size * 0.58, 0); ctx.lineTo(-size * 0.28, 0);
        ctx.moveTo(size * 0.28, 0); ctx.lineTo(size * 0.58, 0);
        ctx.moveTo(0, -size * 0.58); ctx.lineTo(0, -size * 0.28);
        ctx.moveTo(0, size * 0.28); ctx.lineTo(0, size * 0.58);
        ctx.stroke();
    }
    ctx.restore();
}

function createParticles(count, data, game, token, speed, variant = 'dash') {
    const output = [];
    const random = () => game?.randomValue?.('effects') ?? 0.5;
    for (let i = 0; i < count; i += 1) {
        const angle = random() * Math.PI * 2;
        const magnitude = speed * (0.35 + random() * 0.65);
        output.push({
            x: data.x,
            y: data.y,
            vx: Math.cos(angle) * magnitude,
            vy: Math.sin(angle) * magnitude,
            colorToken: token,
            life: 14 + random() * 18,
            radius: 2 + random() * 2.6,
            variant,
            rotation: angle,
            spin: (random() - 0.5) * 0.18
        });
    }
    return output;
}

function healthTextSize(value, radius) {
    const digits = String(Math.max(0, Math.round(value))).length;
    const scale = digits <= 1 ? 1.05 : (digits === 2 ? 0.90 : (digits === 3 ? 0.72 : 0.58));
    return Math.max(14, Math.min(30, radius * scale));
}

function drawPanelBorder(ctx, x, y, w, h, r = 6) {
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.stroke();
}

export function createStyle({ options = {} } = {}) {
    const showPowerupLabels = options.showPowerupLabels !== false;
    const showMatchClock = options.showMatchClock !== false;

    return {
        id: 'beige-glyph',
        backgroundIsStatic: true,

        getGeometry(kind, entity) {
            if (kind === 'bot') {
                return { shape: 'circle', radius: 21 + Math.pow(Math.max(1, entity.power), 0.32) * 2.25 };
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
                    height: overcharged ? 10 : (focused ? 8 : 7),
                    rotation: entity.angle || 0
                };
            }
            return { shape: 'circle', radius: 1 };
        },

        createEffectParticles(effectName, data, game) {
            if (effectName === 'bot-death') return createParticles(16, data, game, `team:${data.teamId}`, 7.5, 'dash');
            if (effectName === 'bot-hit') return createParticles(7, data, game, `team:${data.bot?.team?.id}`, 5, 'dash');
            if (effectName === 'shield-hit') return createParticles(10, data, game, 'shield', 4, 'ring');
            if (effectName === 'zone-damage') return createParticles(8, data, game, 'danger', 5, 'dash');
            if (effectName === 'powerup-collect') return createParticles(12, data, game, `powerup:${data.powerupId}`, 5.4, 'dash');
            if (effectName === 'projectile-wall') return createParticles(6, data, game, `team:${data.projectile?.team?.id}`, 4, 'dash');
            return [];
        },

        getTeamVisual(teamId) {
            return TEAM_VISUALS[teamId] || { main: '#666666', light: '#dddddd', dark: '#111111', border: '#000000', accent: '#f3f3f3' };
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || { color: '#5100ff', label: 'POWER', icon: 'target' };
        },

        styleTeamElement(element, teamId) {
            const visual = this.getTeamVisual(teamId);
            element.style.setProperty('--team-color', visual.main);
            element.style.setProperty('--team-light', visual.light);
            element.style.setProperty('--team-border', visual.border);
            element.style.setProperty('--team-dark', visual.dark);
        },

        applyDocument() {
            document.documentElement.dataset.kineticStyle = 'beige-glyph';
        },

        formatStageText() { return ''; },
        formatWinnerText(team) { return team ? `${team.label.toUpperCase()} WINS` : 'DRAW'; },

        drawBackground(ctx, game) {
            ctx.fillStyle = '#e3e1dc';
            ctx.fillRect(0, 0, game.width, game.height);

            // Keep the arena visually quiet. The reference image is used only for
            // palette and simplicity, not copied as a layout or decorative pattern.
            const vignette = ctx.createRadialGradient(
                game.width * 0.5,
                game.height * 0.46,
                Math.min(game.width, game.height) * 0.08,
                game.width * 0.5,
                game.height * 0.5,
                Math.max(game.width, game.height) * 0.72
            );
            vignette.addColorStop(0, 'rgba(255,255,255,0.10)');
            vignette.addColorStop(1, 'rgba(0,0,0,0.025)');
            ctx.fillStyle = vignette;
            ctx.fillRect(0, 0, game.width, game.height);
        },

        drawZone(ctx, arena, game) {
            const bounds = arena.getBounds();
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, game.width, game.height);
            ctx.rect(bounds.left, bounds.top, bounds.width, bounds.height);
            ctx.fillStyle = arena.damageActive ? 'rgba(217, 1, 0, 0.14)' : 'rgba(0,0,0,0.04)';
            ctx.fill('evenodd');
            ctx.strokeStyle = arena.damageActive ? '#d90100' : '#000000';
            ctx.lineWidth = 3;
            ctx.setLineDash(arena.damageActive ? [16, 10] : []);
            ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
            ctx.setLineDash([]);
            ctx.restore();
        },

        drawWall(ctx, wall) {
            const moving = Boolean(wall.motion);
            ctx.save();
            ctx.translate(wall.x, wall.y);
            ctx.rotate(wall.angle || 0);
            roundedRectPath(ctx, -wall.w / 2, -wall.h / 2, wall.w, wall.h, 2);
            ctx.fillStyle = moving ? '#cdc3b3' : '#bfb5a3';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.6;
            ctx.stroke();
            ctx.restore();
        },

        drawFood(ctx, food) {
            ctx.save();
            ctx.translate(food.x, food.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#ffd83e';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(-food.radius, -food.radius, food.radius * 2, food.radius * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        },

        drawPowerup(ctx, powerup) {
            const visual = this.getPowerupVisual(powerup.type);
            const radius = this.getGeometry('powerup', powerup).radius;
            const pulse = 1 + Math.sin(powerup.rotation * 3) * 0.05;
            ctx.save();
            ctx.translate(powerup.x, powerup.y);
            ctx.scale(pulse, pulse);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = visual.color;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
            ctx.stroke();
            drawPowerupIcon(ctx, powerup.type, 0, 0, radius * 0.76, visual.color);
            ctx.restore();

            ctx.save();
            ctx.translate(powerup.x, powerup.y);
            ctx.rotate(powerup.rotation * 0.9);
            ctx.strokeStyle = alphaColor(visual.color, 0.95);
            ctx.lineWidth = 2.5;
            ctx.setLineDash([2, 8]);
            ctx.beginPath();
            ctx.arc(0, 0, radius + 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            if (showPowerupLabels) {
                ctx.save();
                ctx.fillStyle = '#111111';
                ctx.font = `700 13px ${FONT_STACK}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(visual.label, powerup.x, powerup.y + radius + 18);
                ctx.restore();
            }
        },

        drawProjectile(ctx, projectile) {
            const visual = this.getTeamVisual(projectile.team.id);
            const geometry = this.getGeometry('projectile', projectile);
            ctx.save();
            ctx.strokeStyle = alphaColor(visual.main, 0.28);
            ctx.lineWidth = geometry.height * 1.8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(projectile.previousX, projectile.previousY);
            ctx.lineTo(projectile.x, projectile.y);
            ctx.stroke();

            ctx.translate(projectile.x, projectile.y);
            ctx.rotate(projectile.angle || 0);
            roundedRectPath(ctx, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height, geometry.height / 2);
            ctx.fillStyle = visual.main;
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.78)';
            roundedRectPath(ctx, -geometry.width * 0.2, -geometry.height * 0.18, geometry.width * 0.45, geometry.height * 0.36, geometry.height * 0.18);
            ctx.fill();
            ctx.restore();
        },

        drawParticle(ctx, particle) {
            const alpha = Math.max(0, particle.life / particle.maxLife);
            let color = particle.colorToken;
            if (color?.startsWith('team:')) color = this.getTeamVisual(color.slice(5)).main;
            else if (color?.startsWith('powerup:')) color = this.getPowerupVisual(color.slice(8)).color;
            else if (color === 'shield') color = '#a880fe';
            else if (color === 'danger') color = '#d90100';
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation || 0);
            ctx.fillStyle = alphaColor(color || '#000000', alpha);
            ctx.strokeStyle = alphaColor(color || '#000000', alpha);
            if (particle.variant === 'ring') {
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, particle.radius * 2.2, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.fillRect(-particle.radius * 1.5, -particle.radius * 0.55, particle.radius * 3, particle.radius * 1.1);
            }
            ctx.restore();
        },

        drawBot(ctx, bot, game) {
            const visual = this.getTeamVisual(bot.team.id);
            const radius = this.getGeometry('bot', bot).radius;
            const health = Math.max(0, Math.round(bot.power));
            const fontSize = healthTextSize(health, radius);
            const movingSpeed = Math.hypot(bot.vx || 0, bot.vy || 0);

            if (movingSpeed > 1.1) {
                const direction = Math.atan2(bot.vy || 0, bot.vx || 1);
                const nx = Math.cos(direction);
                const ny = Math.sin(direction);
                const spacing = Math.min(13, 7 + movingSpeed * 0.45);
                for (let index = 0; index < 3; index += 1) {
                    const distance = radius + 8 + index * spacing;
                    const trailRadius = Math.max(2.2, 5.2 - index * 1.25);
                    ctx.save();
                    ctx.globalAlpha = 0.24 - index * 0.055;
                    ctx.fillStyle = visual.main;
                    // ctx.beginPath();
                    // ctx.arc(
                    //     bot.x - nx * distance,
                    //     bot.y - ny * distance,
                    //     trailRadius,
                    //     0,
                    //     Math.PI * 2
                    // );
                    // ctx.fill();
                    ctx.restore();
                }
            }

            ctx.save();
            ctx.translate(bot.x, bot.y);
            ctx.fillStyle = visual.main;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2.8;
            ctx.stroke();

            ctx.fillStyle = '#f8f7f3';
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(13, radius * 0.67), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1.9;
            ctx.stroke();

            ctx.fillStyle = '#0b0b0b';
            ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(255,255,255,0.85)';
            ctx.shadowBlur = 1.5;
            ctx.fillText(String(health), 0, 0.5);
            ctx.restore();

            const effects = bot.activePowerups.slice(0, 2);
            effects.forEach((effect, index) => {
                const color = this.getPowerupVisual(effect.id).color;
                const ringRadius = radius + 10 + index * 10;
                const direction = index === 0 ? 1 : -1;
                const rotation = (game?.frameCount || 0) * 0.05 * direction + index * Math.PI * 0.25;
                ctx.save();
                ctx.translate(bot.x, bot.y);
                ctx.rotate(rotation);
                ctx.strokeStyle = alphaColor(color, index === 0 ? 1 : 0.95);
                ctx.lineWidth = index === 0 ? 4 : 3.4;
                ctx.setLineDash(index === 0 ? [15, 5] : [10, 8]);
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
            const transitionFrames = Math.max(1, Math.round(fps * 0.42));
            const inProgress = Math.min(1, Math.max(0, (game.frameCount - start) / transitionFrames));
            const outProgress = Number.isFinite(end) ? Math.min(1, Math.max(0, (end - game.frameCount) / transitionFrames)) : 1;
            const ease = value => 1 - Math.pow(1 - value, 3);
            const alpha = Math.min(ease(inProgress), ease(outProgress));
            const baseX = Number.isFinite(Number(config.x)) ? Number(config.x) : game.width * 0.5;
            const baseY = Number.isFinite(Number(config.y)) ? Number(config.y) : game.height * 0.36;
            const y = baseY + (1 - ease(inProgress)) * 10 - (1 - ease(outProgress)) * 8;
            const fontSize = Math.max(26, Math.min(48, game.width * 0.042));
            const maxWidth = game.width * 0.74;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `800 ${fontSize}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const panelWidth = Math.min(maxWidth, ctx.measureText(text).width + 52);
            drawPanelBorder(ctx, baseX - panelWidth / 2, y - fontSize * 0.76, panelWidth, fontSize * 1.52, 4);
            ctx.fillStyle = '#111111';
            ctx.fillText(text, baseX, y, maxWidth - 12);
            ctx.restore();
        },

        drawOverlay(ctx, game) {
            if (!showMatchClock) return;
            const remainingFrames = Math.max(0, game.match.maxFrames - game.frameCount);
            const remainingSeconds = Math.ceil(remainingFrames / game.gameConfig.targetFps);
            const ratio = Math.max(0, Math.min(1, remainingFrames / game.match.maxFrames));
            const boxWidth = 210;
            const boxHeight = 56;
            const x = game.width / 2 - boxWidth / 2;
            const y = 28;
            ctx.save();
            drawPanelBorder(ctx, x, y, boxWidth, boxHeight, 4);
            ctx.fillStyle = '#111111';
            ctx.font = `800 28px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${remainingSeconds}s`, game.width / 2, y + 23);
            const progressX = x + 16;
            const progressY = y + 40;
            const progressWidth = boxWidth - 32;
            roundedRectPath(ctx, progressX, progressY, progressWidth, 7, 3);
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fill();
            roundedRectPath(ctx, progressX, progressY, Math.max(3, progressWidth * ratio), 7, 3);
            ctx.fillStyle = ratio > 0.5 ? '#097e5c' : (ratio > 0.2 ? '#ffd83e' : '#d90100');
            ctx.fill();
            ctx.restore();
        },

        drawClimaxRing(ctx, game, radius, alpha, team) {
            ctx.save();
            ctx.strokeStyle = alphaColor(this.getTeamVisual(team.id).main, alpha);
            ctx.lineWidth = 10;
            ctx.setLineDash([10, 14]);
            ctx.beginPath();
            ctx.arc(game.arena.centerX, game.arena.centerY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    };
}
