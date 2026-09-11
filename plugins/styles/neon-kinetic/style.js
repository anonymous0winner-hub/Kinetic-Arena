const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({ main: '#00ffff', rgb: '0, 255, 255', border: 'rgba(0, 255, 255, 0.30)' }),
    magenta: Object.freeze({ main: '#ff00ff', rgb: '255, 0, 255', border: 'rgba(255, 0, 255, 0.30)' }),
    gold: Object.freeze({ main: '#FFD700', rgb: '255, 215, 0', border: 'rgba(255, 215, 0, 0.30)' }),
    lime: Object.freeze({ main: '#39FF14', rgb: '57, 255, 20', border: 'rgba(57, 255, 20, 0.30)' })
});

const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ffffff' }),
    AEGIS: Object.freeze({ color: '#00ffff' }),
    TURBO: Object.freeze({ color: '#FFD700' }),
    REGEN: Object.freeze({ color: '#39FF14' }),
    FOCUS: Object.freeze({ color: '#9b8cff' })
});

function colorWithAlpha(color, alpha) {
    if (typeof color !== 'string') return `rgba(255,255,255,${alpha})`;
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const expanded = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
        const value = Number.parseInt(expanded, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (/^\d+\s*,/.test(color)) return `rgba(${color}, ${alpha})`;
    return color;
}

function drawRoundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

export function createStyle() {
    return {
        id: 'neon-kinetic',

        getGeometry(kind, entity) {
            if (kind === 'bot') {
                return { shape: 'circle', radius: 10 + Math.pow(Math.max(1, entity.power), 0.35) * 1.8 };
            }
            if (kind === 'food') return { shape: 'circle', radius: 2.5 };
            if (kind === 'powerup') return { shape: 'circle', radius: 14 };
            if (kind === 'wall') return { shape: 'rect', width: entity.w, height: entity.h, rotation: entity.angle || 0 };
            if (kind === 'projectile') {
                return { shape: 'circle', radius: entity.isOvercharged ? 4.5 : 3 };
            }
            return { shape: 'circle', radius: 1 };
        },

        createEffectParticles(effectName, data, game) {
            const random = () => game?.randomValue?.('effects') ?? 0.5;
            const presets = {
                'bot-death': { count: 20, speed: 6, token: `team:${data.teamId || data.bot?.team?.id}` },
                'bot-hit': { count: data.source === 'melee' ? 6 : 5, speed: 4, token: `team:${data.bot?.team?.id}` },
                'shield-hit': { count: 4, speed: 2, token: 'shield' },
                'zone-damage': { count: 8, speed: 4, token: 'danger' },
                'powerup-collect': { count: 20, speed: 5, token: `powerup:${data.powerupId}` },
                'projectile-wall': { count: 3, speed: 2.5, token: `team:${data.projectile?.team?.id}` }
            };
            const preset = presets[effectName];
            if (!preset) return [];
            const particles = [];
            for (let index = 0; index < preset.count; index += 1) {
                const angle = random() * Math.PI * 2;
                const speed = random() * preset.speed;
                particles.push({
                    x: data.x, y: data.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    colorToken: preset.token,
                    life: 15 + random() * 15,
                    radius: random() * 2 + 1,
                    variant: 'dot'
                });
            }
            return particles;
        },

        getTeamVisual(teamId) {
            return TEAM_VISUALS[teamId] || { main: '#ffffff', rgb: '255, 255, 255', border: 'rgba(255,255,255,0.25)' };
        },

        getPowerupVisual(type) {
            return POWERUP_VISUALS[type] || { color: '#ffffff' };
        },

        styleTeamElement(element, teamId) {
            const visual = this.getTeamVisual(teamId);
            element.style.setProperty('--team-color', visual.main);
            element.style.setProperty('--team-border', visual.border);
        },

        applyDocument() {
            document.documentElement.dataset.kineticStyle = 'neon-kinetic';
        },

        drawBackground(ctx, game) {
            const gradient = ctx.createRadialGradient(
                game.width / 2,
                game.height / 2,
                0,
                game.width / 2,
                game.height / 2,
                Math.max(game.width, game.height) * 0.72
            );
            gradient.addColorStop(0, '#111522');
            gradient.addColorStop(0.55, '#0d1019');
            gradient.addColorStop(1, '#090a10');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, game.width, game.height);

            ctx.save();
            ctx.globalAlpha = 0.08;
            ctx.strokeStyle = '#9aa7d8';
            ctx.lineWidth = 1;
            const spacing = 48;
            for (let x = (game.frameCount * 0.08) % spacing; x < game.width; x += spacing) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, game.height);
                ctx.stroke();
            }
            for (let y = (game.frameCount * 0.08) % spacing; y < game.height; y += spacing) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(game.width, y);
                ctx.stroke();
            }
            ctx.restore();
        },

        drawZone(ctx, arena, game) {
            const danger = arena.damageActive;
            const bounds = arena.getBounds();

            ctx.save();
            ctx.strokeStyle = danger ? 'rgba(255, 68, 68, 0.58)' : 'rgba(120, 130, 255, 0.28)';
            ctx.shadowColor = danger ? 'rgba(255, 68, 68, 0.45)' : 'rgba(100, 110, 255, 0.26)';
            ctx.shadowBlur = danger ? 16 : 8;
            ctx.lineWidth = danger ? 5 : 4;
            ctx.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
            ctx.restore();
        },

        drawWall(ctx, wall) {
            ctx.save();
            ctx.translate(wall.x, wall.y);
            ctx.rotate(wall.angle || 0);

            const isPassThrough = wall.collision?.projectiles === false;
            const x = -wall.w / 2;
            const y = -wall.h / 2;

            if (isPassThrough) {
                ctx.shadowColor = 'rgba(129, 153, 255, 0.42)';
                ctx.shadowBlur = 12;
                ctx.fillStyle = 'rgba(35, 44, 69, 0.72)';
                ctx.strokeStyle = 'rgba(119, 143, 228, 0.78)';
                ctx.setLineDash([7, 5]);
            } else {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
                ctx.shadowBlur = 8;
                ctx.fillStyle = '#1c202d';
                ctx.strokeStyle = '#3a4052';
                ctx.setLineDash([]);
            }

            drawRoundedRect(ctx, x, y, wall.w, wall.h, 4);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();

            if (isPassThrough) {
                ctx.clip();
                ctx.globalAlpha = 0.2;
                ctx.strokeStyle = '#d4dcff';
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                const diagonalLength = wall.w + wall.h;
                for (let offset = -diagonalLength; offset <= diagonalLength; offset += 14) {
                    ctx.beginPath();
                    ctx.moveTo(offset, y + wall.h);
                    ctx.lineTo(offset + wall.h, y);
                    ctx.stroke();
                }
            }
            ctx.restore();
        },

        drawFood(ctx, food) {
            ctx.save();
            ctx.fillStyle = '#7a7e8a';
            ctx.shadowColor = 'rgba(190, 198, 220, 0.35)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        drawPowerup(ctx, powerup) {
            ctx.save();
            ctx.translate(powerup.x, powerup.y);
            ctx.rotate(powerup.rotation);
            const visual = this.getPowerupVisual(powerup.type);
            ctx.fillStyle = visual.color;
            ctx.shadowColor = visual.color;
            ctx.shadowBlur = 16;
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                ctx.lineTo(0, -powerup.radius);
                ctx.rotate(Math.PI / 4);
                ctx.lineTo(0, -powerup.radius / 2.5);
                ctx.rotate(Math.PI / 4);
            }
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        },

        drawProjectile(ctx, projectile) {
            ctx.save();
            const visual = this.getTeamVisual(projectile.team.id);
            ctx.fillStyle = visual.main;
            ctx.strokeStyle = visual.main;
            ctx.shadowColor = visual.main;
            ctx.shadowBlur = projectile.isOvercharged ? 16 : 8;
            if (projectile.isOvercharged) {
                ctx.beginPath();
                ctx.moveTo(projectile.x, projectile.y);
                ctx.lineTo(projectile.x - projectile.vx * 1.5, projectile.y - projectile.vy * 1.5);
                ctx.lineWidth = 4;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        },

        drawParticle(ctx, particle) {
            const alpha = Math.max(0, particle.life / particle.maxLife);
            ctx.save();
            let color = particle.colorToken;
            if (color?.startsWith('team:')) color = this.getTeamVisual(color.slice(5)).main;
            else if (color?.startsWith('powerup:')) color = this.getPowerupVisual(color.slice(8)).color;
            else if (color === 'shield') color = this.getPowerupVisual('AEGIS').color;
            else if (color === 'danger') color = '#ff4444';
            ctx.fillStyle = colorWithAlpha(color || '#ffffff', alpha);
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        drawBot(ctx, bot, game) {
            ctx.save();
            ctx.fillStyle = '#161925';
            const teamVisual = this.getTeamVisual(bot.team.id);
            ctx.shadowColor = colorWithAlpha(teamVisual.main, 0.45);
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(bot.x, bot.y, bot.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = teamVisual.main;
            ctx.stroke();
            ctx.restore();

            const auras = [
                [bot.overchargeTimer, this.getPowerupVisual('OVERCHARGE').color, 6],
                [bot.shieldTimer, this.getPowerupVisual('AEGIS').color, 10],
                [bot.turboTimer, this.getPowerupVisual('TURBO').color, 4],
                [bot.regenTimer, this.getPowerupVisual('REGEN').color, 2],
                [bot.activePowerups.find(effect => effect.id === 'FOCUS')?.remainingFrames || 0, this.getPowerupVisual('FOCUS').color, 8]
            ];
            for (const [timer, color, offset] of auras) {
                if (timer <= 0) continue;
                ctx.save();
                ctx.translate(bot.x, bot.y);
                ctx.rotate(performance.now() / 150);
                ctx.beginPath();
                ctx.arc(0, 0, bot.radius + offset, 0, Math.PI * 2);
                ctx.setLineDash([4, 6]);
                ctx.lineWidth = 2;
                ctx.strokeStyle = color;
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
                ctx.stroke();
                ctx.restore();
            }

            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.max(10, bot.radius * 0.6)}px ui-monospace, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(Math.floor(bot.power), bot.x, bot.y + 1);
            ctx.restore();
        },

        drawDisplayText(ctx, game, config) {
            const text = String(config?.text || '').trim();
            if (!text) return;
            const fps = Math.max(1, game.gameConfig.targetFps || 60);
            const start = Math.max(0, Number(config.startSeconds) || 0) * fps;
            const endSeconds = Number(config.endSeconds) || 0;
            const end = endSeconds > 0 ? endSeconds * fps : Infinity;
            if (game.frameCount < start || game.frameCount > end) return;

            const transitionFrames = Math.max(1, Math.round(fps * 0.32));
            const enter = Math.min(1, Math.max(0, (game.frameCount - start) / transitionFrames));
            const leave = Number.isFinite(end)
                ? Math.min(1, Math.max(0, (end - game.frameCount) / transitionFrames))
                : 1;
            const smooth = value => value * value * (3 - 2 * value);
            const alpha = Math.min(smooth(enter), smooth(leave));
            const scale = 0.94 + smooth(enter) * 0.06;
            const baseX = Number.isFinite(Number(config.x)) ? Number(config.x) : game.width * 0.5;
            const baseY = Number.isFinite(Number(config.y)) ? Number(config.y) : game.height * 0.365;
            const fontSize = Math.max(28, Math.min(56, game.width * 0.045));

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(baseX, baseY);
            ctx.scale(scale, scale);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `650 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
            const width = Math.min(game.width * 0.74, ctx.measureText(text).width + 72);
            drawRoundedRect(ctx, -width / 2, -fontSize * 0.82, width, fontSize * 1.64, 8);
            ctx.fillStyle = 'rgba(12, 15, 28, 0.72)';
            ctx.shadowColor = 'rgba(119, 143, 228, 0.42)';
            ctx.shadowBlur = 14;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(170, 188, 255, 0.42)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#f5f7ff';
            ctx.fillText(text, 0, 0, width - 24);
            ctx.restore();
        },

        drawClimaxRing(ctx, game, radius, alpha, team) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(game.width / 2, game.height / 2, radius, 0, Math.PI * 2);
            const visual = this.getTeamVisual(team.id);
            ctx.strokeStyle = colorWithAlpha(visual.main, alpha);
            ctx.shadowColor = visual.main;
            ctx.shadowBlur = 22;
            ctx.lineWidth = 15;
            ctx.stroke();
            ctx.restore();
        }
    };
}
