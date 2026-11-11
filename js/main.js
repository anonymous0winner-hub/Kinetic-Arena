import { CONFIG, TEAMS, applySimulationConfig } from './config.js';
import { loadGameConfig } from './game-config-loader.js';
import { createRandomStreams } from './random.js';
import { resolveMatchFrameLimit, resolveTimeoutWinner } from './match-rules.js';
import { loadPluginRuntime } from './plugin-loader.js';
import {
    collidersIntersect,
    createWallCollider,
    getCollisionManifold,
    isValidEntitySpawn,
    segmentIntersectsCollider
} from './collision.js';
import { ArenaManager } from './environment.js';
import { Food, Particle, Powerup } from './entities.js';
import { Bot } from './Bot.js';
import { AudioManager } from './audio-engine.js';
import { SeedFinder } from './seed-finder.js';

const viewportElement = document.getElementById('arena-viewport');
const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d', { alpha: false });
const loadingStatus = document.getElementById('loading-status');
const statusText = document.getElementById('status-text');
const zoneStatus = document.getElementById('zone-status');
const scoreGrid = document.getElementById('score-grid');
const runtimeQuery = new URLSearchParams(globalThis.location?.search || '');
const automationMode = runtimeQuery.get('automation');
if (automationMode) document.documentElement.dataset.kineticAutomation = automationMode;
const SEED_EVENT_TYPES = new Set([
    'bot-death', 'powerup-collect', 'projectile-hit', 'melee-hit',
    'zone-damage', 'shield-hit'
]);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function resolveActiveTeams(gameConfig) {
    return gameConfig.teams.map(teamConfig => Object.freeze({
        ...TEAMS[teamConfig.id],
        id: teamConfig.id,
        label: teamConfig.label,
        members: teamConfig.members,
        defaultAI: teamConfig.defaultAI,
        memberAI: teamConfig.memberAI
    }));
}

function sampleSpawnZone(zone, memberIndex, memberCount, jitter, random) {
    if (zone.shape === 'formation') {
        const columns = Math.max(1, Math.round(Number(zone.columns) || Math.ceil(Math.sqrt(memberCount))));
        const rows = Math.max(1, Math.ceil(memberCount / columns));
        const column = memberIndex % columns;
        const row = Math.floor(memberIndex / columns);
        const spacingX = Number(zone.spacingX) || 58;
        const spacingY = Number(zone.spacingY) || 58;
        return {
            x: zone.x + (column - (columns - 1) / 2) * spacingX + (random() - 0.5) * jitter.x * 2,
            y: zone.y + (row - (rows - 1) / 2) * spacingY + (random() - 0.5) * jitter.y * 2
        };
    }

    if (zone.shape === 'rect') {
        return {
            x: zone.x + (random() - 0.5) * zone.w,
            y: zone.y + (random() - 0.5) * zone.h
        };
    }

    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * (zone.radius || 0);
    return {
        x: zone.x + Math.cos(angle) * radius,
        y: zone.y + Math.sin(angle) * radius
    };
}

function resolveViewportSpec(mapModule, gameConfig) {
    const configured = gameConfig.world.override;
    if (configured) return configured;
    if (!gameConfig.world.useMapViewport) return Object.freeze({ mode: 'responsive', fit: 'stretch' });

    const viewport = mapModule.viewport || {};
    if (viewport.mode !== 'fixed') return Object.freeze({ mode: 'responsive', fit: 'stretch' });
    return Object.freeze({
        mode: 'fixed',
        width: Math.max(1, Math.round(Number(viewport.width) || 1080)),
        height: Math.max(1, Math.round(Number(viewport.height) || 1920)),
        fit: viewport.fit === 'cover' ? 'cover' : 'contain'
    });
}

function applyViewportLayout(viewportSpec) {
    if (viewportSpec.mode === 'responsive') {
        viewportElement.style.width = '100vw';
        viewportElement.style.height = '100vh';
        viewportElement.style.left = '0';
        viewportElement.style.top = '0';
        viewportElement.style.transform = 'none';
        return { width: window.innerWidth, height: window.innerHeight };
    }

    const widthScale = window.innerWidth / viewportSpec.width;
    const heightScale = window.innerHeight / viewportSpec.height;
    const scale = viewportSpec.fit === 'cover'
        ? Math.max(widthScale, heightScale)
        : Math.min(widthScale, heightScale);
    viewportElement.style.width = `${viewportSpec.width * scale}px`;
    viewportElement.style.height = `${viewportSpec.height * scale}px`;
    viewportElement.style.left = '50%';
    viewportElement.style.top = '50%';
    viewportElement.style.transform = 'translate(-50%, -50%)';
    return { width: viewportSpec.width, height: viewportSpec.height };
}

function collectTeamStats(game) {
    const stats = new Map(game.activeTeams.map(team => [team.id, {
        id: team.id,
        label: team.label,
        alive: 0,
        members: 0,
        health: 0
    }]));
    for (const bot of game.bots) {
        const team = stats.get(bot.team.id);
        if (!team) continue;
        team.members += 1;
        if (!bot.alive) continue;
        team.alive += 1;
        team.health += bot.power;
    }
    return stats;
}

function calculateUnderdogId(game) {
    const powers = game._teamPowerScratch || (game._teamPowerScratch = new Float64Array(game.activeTeams.length));
    powers.fill(0);
    const teamIndexes = game._teamIndexById || (game._teamIndexById = new Map(
        game.activeTeams.map((team, index) => [team.id, index])
    ));
    for (const bot of game.bots) {
        if (!bot.alive) continue;
        powers[teamIndexes.get(bot.team.id)] += bot.power;
    }
    let minimumPower = Infinity;
    let underdogId = null;
    for (let index = 0; index < game.activeTeams.length; index += 1) {
        const health = powers[index];
        if (health > 0 && health < minimumPower) {
            minimumPower = health;
            underdogId = game.activeTeams[index].id;
        }
    }
    return underdogId;
}

function createSnapshot(game) {
    const stats = collectTeamStats(game);
    const teams = game.activeTeams.map(team => {
        const state = stats.get(team.id);
        return Object.freeze({
            id: team.id,
            label: team.label,
            alive: state.alive,
            members: state.members,
            health: Number(state.health.toFixed(4))
        });
    });

    return Object.freeze({
        seed: game.currentSeed,
        frameCount: game.frameCount,
        state: game.state,
        climaxTimer: game.climaxTimer,
        matchEndFrame: game.matchEndFrame,
        endedBy: game.match.endedBy,
        winnerTeamId: game.winningTeam?.id || null,
        teams: Object.freeze(teams),
        bots: Object.freeze(game.bots.map(bot => Object.freeze({
            id: bot.id,
            teamId: bot.team.id,
            aiId: bot.aiId,
            alive: bot.alive,
            health: Number(bot.power.toFixed(4)),
            x: Number(bot.x.toFixed(4)),
            y: Number(bot.y.toFixed(4)),
            vx: Number(bot.vx.toFixed(4)),
            vy: Number(bot.vy.toFixed(4)),
            powerups: Object.freeze(bot.activePowerups.map(effect => Object.freeze({
                id: effect.id,
                strength: effect.strength,
                remainingFrames: effect.remainingFrames
            })))
        }))),
        powerups: Object.freeze(game.powerups.filter(powerup => powerup.active).map(powerup => Object.freeze({
            id: powerup.type,
            strength: powerup.strength,
            x: Number(powerup.x.toFixed(4)),
            y: Number(powerup.y.toFixed(4))
        })))
    });
}

// Compact, allocation-conscious sample used only by the logic-only seed search.
// It deliberately omits render/audio data and preserves exact simulation numbers.
function createSeedSnapshot(game) {
    const stats = collectTeamStats(game);
    return {
        seed: game.currentSeed,
        frameCount: game.frameCount,
        state: game.state,
        matchEndFrame: game.matchEndFrame,
        endedBy: game.match.endedBy,
        winnerTeamId: game.winningTeam?.id || null,
        teams: game.activeTeams.map(team => {
            const state = stats.get(team.id);
            const teamBots = game.bots.filter(bot => bot.team.id === team.id && bot.alive);
            const powerupStrength = teamBots.reduce((sum, bot) => sum + bot.activePowerups.reduce((inner, effect) => {
                const multipliers = game.gameConfig.seedFinder.scoring?.powerupIdMultipliers || {};
                const idMultiplier = Number(multipliers[effect.id]) || 1;
                const remainingFactor = 0.55 + 0.45 * Math.max(0, Math.min(1, effect.remainingRatio ?? 1));
                return inner + effect.strength * idMultiplier * remainingFactor;
            }, 0), 0);
            const powerupWeight = Number(game.gameConfig.seedFinder.scoring?.powerupStrengthWeight) || 0;
            return {
                id: team.id,
                alive: state.alive,
                members: state.members,
                health: state.health,
                powerupStrength,
                effectiveStrength: state.health + powerupStrength * powerupWeight
            };
        }),
        bots: game.bots.map(bot => ({
            id: bot.id,
            teamId: bot.team.id,
            alive: bot.alive,
            health: bot.power,
            x: bot.x,
            y: bot.y,
            powerups: bot.activePowerups.map(effect => ({
                id: effect.id,
                strength: effect.strength,
                remainingFrames: effect.remainingFrames,
                remainingRatio: effect.remainingRatio
            }))
        }))
    };
}

async function bootstrap() {
    const gameConfig = await loadGameConfig();
    // Team panels and winner text are rendered into the canvas so simulator and
    // offline recordings contain the same pixels. Keep the legacy DOM layer hidden.
    scoreGrid.hidden = true;
    statusText.hidden = true;
    applySimulationConfig(gameConfig.simulation);
    const activeTeams = resolveActiveTeams(gameConfig);
    const teamsById = Object.freeze(Object.fromEntries(activeTeams.map(team => [team.id, team])));

    const bootstrapRandom = createRandomStreams(gameConfig.seed);
    const runtime = await loadPluginRuntime(gameConfig.selection, {
        config: CONFIG,
        teams: teamsById,
        gameConfig,
        random: () => bootstrapRandom.random('plugin-bootstrap'),
        logicOnly: automationMode === 'seed'
    });
    if (automationMode !== 'seed') runtime.style.applyDocument?.();
    const audioManager = new AudioManager(runtime.audioTheme, gameConfig.audio);
    audioManager.installUnlock(document);

    const viewportSpec = resolveViewportSpec(runtime.mapModule, gameConfig);
    const geometryProvider = runtime.style.getGeometry.bind(runtime.style);

    const game = {
        gameConfig,
        width: 0,
        height: 0,
        viewportSpec,
        frameCount: 0,
        state: 'playing',
        climaxTimer: 0,
        winningTeam: null,
        topBot: null,
        activeTeams,
        teamsById,
        bots: [],
        foods: [],
        powerups: [],
        projectiles: [],
        particles: [],
        events: [],
        eventSequence: 0,
        matchEndFrame: null,
        control: {
            paused: automationMode === 'record' || automationMode === 'seed',
            preventAutoRestart: automationMode === 'record' || automationMode === 'seed',
            logicOnly: automationMode === 'seed',
            suppressVisualEffects: false,
            suppressDomUi: false,
            suppressEventLog: false,
            recordingPresentationTimeSeconds: null,
            recordingFrameIndex: null
        },
        runtime,
        audioManager,
        style: runtime.style,
        arena: null,
        randomStreams: null,
        baseSeed: gameConfig.seed,
        currentSeed: gameConfig.seed,
        roundIndex: 0,
        match: {
            maxFrames: gameConfig.match.maxFrames,
            winnerDisplayFrames: gameConfig.match.winnerDisplayFrames,
            timeoutWinnerRule: gameConfig.match.timeoutWinnerRule,
            endedBy: null
        },

        randomValue(channel) {
            return this.randomStreams.random(channel);
        },

        emitGameEvent(type, payload = {}) {
            if (this.control.logicOnly) {
                const event = { sequence: this.eventSequence++, frame: this.frameCount, type };
                if (SEED_EVENT_TYPES.has(type)) this.events.push(event);
                return event;
            }
            const event = Object.freeze({
                sequence: this.eventSequence++,
                frame: this.frameCount,
                recordingTimeSeconds: Number.isFinite(this.control.recordingPresentationTimeSeconds)
                    ? this.control.recordingPresentationTimeSeconds
                    : null,
                recordingFrameIndex: Number.isFinite(this.control.recordingFrameIndex)
                    ? this.control.recordingFrameIndex
                    : null,
                type,
                payload: Object.freeze({ ...payload })
            });
            if (!this.control.suppressEventLog) {
                this.events.push(event);
                this.audioManager.handleEvent(event);
            }
            return event;
        },

        emitEffect(effectName, data = {}) {
            if (this.control.logicOnly || this.control.suppressVisualEffects) return;
            const descriptors = this.style.createEffectParticles(effectName, data, this) || [];
            for (const descriptor of descriptors) {
                if (!descriptor || !Number.isFinite(descriptor.x) || !Number.isFinite(descriptor.y)) continue;
                this.particles.push(new Particle(descriptor));
            }
        },

        concludeMatch(team, reason = 'elimination') {
            if (this.state !== 'playing') return;
            this.state = 'climax';
            this.climaxTimer = 0;
            this.winningTeam = team || null;
            this.match.endedBy = reason;
            this.matchEndFrame = this.frameCount;
            this.emitGameEvent('match-end', {
                teamId: this.winningTeam?.id || null, reason,
                worldWidth: this.width, worldHeight: this.height
            });
            if (!this.control.logicOnly && !this.control.suppressDomUi) uiManager.showWinner(this.winningTeam, reason);
        },

        triggerKill(bot) {
            if (!bot.alive) return;
            bot.alive = false;
            this.emitGameEvent('bot-death', {
                botId: bot.id, teamId: bot.team.id, x: bot.x, y: bot.y, health: bot.power,
                worldWidth: this.width, worldHeight: this.height
            });
            this.emitEffect('bot-death', { bot, x: bot.x, y: bot.y, teamId: bot.team.id });

            const aliveTeamIds = new Set();
            for (const candidate of this.bots) {
                if (candidate.alive) aliveTeamIds.add(candidate.team.id);
            }
            if (aliveTeamIds.size <= 1) {
                const winningTeamId = aliveTeamIds.values().next().value;
                this.concludeMatch(winningTeamId ? this.teamsById[winningTeamId] : null, 'elimination');
            }
        }
    };

    game.arena = new ArenaManager(runtime.mapModule, {
        options: { ...runtime.mapOptions, targetFps: gameConfig.targetFps },
        random: () => game.randomValue('map')
    });

    const uiManager = createUIManager(game);
    if (!game.control.logicOnly) buildScoreUI(game);

    let backgroundCacheCanvas = null;
    let backgroundCacheContext = null;
    let staticWallCacheCanvas = null;
    let staticWallCacheSource = null;

    function invalidateBackgroundCache() {
        backgroundCacheCanvas = null;
        backgroundCacheContext = null;
        staticWallCacheCanvas = null;
        staticWallCacheSource = null;
    }

    function drawBackgroundLayer() {
        if (game.style.backgroundIsStatic !== true || typeof context.drawImage !== 'function') {
            game.style.drawBackground(context, game);
            return;
        }

        if (!backgroundCacheCanvas || backgroundCacheCanvas.width !== game.width || backgroundCacheCanvas.height !== game.height) {
            const cache = document.createElement('canvas');
            if (typeof cache.getContext !== 'function') {
                game.style.drawBackground(context, game);
                return;
            }
            cache.width = game.width;
            cache.height = game.height;
            const cacheContext = cache.getContext('2d', { alpha: false });
            if (!cacheContext) {
                game.style.drawBackground(context, game);
                return;
            }
            game.style.drawBackground(cacheContext, game);
            backgroundCacheCanvas = cache;
            backgroundCacheContext = cacheContext;
        }
        context.drawImage(backgroundCacheCanvas, 0, 0);
    }

    function drawWallsLayer() {
        const walls = game.arena.walls;
        if (typeof context.drawImage !== 'function') {
            for (const wall of walls) game.style.drawWall(context, wall, game);
            return;
        }

        if (!staticWallCacheCanvas || staticWallCacheSource !== walls ||
            staticWallCacheCanvas.width !== game.width || staticWallCacheCanvas.height !== game.height) {
            const cache = document.createElement('canvas');
            if (typeof cache.getContext !== 'function') {
                for (const wall of walls) game.style.drawWall(context, wall, game);
                return;
            }
            cache.width = game.width;
            cache.height = game.height;
            const cacheContext = cache.getContext('2d');
            if (!cacheContext) {
                for (const wall of walls) game.style.drawWall(context, wall, game);
                return;
            }
            for (const wall of walls) {
                if (!wall.motion) game.style.drawWall(cacheContext, wall, game);
            }
            staticWallCacheCanvas = cache;
            staticWallCacheSource = walls;
        }

        context.drawImage(staticWallCacheCanvas, 0, 0);
        for (const wall of walls) {
            if (wall.motion) game.style.drawWall(context, wall, game);
        }
    }

    function resizeCanvas({ resizeArena = true } = {}) {
        const dimensions = applyViewportLayout(viewportSpec);
        const dimensionsChanged = canvas.width !== dimensions.width || canvas.height !== dimensions.height;
        if (dimensionsChanged) {
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
            game.width = dimensions.width;
            game.height = dimensions.height;
            invalidateBackgroundCache();
            if (resizeArena && game.arena.definition) game.arena.resize(game.width, game.height, game.frameCount);
        }
    }

    window.addEventListener('resize', () => {
        resizeCanvas({ resizeArena: viewportSpec.mode === 'responsive' });
    });

    function spawnValidFood() {
        const probe = new Food(0, 0, geometryProvider);
        const radius = probe.radius;
        const bounds = game.arena.getBounds();
        const minX = Math.max(radius, bounds.left + radius);
        const maxX = Math.min(game.width - radius, bounds.right - radius);
        const minY = Math.max(radius, bounds.top + radius);
        const maxY = Math.min(game.height - radius, bounds.bottom - radius);
        if (minX >= maxX || minY >= maxY) return false;

        for (let attempt = 0; attempt < 30; attempt += 1) {
            const x = minX + game.randomValue('food-spawn') * (maxX - minX);
            const y = minY + game.randomValue('food-spawn') * (maxY - minY);
            if (isValidEntitySpawn(x, y, radius, game)) {
                game.foods.push(new Food(x, y, geometryProvider));
                return true;
            }
        }
        return false;
    }

    function spawnValidPowerup(targetX, targetY, requestedId = null) {
        const definition = requestedId
            ? runtime.powerups.getDefinition(requestedId)
            : runtime.powerups.pickDefinition();
        if (!definition) return false;
        const probe = new Powerup(0, 0, definition, geometryProvider);
        const radius = probe.radius;
        const bounds = game.arena.getBounds();

        for (let attempt = 0; attempt < 16; attempt += 1) {
            let x;
            let y;
            if (Number.isFinite(targetX) && Number.isFinite(targetY) && attempt === 0) {
                x = targetX;
                y = targetY;
            } else {
                x = bounds.left + radius + game.randomValue('powerup-position') * Math.max(1, bounds.width - radius * 2);
                y = bounds.top + radius + game.randomValue('powerup-position') * Math.max(1, bounds.height - radius * 2);
            }

            if (isValidEntitySpawn(x, y, radius, game)) {
                game.powerups.push(new Powerup(x, y, definition, geometryProvider));
                return true;
            }
        }
        return false;
    }

    function spawnBot(team, memberIndex) {
        const memberNumber = memberIndex + 1;
        const id = `${team.id}-${memberNumber}`;
        const aiId = gameConfig.selection.botAI[id] || team.defaultAI || gameConfig.selection.defaultAIId;
        const zone = game.arena.getSpawnZone(team.id);
        const spawnRandom = game.randomStreams.stream(`spawn:${id}`);
        let position = { x: zone.x, y: zone.y };

        const aiRandom = game.randomStreams.stream(`ai:${id}`);
        const aiController = runtime.createAIController(aiId, {
            config: CONFIG,
            gameConfig,
            random: () => aiRandom.next(),
            botId: id,
            teamId: team.id,
            memberNumber
        });
        const bot = new Bot({
            id,
            team,
            x: position.x,
            y: position.y,
            aiId,
            aiController,
            geometryProvider,
            powerupSystem: runtime.powerups,
            random: () => game.randomValue(`bot:${id}`),
            initialCooldownFrames: gameConfig.bots.initialCooldownFrames
        });

        for (let attempt = 0; attempt < gameConfig.bots.spawnAttempts; attempt += 1) {
            const candidate = sampleSpawnZone(
                zone,
                memberIndex,
                team.members,
                gameConfig.bots.positionJitter,
                () => spawnRandom.next()
            );
            if (isValidEntitySpawn(candidate.x, candidate.y, bot.radius, game)) {
                position = candidate;
                break;
            }
        }
        bot.x = position.x;
        bot.y = position.y;
        return bot;
    }

    function resolveRoundSeed() {
        if (gameConfig.match.restartSeedPolicy === 'increment' && game.roundIndex > 0) {
            return `${game.baseSeed}::round-${game.roundIndex}`;
        }
        return game.baseSeed;
    }

    function initialiseGame({ incrementRound = false } = {}) {
        if (incrementRound) game.roundIndex += 1;
        game.currentSeed = resolveRoundSeed();
        game.randomStreams = createRandomStreams(game.currentSeed);
        runtime.powerups.setRandom(() => game.randomValue('powerup-type'));
        game.arena.random = () => game.randomValue('map');

        resizeCanvas({ resizeArena: false });
        game.frameCount = 0;
        game.state = 'playing';
        game.climaxTimer = 0;
        game.winningTeam = null;
        game.topBot = null;
        game.match.endedBy = null;
        game.matchEndFrame = null;
        game.events = [];
        game.eventSequence = 0;
        game.bots = [];
        game.foods = [];
        game.powerups = [];
        game.projectiles = [];
        game.particles = [];

        game.arena.reset(game.width, game.height);
        game.match.maxFrames = resolveMatchFrameLimit(gameConfig.match, game.arena.getMatchRules(), gameConfig.targetFps);

        for (let index = 0; index < CONFIG.INITIAL_FOOD; index += 1) spawnValidFood();
        for (const team of game.activeTeams) {
            for (let memberIndex = 0; memberIndex < team.members; memberIndex += 1) {
                game.bots.push(spawnBot(team, memberIndex));
            }
        }

        if (!game.control.logicOnly && !game.control.suppressDomUi) uiManager.reset();
        game.emitGameEvent('match-start', {
            seed: game.currentSeed, worldWidth: game.width, worldHeight: game.height
        });
    }

    function checkBotAndProjectileCollisions() {
        for (let firstIndex = 0; firstIndex < game.bots.length; firstIndex += 1) {
            for (let secondIndex = firstIndex + 1; secondIndex < game.bots.length; secondIndex += 1) {
                const first = game.bots[firstIndex];
                const second = game.bots[secondIndex];
                if (!first.alive || !second.alive) continue;
                const contactRadius = first.radius + second.radius;
                const deltaX = second.x - first.x;
                const deltaY = second.y - first.y;
                if (deltaX * deltaX + deltaY * deltaY > contactRadius * contactRadius) continue;

                const collision = getCollisionManifold(first.getCollider(game), second.getCollider(game));
                if (!collision) continue;

                const normalX = collision.normalX;
                const normalY = collision.normalY;
                const overlap = collision.penetration / 2 + 0.5;
                first.x -= normalX * overlap;
                first.y -= normalY * overlap;
                second.x += normalX * overlap;
                second.y += normalY * overlap;

                if (first.team.id === second.team.id) {
                    first.vx -= normalX * 2;
                    first.vy -= normalY * 2;
                    second.vx += normalX * 2;
                    second.vy += normalY * 2;
                    continue;
                }

                const winner = first.power > second.power ? first : (second.power > first.power ? second : null);
                const loser = winner === first ? second : first;
                if (!winner) {
                    first.vx -= normalX * 6;
                    first.vy -= normalY * 6;
                    second.vx += normalX * 6;
                    second.vy += normalY * 6;
                    continue;
                }

                const drain = Math.floor((loser.power + CONFIG.MELEE_DRAIN_BASE) * CONFIG.MELEE_DRAIN_PCT);
                first.vx -= normalX * 8;
                first.vy -= normalY * 8;
                second.vx += normalX * 8;
                second.vy += normalY * 8;

                if (loser.power - drain <= 0) {
                    winner.power += loser.power;
                    game.triggerKill(loser);
                } else {
                    winner.power += drain;
                    loser.power -= drain;
                    game.emitGameEvent('melee-hit', {
                        attackerId: winner.id, botId: loser.id, teamId: loser.team.id,
                        x: loser.x, y: loser.y, amount: drain, health: loser.power,
                        worldWidth: game.width, worldHeight: game.height
                    });
                    game.emitEffect('bot-hit', { bot: loser, x: loser.x, y: loser.y, amount: drain, source: 'melee' });
                }
            }
        }

        for (const projectile of game.projectiles) {
            if (!projectile.active) continue;
            const projectileCollider = projectile.getCollider(game);

            for (const bot of game.bots) {
                if (!bot.alive || bot.team.id === projectile.team.id) continue;
                const contactRadius = projectile.radius + bot.radius;
                const deltaX = bot.x - projectile.x;
                const deltaY = bot.y - projectile.y;
                if (deltaX * deltaX + deltaY * deltaY > contactRadius * contactRadius) continue;
                if (!collidersIntersect(projectileCollider, bot.getCollider(game))) continue;

                projectile.active = false;
                const defense = runtime.powerups.getModifiers(bot, game).defense;
                

                let rawDamage = projectile.damageBase + Math.floor(bot.power * projectile.damagePercent);
                if (defense.projectileImmunity) {
                    game.emitGameEvent('shield-hit', {
                        botId: bot.id, teamId: bot.team.id, x: projectile.x, y: projectile.y,
                        worldWidth: game.width, worldHeight: game.height
                    });
                    game.emitEffect('shield-hit', { bot, projectile, x: projectile.x, y: projectile.y });
                    rawDamage *= 0.05;
                }
                const totalDamage = Math.max(1, Math.round(rawDamage * defense.damageMultiplier));
                bot.vx += projectile.vx * 0.25;
                bot.vy += projectile.vy * 0.25;

                if (bot.power <= totalDamage) {
                    if (projectile.shooter.alive) projectile.shooter.power += bot.power * 0.5;
                    game.triggerKill(bot);
                } else {
                    bot.power -= totalDamage;
                    if (projectile.shooter.alive) projectile.shooter.power += totalDamage * 0.5;
                    game.emitGameEvent('projectile-hit', {
                        shooterId: projectile.shooter.id, botId: bot.id, teamId: bot.team.id,
                        x: projectile.x, y: projectile.y, amount: totalDamage, health: bot.power,
                        worldWidth: game.width, worldHeight: game.height
                    });
                    game.emitEffect('bot-hit', { bot, projectile, x: projectile.x, y: projectile.y, amount: totalDamage, source: 'projectile' });
                }
                break;
            }

            if (!projectile.active) continue;
            for (const wall of game.arena.walls) {
                if (wall.collision?.projectiles === false) continue;
                const wallCollider = createWallCollider(wall, 0, game);
                const directHit = collidersIntersect(projectileCollider, wallCollider);
                const sweptCollider = createWallCollider(wall, projectile.radius, game);
                const sweptHit = segmentIntersectsCollider(
                    projectile.previousX,
                    projectile.previousY,
                    projectile.x,
                    projectile.y,
                    sweptCollider
                );
                if (directHit || sweptHit) {
                    projectile.active = false;
                    game.emitGameEvent('projectile-wall', {
                        shooterId: projectile.shooter.id, teamId: projectile.team.id,
                        x: projectile.x, y: projectile.y, wallId: wall.id,
                        worldWidth: game.width, worldHeight: game.height
                    });
                    game.emitEffect('projectile-wall', { projectile, wall, x: projectile.x, y: projectile.y });
                    break;
                }
            }
        }
    }

    function triggerStageRewards() {
        for (const point of game.arena.getStageRewardPoints()) {
            spawnValidPowerup(
                point.x + (game.randomValue('stage-reward') - 0.5) * 100,
                point.y + (game.randomValue('stage-reward') - 0.5) * 100
            );
        }
    }

    function updatePlaying() {
        const arenaEvents = game.arena.update(game.frameCount);
        for (const event of arenaEvents) {
            if (event.type !== 'stage') continue;
            if (!game.control.logicOnly && !game.control.suppressDomUi) uiManager.setZoneStatus(event.stage, true);
            game.emitGameEvent('zone-stage', {
                stageId: event.stage.id, label: event.stage.label || event.stage.id,
                worldWidth: game.width, worldHeight: game.height
            });
            if (event.stage.rewardPowerups) triggerStageRewards();
        }

        const underdogId = (game.control.logicOnly || game.control.suppressDomUi)
            ? calculateUnderdogId(game)
            : uiManager.updateScores();

        if (game.frameCount % CONFIG.POWERUP_SPAWN_FRAMES === 0 && game.powerups.length < CONFIG.MAX_POWERUPS) {
            let targetX;
            let targetY;
            const spawnIndex = Math.floor(game.frameCount / CONFIG.POWERUP_SPAWN_FRAMES);
            if (spawnIndex % 2 === 0 && underdogId) {
                const targets = game.bots.filter(bot => bot.alive && bot.team.id === underdogId);
                if (targets.length > 0) {
                    const target = targets[Math.floor(game.randomValue('underdog-target') * targets.length)];
                    targetX = Math.max(100, Math.min(game.width - 100, target.x + (game.randomValue('underdog-target') - 0.5) * 300));
                    targetY = Math.max(100, Math.min(game.height - 100, target.y + (game.randomValue('underdog-target') - 0.5) * 300));
                }
            }
            spawnValidPowerup(targetX, targetY);
        }

        game.topBot = null;
        let maximumPower = -Infinity;
        for (const bot of game.bots) {
            if (bot.alive && bot.power > maximumPower) {
                maximumPower = bot.power;
                game.topBot = bot;
            }
        }

        for (const powerup of game.powerups) powerup.update(game);
        for (const bot of game.bots) bot.update(game);
        for (const projectile of game.projectiles) projectile.update(game);
        checkBotAndProjectileCollisions();

        if (game.foods.length < CONFIG.MAX_FOOD && game.randomValue('food-chance') < CONFIG.FOOD_SPAWN_CHANCE) {
            spawnValidFood();
        }

        if (game.state === 'playing' && game.frameCount >= game.match.maxFrames) {
            game.concludeMatch(resolveTimeoutWinner(game.activeTeams, game.bots, game.match.timeoutWinnerRule), 'timeout');
        }
    }

    function updateClimax() {
        game.climaxTimer += 1;
        
        // for (const bot of game.bots) {
        //     if (!bot.alive) continue;
        //     bot.vx += (game.arena.centerX - bot.x) * 0.005;
        //     bot.vy += (game.arena.centerY - bot.y) * 0.005;
        //     bot.vx *= 0.92;
        //     bot.vy *= 0.92;
        //     bot.x += bot.vx;
        //     bot.y += bot.vy;
        // }
        if (!game.control.preventAutoRestart && gameConfig.match.autoRestart && game.climaxTimer > game.match.winnerDisplayFrames) {
             initialiseGame({ incrementRound: true });
        }
    }

    function compactActiveEntities(entities) {
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < entities.length; readIndex += 1) {
            const entity = entities[readIndex];
            if (!entity.active) continue;
            entities[writeIndex++] = entity;
        }
        entities.length = writeIndex;
    }

    function updateCommonEntities() {
        for (const food of game.foods) food.update(game);
        compactActiveEntities(game.foods);
        compactActiveEntities(game.powerups);
        compactActiveEntities(game.projectiles);

        if (game.control.logicOnly) return;
        let particleWriteIndex = 0;
        for (let particleReadIndex = 0; particleReadIndex < game.particles.length; particleReadIndex += 1) {
            const particle = game.particles[particleReadIndex];
            particle.update();
            if (particle.life <= 0) continue;
            game.particles[particleWriteIndex++] = particle;
        }
        game.particles.length = particleWriteIndex;
    }

    function simulateStep() {
        game.frameCount += 1;
        if (game.state === 'playing') updatePlaying();
        else updateClimax();
        updateCommonEntities();
    }

    function uiNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function drawCoreTeamPanels() {
        const panelConfig = game.gameConfig.ui?.teamPanels || {};
        if (panelConfig.enabled === false) return;
        if (typeof game.style.drawTeamPanels === 'function') {
            game.style.drawTeamPanels(context, game);
            return;
        }
        const stats = collectTeamStats(game);
        const panelWidth = uiNumber(panelConfig.width, 282);
        const panelHeight = uiNumber(panelConfig.height, 102);
        const marginX = uiNumber(panelConfig.marginX, 24);
        const marginY = uiNumber(panelConfig.marginY, 24);
        const cornerRadius = uiNumber(panelConfig.cornerRadius, 9);
        const colorBarWidth = uiNumber(panelConfig.colorBarWidth, 14);
        const teamNameFontSize = uiNumber(panelConfig.teamNameFontSize, 22);
        const healthFontSize = uiNumber(panelConfig.healthFontSize, 35);
        const activeFontSize = uiNumber(panelConfig.activeFontSize, 25);
        const teamNameX = uiNumber(panelConfig.teamNameX, 31);
        const teamNameY = uiNumber(panelConfig.teamNameY, 28);
        const healthX = uiNumber(panelConfig.healthX, 31);
        const healthY = uiNumber(panelConfig.healthY, 68);
        const activeRightPadding = uiNumber(panelConfig.activeRightPadding, 17);
        const activeY = uiNumber(panelConfig.activeY, 69);
        const positions = [
            [marginX, marginY],
            [game.width - panelWidth - marginX, marginY],
            [marginX, game.height - panelHeight - marginY],
            [game.width - panelWidth - marginX, game.height - panelHeight - marginY]
        ];
        context.save();
        context.textBaseline = 'middle';
        game.activeTeams.forEach((team, index) => {
            const [x, y] = positions[index] || positions[positions.length - 1];
            const visual = game.style.getTeamVisual?.(team.id) || { main: '#ffffff' };
            const state = stats.get(team.id);
            context.fillStyle = 'rgba(255,255,255,0.91)';
            context.strokeStyle = '#111111';
            context.lineWidth = 3;
            context.beginPath();
            if (typeof context.roundRect === 'function') context.roundRect(x, y, panelWidth, panelHeight, cornerRadius);
            else context.rect(x, y, panelWidth, panelHeight);
            context.fill();
            context.stroke();
            context.fillStyle = visual.main;
            context.fillRect(x, y, colorBarWidth, panelHeight);
            context.strokeStyle = '#111111';
            context.lineWidth = 2;
            context.strokeRect(x, y, colorBarWidth, panelHeight);
            context.fillStyle = '#111111';
            context.textAlign = 'left';
            context.font = `800 ${teamNameFontSize+4}px Inter, ui-sans-serif, system-ui, sans-serif`;
            context.fillText(String(team.label || team.id).toUpperCase(), x + teamNameX, y + teamNameY);
            context.font = `850 ${healthFontSize+4}px Inter, ui-sans-serif, system-ui, sans-serif`;
            context.fillText(String(Math.max(0, Math.floor(state?.health || 0))), x + healthX, y + healthY);
            context.font = `800 ${activeFontSize+4}px Inter, ui-sans-serif, system-ui, sans-serif`;
            context.fillStyle = 'rgba(17,17,17,0.76)';
            context.textAlign = 'right';
            context.fillText(`ACTIVE ${state?.alive || 0}/${state?.members || team.members || 0}`, x + panelWidth - activeRightPadding, y + activeY);
        });
        context.restore();
    }

    function drawCoreWinnerOverlay() {
        const overlayConfig = game.gameConfig.ui?.winnerOverlay || {};
        if (game.state !== 'climax' || overlayConfig.enabled === false) return;
        if (typeof game.style.drawWinnerOverlay === 'function') {
            game.style.drawWinnerOverlay(context, game);
            return;
        }
        const team = game.winningTeam;
        const visual = team ? (game.style.getTeamVisual?.(team.id) || { main: '#ffffff' }) : { main: '#ffffff' };
        const text = game.style.formatWinnerText?.(team, game, game.match.endedBy)
            || (team ? `${team.label.toUpperCase()} WINS` : 'DRAW');
        const width = Math.min(uiNumber(overlayConfig.width, 680), game.width * 0.90);
        const height = uiNumber(overlayConfig.height, 154);
        const centerY = Number.isFinite(Number(overlayConfig.centerY)) ? Number(overlayConfig.centerY) : game.height * 0.5;
        const fontSize = uiNumber(overlayConfig.fontSize, 62);
        const colorBarWidth = uiNumber(overlayConfig.colorBarWidth, 18);
        const cornerRadius = uiNumber(overlayConfig.cornerRadius, 13);
        const x = (game.width - width) / 2;
        const y = centerY - height / 2;
        context.save();
        context.fillStyle = 'rgba(255,255,255,0.94)';
        context.strokeStyle = '#111111';
        context.lineWidth = 4;
        context.beginPath();
        if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, cornerRadius);
        else context.rect(x, y, width, height);
        context.fill();
        context.stroke();
        context.fillStyle = visual.main;
        context.fillRect(x, y, colorBarWidth, height);
        context.strokeStyle = '#111111';
        context.lineWidth = 2;
        context.strokeRect(x, y, colorBarWidth, height);
        context.fillStyle = '#111111';
        context.font = `850 ${fontSize+3}px Inter, ui-sans-serif, system-ui, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, game.width / 2 + colorBarWidth * 0.28, centerY, width - colorBarWidth - 34);
        context.restore();
    }

    function render() {
        drawBackgroundLayer();
        game.style.drawZone(context, game.arena, game);
        drawWallsLayer();
        for (const food of game.foods) game.style.drawFood(context, food, game);
        for (const powerup of game.powerups) game.style.drawPowerup(context, powerup, game);
        for (const projectile of game.projectiles) game.style.drawProjectile(context, projectile, game);
        for (const particle of game.particles) game.style.drawParticle(context, particle, game);

        const orderedBots = game._renderBotOrder || (game._renderBotOrder = []);
        orderedBots.length = 0;
        for (const bot of game.bots) if (bot.alive) orderedBots.push(bot);
        orderedBots.sort((first, second) => first.power - second.power);
        for (const bot of orderedBots) game.style.drawBot(context, bot, game);
        game.style.drawDisplayText?.(context, game, game.gameConfig.displayText);
        game.style.drawOverlay?.(context, game);
        drawCoreTeamPanels();

        if (game.state === 'climax' && game.winningTeam) {
            const radius = game.climaxTimer * 30;
            const maximumRadius = Math.max(game.width, game.height) * 1.5;
            if (radius < maximumRadius) {
                game.style.drawClimaxRing(context, game, radius, 1 - radius / maximumRadius, game.winningTeam);
            }
        }
        drawCoreWinnerOverlay();
    }

    let lastTimestamp = null;
    let accumulatorFrames = 0;
    function loop(timestamp) {
        if (lastTimestamp === null) {
            lastTimestamp = timestamp;
            accumulatorFrames = 1;
        } else {
            const elapsedSeconds = Math.min(0.25, Math.max(0, timestamp - lastTimestamp) / 1000);
            lastTimestamp = timestamp;
            accumulatorFrames += elapsedSeconds * gameConfig.targetFps * gameConfig.timeScale;
        }

        let steps = 0;
        if (game.control.paused) accumulatorFrames = 0;
        const maximumSteps = Math.max(12, Math.ceil(gameConfig.timeScale * 8));
        while (!game.control.paused && accumulatorFrames >= 1 && steps < maximumSteps) {
            simulateStep();
            accumulatorFrames -= 1;
            steps += 1;
        }
        if (steps === maximumSteps && accumulatorFrames > maximumSteps) accumulatorFrames = maximumSteps;

        render();
        requestAnimationFrame(loop);
    }

    const seedFinder = new SeedFinder({
        prepare(seed) {
            game.control.paused = true;
            game.control.preventAutoRestart = true;
            audioManager.setLiveEnabled(false);
            game.baseSeed = String(seed);
            game.roundIndex = 0;
            initialiseGame();
        },
        step(count) {
            const steps = Math.max(0, Math.round(Number(count) || 0));
            for (let index = 0; index < steps; index += 1) simulateStep();
        },
        snapshot() { return createSeedSnapshot(game); },
        events() { return game.events.slice(); },
        state() { return game.state; },
        frameCount() { return game.frameCount; }
    }, gameConfig.seedFinder);

    async function captureRealtimeToDownload(options = {}) {
        if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
            throw new Error('Optimized capture requires MediaRecorder and canvas.captureStream() in Chromium.');
        }

        const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
        const nextPaint = () => new Promise(resolve => requestAnimationFrame(resolve));
        const outputFps = Math.round(Number(options.fps) || gameConfig.recording.fps || 60);
        if (![30, 60].includes(outputFps) || !gameConfig.recording.allowedFps.includes(outputFps)) {
            throw new Error('Recording fps must be an enabled value of 30 or 60.');
        }
        const captureSpeed = Math.max(0.25, Math.min(1, Number(options.captureSpeed) || gameConfig.recording.captureSpeed || 0.5));
        const simulationFramesPerOutputSecond = gameConfig.targetFps * gameConfig.timeScale;
        const simulationFramesPerWallSecond = simulationFramesPerOutputSecond * captureSpeed;
        const sourceCaptureFps = Math.max(1, outputFps * captureSpeed);
        const sourceFrameIntervalMs = 1000 / sourceCaptureFps;
        const holdSeconds = Math.max(0, Number(options.holdSeconds) || gameConfig.recording.winnerHoldSeconds || 3);
        const holdSimulationFrames = Math.round(holdSeconds * simulationFramesPerOutputSecond);
        const desiredOutputBitrate = Math.max(4_000_000, Number(options.videoBitsPerSecond) || gameConfig.recording.videoBitsPerSecond || 18_000_000);
        const sourceBitrate = Math.max(3_000_000, Math.round(desiredOutputBitrate * captureSpeed));
        const seed = String(options.seed ?? game.currentSeed);
        const fileName = String(options.fileName || `kinetic-${seed.replace(/[^a-z0-9._-]+/gi, '_')}-${outputFps}fps-source.webm`);
        const maxSimulationFrames = Number.isFinite(Number(options.maxSimulationFrames))
            ? Math.max(1, Math.round(Number(options.maxSimulationFrames)))
            : Infinity;

        const requestedCodec = String(options.sourceCodec || 'auto').toLowerCase();
        const codecMimeTypes = {
            vp8: ['video/webm;codecs=vp8'],
            vp9: ['video/webm;codecs=vp9'],
            auto: []
        };
        if (!Object.hasOwn(codecMimeTypes, requestedCodec)) {
            throw new Error('sourceCodec must be auto, vp8, or vp9.');
        }

        // VP8 is deliberately tried before VP9. It has a lower CPU cost and is more
        // consistently available in Chromium software-encoding paths on Windows.
        const preferredMimeTypes = [
            ...codecMimeTypes[requestedCodec],
            ...(requestedCodec === 'auto' ? ['video/webm;codecs=vp8', 'video/webm;codecs=vp9'] : []),
            ...(Array.isArray(options.mimeTypes) ? options.mimeTypes : []),
            ...(Array.isArray(gameConfig.recording.mimeTypes) ? gameConfig.recording.mimeTypes : []),
            'video/webm'
        ];
        const supportedMimeTypes = [...new Set(preferredMimeTypes)]
            .filter(type => type && MediaRecorder.isTypeSupported?.(type));
        if (!supportedMimeTypes.length) supportedMimeTypes.push('');

        game.control.paused = true;
        game.control.preventAutoRestart = true;
        game.control.logicOnly = false;
        audioManager.setLiveEnabled(false);
        game.baseSeed = seed;
        game.roundIndex = 0;
        initialiseGame();
        render();

        async function stopRecorderAndCollect(recorder, chunks, { requestFinalData = true } = {}) {
            if (!recorder || recorder.state === 'inactive') {
                return new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
            }

            if (requestFinalData && typeof recorder.requestData === 'function') {
                const dataArrived = new Promise(resolve => {
                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        resolve();
                    };
                    recorder.addEventListener('dataavailable', finish, { once: true });
                    setTimeout(finish, 1000);
                });
                try { recorder.requestData(); } catch {}
                await dataArrived;
            }

            const stopped = new Promise((resolve, reject) => {
                recorder.addEventListener('stop', resolve, { once: true });
                recorder.addEventListener('error', event => {
                    reject(event.error || new Error('MediaRecorder failed while stopping.'));
                }, { once: true });
            });
            recorder.stop();
            await stopped;
            // Let the final dataavailable listener run before the Blob is assembled.
            await delay(50);
            return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        }

        async function probeMimeType(mimeType) {
            const probeStream = canvas.captureStream(0);
            const probeTrack = probeStream.getVideoTracks()[0];
            const manualFrames = typeof probeTrack?.requestFrame === 'function';
            const chunks = [];
            let recorderError = null;
            const recorderOptions = { videoBitsPerSecond: Math.min(sourceBitrate, 6_000_000) };
            if (mimeType) recorderOptions.mimeType = mimeType;
            let recorder;
            try {
                recorder = new MediaRecorder(probeStream, recorderOptions);
                recorder.addEventListener('dataavailable', event => {
                    if (event.data?.size) chunks.push(event.data);
                });
                recorder.addEventListener('error', event => {
                    recorderError = event.error || new Error('MediaRecorder codec probe failed.');
                });
                recorder.start(150);
                await delay(50);
                const context = canvas.getContext('2d');
                for (let index = 0; index < 12; index += 1) {
                    render();
                    // Force a real pixel mutation during the probe. The actual match is
                    // reinitialized after probing, so this marker is never recorded.
                    context.save();
                    context.globalAlpha = 1;
                    context.fillStyle = index % 2 ? '#000001' : '#000002';
                    context.fillRect(canvas.width - 1, canvas.height - 1, 1, 1);
                    context.restore();
                    if (manualFrames) probeTrack.requestFrame();
                    await delay(25);
                }
                await delay(200);
                const blob = await stopRecorderAndCollect(recorder, chunks);
                return {
                    ok: !recorderError && blob.size > 0,
                    bytes: blob.size,
                    mimeType: recorder.mimeType || mimeType || 'video/webm',
                    manualFrames,
                    error: recorderError?.message || null
                };
            } catch (error) {
                return {
                    ok: false,
                    bytes: 0,
                    mimeType,
                    manualFrames,
                    error: error?.message || String(error)
                };
            } finally {
                probeStream.getTracks().forEach(track => track.stop());
            }
        }

        const codecDiagnostics = [];
        let selectedMimeType = '';
        for (const candidate of supportedMimeTypes) {
            const diagnostic = await probeMimeType(candidate);
            codecDiagnostics.push(diagnostic);
            if (diagnostic.ok) {
                selectedMimeType = candidate;
                break;
            }
        }
        if (!codecDiagnostics.some(item => item.ok)) {
            const details = codecDiagnostics
                .map(item => `${item.mimeType || 'browser-default'}=${item.bytes}B${item.error ? ` (${item.error})` : ''}`)
                .join(', ');
            throw new Error(`MEDIARECORDER_NO_VIDEO: Chromium could not encode canvas frames with any supported WebM codec. ${details}`);
        }

        // Reset after the codec probe so stale probe pixels are not exposed while the
        // real recording stream is assembled. The game is initialized once more after
        // MediaRecorder starts so match-start audio and the first requested video frame
        // share the same stream clock.
        initialiseGame();
        render();

        // frameRate=0 disables automatic capture. Explicit requestFrame() calls make
        // headless Chromium capture completed canvas renders instead of depending on
        // compositor-driven automatic frame production, which can yield an empty Blob.
        let videoStream = canvas.captureStream(0);
        let videoTrack = videoStream.getVideoTracks()[0];
        let manualFrameCapture = typeof videoTrack?.requestFrame === 'function';
        if (!manualFrameCapture) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = canvas.captureStream(sourceCaptureFps);
            videoTrack = videoStream.getVideoTracks()[0];
        }

        // Record video only. The final soundtrack is synthesized after capture from
        // frame-indexed deterministic events. This avoids WebAudio/MediaStream latency
        // and avoids transient displacement introduced by FFmpeg atempo compression.
        audioManager.setMonitorEnabled(false);
        audioManager.setLiveEnabled(false);
        const stream = new MediaStream([...videoStream.getVideoTracks()]);
        const audioTracks = [];

        const chunks = [];
        let recorderError = null;
        let dataChunkCount = 0;
        let dataBytes = 0;
        const recorderMimeCandidates = [
            selectedMimeType,
            'video/webm'
        ].filter((value, index, values) => value && values.indexOf(value) === index);
        let recorder = null;
        let selectedRecordingMimeType = '';
        let recorderConstructionError = null;
        for (const mimeType of recorderMimeCandidates) {
            try {
                const recorderOptions = { videoBitsPerSecond: sourceBitrate, mimeType };
                recorder = new MediaRecorder(stream, recorderOptions);
                selectedRecordingMimeType = mimeType;
                break;
            } catch (error) {
                recorderConstructionError = error;
            }
        }
        if (!recorder) {
            try {
                recorder = new MediaRecorder(stream, { videoBitsPerSecond: sourceBitrate });
            } catch (error) {
                audioManager.setMonitorEnabled(true);
                stream.getTracks().forEach(track => track.stop());
                throw recorderConstructionError || error;
            }
        }
        recorder.addEventListener('dataavailable', event => {
            if (event.data?.size) {
                chunks.push(event.data);
                dataChunkCount += 1;
                dataBytes += event.data.size;
            }
        });
        recorder.addEventListener('error', event => {
            recorderError = event.error || new Error('MediaRecorder failed.');
        });

        const started = new Promise((resolve, reject) => {
            let settled = false;
            const finish = callback => value => {
                if (settled) return;
                settled = true;
                callback(value);
            };
            recorder.addEventListener('start', finish(resolve), { once: true });
            recorder.addEventListener('error', finish(event => reject(event.error || new Error('MediaRecorder failed to start.'))), { once: true });
            setTimeout(finish(resolve), 1000);
        });
        try {
            recorder.start(500);
            await started;
            if (recorder.state !== 'recording') {
                throw new Error(`MEDIARECORDER_START_FAILED: recorder state is ${recorder.state}.`);
            }
        } catch (error) {
            audioManager.setLiveEnabled(false);
            audioManager.setMonitorEnabled(true);
            audioManager.setCueTimeStretch(1);
            stream.getTracks().forEach(track => track.stop());
            throw error;
        }

        // Recording is frame-paced rather than requestAnimationFrame-paced. Physics
        // remains authoritative at targetFps (normally 60 Hz), while expensive style
        // rendering runs only once per requested output frame (30 or 60 Hz). This
        // prevents a 30 fps export from drawing the complete scene at 60 fps.
        audioManager.setCueTimeStretch(1);
        audioManager.setLiveEnabled(false);
        const captureStartedAt = performance.now();
        const simulationFramesPerVideoFrame = simulationFramesPerOutputSecond / outputFps;
        game.control.recordingPresentationTimeSeconds = 0;
        game.control.recordingFrameIndex = 0;
        initialiseGame();

        let requestedVideoFrames = 0;
        let missedCaptureIntervals = 0;
        let stopSimulationFrame = null;
        let renderedFrames = 0;
        let maximumFrameGapMs = 0;
        let maximumScheduleLagMs = 0;
        let lateFrameCount = 0;
        let maximumRenderTimeMs = 0;
        let totalRenderTimeMs = 0;
        let catchUpSteps = 0;
        let outputFrameIndex = 0;
        let previousSubmissionTime = captureStartedAt;
        let nextFrameDeadline = captureStartedAt;

        try {
            while (true) {
                const frameWorkStartedAt = performance.now();
                game.control.recordingPresentationTimeSeconds = outputFrameIndex / outputFps;
                game.control.recordingFrameIndex = outputFrameIndex;

                const targetSimulationFrame = Math.min(
                    maxSimulationFrames,
                    Math.max(game.frameCount, Math.round(outputFrameIndex * simulationFramesPerVideoFrame))
                );
                while (game.frameCount < targetSimulationFrame) simulateStep();

                render();
                renderedFrames += 1;
                if (manualFrameCapture) videoTrack.requestFrame();
                requestedVideoFrames += 1;

                const submittedAt = performance.now();
                const submissionGapMs = submittedAt - previousSubmissionTime;
                previousSubmissionTime = submittedAt;
                maximumFrameGapMs = Math.max(maximumFrameGapMs, submissionGapMs);
                const renderTimeMs = submittedAt - frameWorkStartedAt;
                maximumRenderTimeMs = Math.max(maximumRenderTimeMs, renderTimeMs);
                totalRenderTimeMs += renderTimeMs;

                if (game.matchEndFrame !== null && stopSimulationFrame === null) {
                    stopSimulationFrame = game.matchEndFrame + holdSimulationFrames;
                }
                if (stopSimulationFrame !== null && game.frameCount >= stopSimulationFrame) break;
                if (game.frameCount >= maxSimulationFrames) break;
                if (recorderError) throw recorderError;

                outputFrameIndex += 1;
                nextFrameDeadline += sourceFrameIntervalMs;
                const remainingMs = nextFrameDeadline - performance.now();
                if (remainingMs > 1) {
                    await delay(remainingMs);
                } else if (remainingMs < 0) {
                    const lagMs = -remainingMs;
                    maximumScheduleLagMs = Math.max(maximumScheduleLagMs, lagMs);
                    lateFrameCount += 1;
                    // Never skip or burst frames. Reset the wall-clock deadline and let
                    // capture take longer; MP4 timing is rebuilt from frame indices.
                    nextFrameDeadline = performance.now();
                }
            }

            // Give MediaRecorder multiple source-frame intervals to drain the final
            // requested frame without drawing or advancing the simulation again.
            await delay(Math.max(650, sourceFrameIntervalMs * 2));
            const blob = await stopRecorderAndCollect(recorder, chunks);
            if (recorderError) throw recorderError;
            if (!blob.size) {
                throw new Error(
                    `MEDIARECORDER_EMPTY_VIDEO: no encoded bytes were produced; ` +
                    `mime=${recorder.mimeType || selectedMimeType || 'default'}, ` +
                    `manualFrames=${manualFrameCapture}, requestedFrames=${requestedVideoFrames}, ` +
                    `trackState=${videoTrack?.readyState || 'unknown'}, chunks=${dataChunkCount}.`
                );
            }

            let transfer = null;
            if (options.uploadUrl) {
                const response = await fetch(String(options.uploadUrl), {
                    method: 'POST',
                    headers: { 'X-Kinetic-Filename': fileName, 'Content-Type': blob.type || 'video/webm' },
                    body: blob
                });
                if (!response.ok) throw new Error(`Capture transfer failed: HTTP ${response.status}.`);
                transfer = await response.json();
            } else {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 120_000);
            }

            return {
                fileName,
                mimeType: blob.type,
                selectedMimeType: recorder.mimeType || selectedRecordingMimeType || selectedMimeType,
                codecDiagnostics,
                bytes: blob.size,
                dataChunkCount,
                dataBytes,
                transfer,
                seed,
                outputFps,
                sourceCaptureFps,
                captureSpeed,
                desiredOutputBitrate,
                sourceBitrate,
                simulationFramesPerOutputSecond,
                simulationFramesPerWallSecond,
                frameCount: game.frameCount,
                matchEndFrame: game.matchEndFrame,
                winnerTeamId: game.winningTeam?.id || null,
                endedBy: game.match.endedBy,
                renderedFrames,
                requestedVideoFrames,
                missedCaptureIntervals,
                manualFrameCapture,
                audioTrackCount: audioTracks.length,
                audioContextState: audioManager.context?.state || null,
                trackSettings: videoTrack?.getSettings?.() || null,
                captureWallSeconds: (performance.now() - captureStartedAt) / 1000,
                maximumFrameGapMs,
                maximumScheduleLagMs,
                lateFrameCount,
                maximumRenderTimeMs,
                averageRenderTimeMs: renderedFrames > 0 ? totalRenderTimeMs / renderedFrames : 0,
                catchUpSteps,
                fixedFramePacing: true,
                maxSimulationFrames: Number.isFinite(maxSimulationFrames) ? maxSimulationFrames : null
            };
        } finally {
            game.control.recordingPresentationTimeSeconds = null;
            game.control.recordingFrameIndex = null;
            audioManager.setLiveEnabled(false);
            audioManager.setMonitorEnabled(true);
            audioManager.setCueTimeStretch(1);
            if (recorder.state !== 'inactive') {
                try { recorder.stop(); } catch {}
            }
            stream.getTracks().forEach(track => track.stop());
        }
    }

    function replayChecksum() {
        let hash = 2166136261;
        const mix = value => {
            const text = String(value);
            for (let index = 0; index < text.length; index += 1) {
                hash ^= text.charCodeAt(index);
                hash = Math.imul(hash, 16777619);
            }
        };
        mix(game.currentSeed);
        mix(game.frameCount);
        mix(game.matchEndFrame ?? -1);
        mix(game.winningTeam?.id || 'draw');
        for (const bot of game.bots) {
            mix(bot.id);
            mix(bot.alive ? 1 : 0);
            mix(Math.round(bot.power * 1000));
            mix(Math.round(bot.x * 1000));
            mix(Math.round(bot.y * 1000));
        }
        for (const food of game.foods) {
            mix(Math.round(food.x * 1000));
            mix(Math.round(food.y * 1000));
        }
        for (const powerup of game.powerups) {
            mix(powerup.type);
            mix(Math.round(powerup.x * 1000));
            mix(Math.round(powerup.y * 1000));
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    const recordingApi = Object.freeze({
        prepare(options = {}) {
            const seed = options.seed ?? game.currentSeed;
            game.control.paused = true;
            game.control.preventAutoRestart = true;
            game.control.suppressVisualEffects = options.suppressVisualEffects === true;
            game.control.suppressDomUi = options.suppressDomUi === true;
            game.control.suppressEventLog = options.suppressEventLog === true;
            audioManager.setLiveEnabled(false);
            game.baseSeed = String(seed);
            game.roundIndex = 0;
            initialiseGame();
            if (options.render !== false) render();
            return { ...createSnapshot(game), checksum: replayChecksum() };
        },
        runAuthoritative(options = {}) {
            const seed = options.seed ?? game.currentSeed;
            const holdFrames = Math.max(0, Math.round(Number(options.holdFrames) || 0));
            const maxFrames = Number.isFinite(Number(options.maxFrames))
                ? Math.max(1, Math.round(Number(options.maxFrames)))
                : gameConfig.match.maxFrames + holdFrames;
            this.prepare({
                seed,
                render: false,
                suppressVisualEffects: true,
                suppressDomUi: true,
                suppressEventLog: false
            });
            while (game.frameCount < maxFrames) {
                simulateStep();
                if (game.matchEndFrame !== null && game.frameCount >= game.matchEndFrame + holdFrames) break;
            }
            return {
                snapshot: { ...createSnapshot(game), checksum: replayChecksum() },
                events: game.events.map(event => ({ ...event, payload: { ...event.payload } })),
                stopSimulationFrame: game.frameCount,
                checksum: replayChecksum()
            };
        },
        stepFrames(count = 1, options = {}) {
            const steps = Math.max(0, Math.round(Number(count) || 0));
            for (let index = 0; index < steps; index += 1) simulateStep();
            if (options.render !== false) render();
            return createSnapshot(game);
        },
        stepToFrame(targetFrame, options = {}) {
            const target = Math.max(game.frameCount, Math.round(Number(targetFrame) || 0));
            while (game.frameCount < target) simulateStep();
            if (options.render !== false) render();
            return createSnapshot(game);
        },
        render,
        snapshot() { return { ...createSnapshot(game), checksum: replayChecksum() }; },
        checksum() { return replayChecksum(); },
        events() { return game.events.map(event => ({ ...event, payload: { ...event.payload } })); },
        captureToDownload: captureRealtimeToDownload,
        get settings() { return gameConfig.recording; },
        get targetFps() { return gameConfig.targetFps; }
    });

    initialiseGame();
    loadingStatus.hidden = true;
    if (!game.control.logicOnly) render();

    window.KineticArena = Object.freeze({
        get state() { return game.state; },
        get frameCount() { return game.frameCount; },
        get climaxTimer() { return game.climaxTimer; },
        get matchEndFrame() { return game.matchEndFrame; },
        get bots() { return game.bots; },
        get powerups() { return game.powerups; },
        get manifests() { return runtime.manifests; },
        get viewport() { return viewportSpec; },
        get seed() { return game.currentSeed; },
        get timeScale() { return gameConfig.timeScale; },
        get config() { return gameConfig.raw; },
        get match() { return Object.freeze({ ...game.match }); },
        get audio() { return audioManager.getState(); },
        getSnapshot() { return createSnapshot(game); },
        getEvents() { return game.events.map(event => ({ ...event, payload: { ...event.payload } })); },
        pause() { game.control.paused = true; },
        resume() {
            game.control.paused = false;
            game.control.preventAutoRestart = false;
            audioManager.setLiveEnabled(true);
            lastTimestamp = null;
        },
        stepFrames(count = 1, options = {}) {
            game.control.paused = true;
            return recordingApi.stepFrames(count, options);
        },
        restart(options = {}) {
            if (options && (typeof options.seed === 'string' || Number.isFinite(options.seed))) {
                game.baseSeed = String(options.seed);
                game.roundIndex = 0;
            }
            initialiseGame();
            render();
        },
        recording: recordingApi,
        seedFinder
    });

    if (!automationMode) requestAnimationFrame(loop);
}

function buildScoreUI(game) {
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    scoreGrid.replaceChildren();

    game.activeTeams.forEach((team, index) => {
        const box = document.createElement('section');
        box.className = 'score-box';
        box.id = `box-${team.id}`;
        box.dataset.corner = corners[index];
        box.dataset.teamId = team.id;
        game.style.styleTeamElement(box, team.id);

        const label = document.createElement('div');
        label.className = 'score-label';
        label.textContent = team.label;

        const value = document.createElement('div');
        value.className = 'score-value';
        value.id = `score-${team.id}`;
        value.textContent = String(CONFIG.STARTING_POWER * team.members);

        const count = document.createElement('div');
        count.className = 'score-count';
        count.id = `count-${team.id}`;
        count.textContent = `${team.members} bots`;

        box.append(label, value, count);
        scoreGrid.appendChild(box);
    });
}

function createUIManager(game) {
    return {
        setZoneStatus(stage, visible) {
            const text = stage
                ? (game.style.formatStageText?.(stage, game) ?? stage.label ?? stage.id)
                : '';
            zoneStatus.textContent = text;
            zoneStatus.classList.toggle('visible', Boolean(visible && text));
        },

        showWinner(team, reason) {
            game.style.styleTeamElement(statusText, team?.id);
            statusText.textContent = game.style.formatWinnerText?.(team, game, reason)
                ?? (team ? `${team.label} Dominance` : 'Mutual Destruction');
            statusText.classList.add('visible');
        },

        updateScores() {
            const teamPowers = Object.fromEntries(game.activeTeams.map(team => [team.id, 0]));
            const aliveCounts = Object.fromEntries(game.activeTeams.map(team => [team.id, 0]));
            for (const bot of game.bots) {
                if (!bot.alive) continue;
                teamPowers[bot.team.id] += bot.power;
                aliveCounts[bot.team.id] += 1;
            }

            let minimumPower = Infinity;
            let underdogId = null;
            for (const team of game.activeTeams) {
                const score = teamPowers[team.id];
                const value = document.getElementById(`score-${team.id}`);
                const count = document.getElementById(`count-${team.id}`);
                const box = document.getElementById(`box-${team.id}`);
                const scoreText = String(Math.floor(score));
                const countText = `${aliveCounts[team.id]} / ${team.members}`;
                if (value.textContent !== scoreText) value.textContent = scoreText;
                if (count.textContent !== countText) count.textContent = countText;
                box.classList.toggle('dead-score', aliveCounts[team.id] <= 0);
                if (score > 0 && score < minimumPower) {
                    minimumPower = score;
                    underdogId = team.id;
                }
            }

            for (const team of game.activeTeams) {
                const box = document.getElementById(`box-${team.id}`);
                box.classList.toggle('underdog-glow', team.id === underdogId && minimumPower < 100);
            }
            return underdogId;
        },

        reset() {
            statusText.textContent = '';
            statusText.classList.remove('visible');
            this.setZoneStatus(null, false);
            for (const team of game.activeTeams) {
                const box = document.getElementById(`box-${team.id}`);
                box.classList.remove('dead-score', 'underdog-glow');
            }
            this.updateScores();
        }
    };
}

bootstrap().catch(error => {
    console.error(error);
    loadingStatus.hidden = false;
    loadingStatus.classList.add('error');
    loadingStatus.textContent = `${error.message} Serve this folder through HTTP; JSON configuration and plugin manifests require HTTP.`;
});
