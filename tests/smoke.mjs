import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONFIG, TEAMS, applySimulationConfig } from '../js/config.js';
import { createRandomStreams } from '../js/random.js';
import { resolveMatchFrameLimit, resolveTimeoutWinner } from '../js/match-rules.js';
import { ArenaManager } from '../js/environment.js';
import { Bot } from '../js/Bot.js';
import { Food, Powerup } from '../js/entities.js';
import { PowerupSystem } from '../js/powerup-system.js';
import { SeedFinder } from '../js/seed-finder.js';
import { createWallCollider } from '../js/collision.js';
import { renderEventsToWav } from '../tools/lib/offline-audio.mjs';
import * as crossMap from '../plugins/maps/cross-compression/map.js';
import * as portraitMap from '../plugins/maps/portrait-circuit/map.js';
import { createController as createSwarmController } from '../plugins/ai/swarm-tactician/ai.js';
import { createController as createSentinelController } from '../plugins/ai/sentinel-vector/ai.js';
import { createStyle as createMinimalStyle } from '../plugins/styles/minimal-tactical/style.js';
import { createStyle as createNeonStyle } from '../plugins/styles/neon-kinetic/style.js';
import { definition as overcharge } from '../plugins/powerups/overcharge/powerup.js';
import { definition as aegis } from '../plugins/powerups/aegis/powerup.js';
import { definition as turbo } from '../plugins/powerups/turbo/powerup.js';
import { definition as regen } from '../plugins/powerups/regen/powerup.js';
import { definition as focus } from '../plugins/powerups/focus/powerup.js';
import { createAudioTheme as createMinimalAudioTheme } from '../plugins/audio/minimal-impact/audio.js';
import { createAudioTheme as createSilentAudioTheme } from '../plugins/audio/silent/audio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameConfig = JSON.parse(await fs.readFile(path.join(root, 'game-config.json'), 'utf8'));
applySimulationConfig(gameConfig.simulation);

async function validateGameConfig() {
    assert.equal(gameConfig.schemaVersion, 1);
    assert.equal(typeof gameConfig.plugins.style, 'string');
    assert.ok(gameConfig.plugins.style.length > 0);
    assert.equal(typeof gameConfig.plugins.map, 'string');
    assert.ok(gameConfig.plugins.map.length > 0);
    assert.equal(gameConfig.timeScale, 1);
    assert.equal(gameConfig.targetFps, 60);
    assert.equal(gameConfig.teams.reduce((sum, team) => sum + team.members, 0), gameConfig.bots.count);
    assert.equal(gameConfig.bots.count, 16);
    assert.ok(gameConfig.plugins.ai.enabled.includes(gameConfig.plugins.ai.default));
    assert.equal(gameConfig.plugins.audio, 'quiet-mechanism');
    assert.deepEqual(gameConfig.recording.allowedFps, [30, 60]);
    assert.equal(gameConfig.recording.width, 1080);
    assert.equal(gameConfig.recording.height, 1920);
    assert.equal(gameConfig.recording.winnerHoldSeconds, 3);
    assert.equal(gameConfig.recording.mode, 'offline-replay');
    assert.equal(gameConfig.recording.outputFormat, 'mp4');
    assert.equal(gameConfig.recording.captureSpeed, 0.5);
    assert.equal(gameConfig.recording.retryOnStall, true);
    assert.equal(gameConfig.recording.audioSyncOffsetMs, 0);
    assert.ok(gameConfig.recording.minimumCaptureSpeed >= 1 / 3 - 1e-6);
    assert.equal(gameConfig.recording.renderAtOutputFps, true);
    assert.equal(gameConfig.recording.encoderThreads, 6);
    assert.equal(gameConfig.recording.renderWorkers, 6);
    assert.equal(gameConfig.recording.maximumRenderWorkers, 6);
    assert.equal(gameConfig.recording.hardwareEncoder, 'auto');
    assert.equal(gameConfig.recording.deliveryPreset, 'instagram-hd-30');
    assert.equal(gameConfig.recording.deliveryPresets['instagram-hd-30'].fps, 30);
    assert.equal(gameConfig.recording.deliveryPresets['instagram-hd-30'].profile, 'high');
    assert.equal(gameConfig.recording.deliveryPresets['instagram-hd-30'].level, '4.1');
    assert.equal(gameConfig.recording.deliveryPresets['instagram-hd-30'].colorPrimaries, 'bt709');
    assert.equal(gameConfig.recording.deliveryPresets['instagram-hd-30'].audioSampleRate, 48000);
    assert.equal(gameConfig.recording.deliveryPresets['instagram-smooth-60'].fps, 60);
    assert.equal(gameConfig.recording.deliveryPresets['instagram-smooth-60'].maximumBitrate, '24M');
    assert.equal(gameConfig.seedFinder.logicOnly, true);
    assert.equal(gameConfig.seedFinder.retainAllResults, false);
    assert.equal(gameConfig.seedFinder.parallelWorkers, 6);
    assert.equal(gameConfig.simulation.MAX_POWERUPS, 2);
    assert.ok(gameConfig.simulation.FOOD_ATTRACTION_RANGE > 0);
    assert.ok(gameConfig.simulation.FOOD_ATTRACTION_STRENGTH > 0);
    assert.equal(typeof gameConfig.displayText.text, 'string');
    assert.equal(gameConfig.displayText.x, 540);
    assert.equal(gameConfig.displayText.y, 300);
    assert.equal(gameConfig.ui.teamPanels.enabled, true);
    assert.equal(gameConfig.ui.teamPanels.activeFontSize, 19);
    assert.equal(gameConfig.ui.teamPanels.healthFontSize, 35);
    assert.equal(gameConfig.ui.winnerOverlay.enabled, true);
    assert.equal(gameConfig.ui.winnerOverlay.fontSize, 62);
    assert.equal(gameConfig.ui.botHealth.minimumFontSize, 18);
    assert.equal(gameConfig.ui.powerupLabels.fontSize, 18);
    assert.equal(gameConfig.ui.displayText.fontSize, 54);
    assert.equal(gameConfig.ui.matchClock.fontSize, 35);
    assert.ok(gameConfig.seedFinder.scoring.categories.collectiveNearDeath);
    assert.ok(gameConfig.seedFinder.scoring.categories.dominanceSwings);
    for (const kind of ['styles', 'ai', 'maps', 'powerups', 'audio']) {
        await fs.access(path.resolve(root, gameConfig.pluginRegistry[kind]));
    }
}

async function validateManifests() {
    for (const kind of ['styles', 'ai', 'maps', 'powerups', 'audio']) {
        const manifestPath = path.join(root, 'plugins', kind, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        assert.equal(manifest.schemaVersion, 1);
        assert.ok(Array.isArray(manifest.plugins));

        const ids = new Set();
        for (const plugin of manifest.plugins) {
            assert.ok(plugin.id);
            assert.ok(!ids.has(plugin.id), `Duplicate ${kind} id: ${plugin.id}`);
            ids.add(plugin.id);
            const modulePath = path.resolve(path.dirname(manifestPath), plugin.module);
            await fs.access(modulePath);
            await import(pathToFileURL(modulePath));
            for (const cssFile of plugin.css || []) {
                await fs.access(path.resolve(path.dirname(manifestPath), cssFile));
            }
        }
    }
}


async function validateAudioAndOfflineRenderer() {
    const theme = createMinimalAudioTheme({ options: { intensity: 1 } });
    const shootEvent = {
        sequence: 7,
        frame: 60,
        type: 'shoot',
        payload: { teamId: 'cyan', x: 270, worldWidth: 1080 }
    };
    const first = theme.mapEvent(shootEvent);
    const second = theme.mapEvent(shootEvent);
    assert.deepEqual(first, second, 'Audio event mapping must be deterministic.');
    assert.ok(first.length > 0);
    assert.deepEqual(createSilentAudioTheme().mapEvent(shootEvent), []);

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-audio-test-'));
    const outputPath = path.join(directory, 'test.wav');
    try {
        await renderEventsToWav({
            events: [
                { sequence: 0, frame: 0, type: 'match-start', payload: {} },
                shootEvent
            ],
            audioTheme: theme,
            eventFrameRate: 60,
            sampleRate: 48000,
            durationSeconds: 1.5,
            outputPath,
            masterVolume: 0.7
        });
        const wav = await fs.readFile(outputPath);
        assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
        assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
        assert.ok(wav.length > 44);


        const presentationPath = path.join(directory, 'presentation-time.wav');
        await renderEventsToWav({
            events: [{ sequence: 1, frame: 60, recordingTimeSeconds: 0.25, type: 'pulse', payload: {} }],
            audioTheme: {
                mapEvent() {
                    return [{ type: 'tone', duration: 0.04, frequency: 440, gain: 0.5, waveform: 'sine' }];
                }
            },
            eventFrameRate: 60,
            sampleRate: 48000,
            durationSeconds: 1.25,
            outputPath: presentationPath,
            masterVolume: 0.7
        });
        const presentationWav = await fs.readFile(presentationPath);
        let firstActiveFrame = -1;
        for (let offset = 44, frameIndex = 0; offset + 3 < presentationWav.length; offset += 4, frameIndex += 1) {
            const left = Math.abs(presentationWav.readInt16LE(offset));
            const right = Math.abs(presentationWav.readInt16LE(offset + 2));
            if (left > 8 || right > 8) {
                firstActiveFrame = frameIndex;
                break;
            }
        }
        assert.ok(firstActiveFrame >= 0);
        const firstActiveSeconds = firstActiveFrame / 48000;
        assert.ok(firstActiveSeconds >= 0.245 && firstActiveSeconds <= 0.27,
            `Fallback audio must use recorded presentation time; received ${firstActiveSeconds}s.`);


        const frameIndexPath = path.join(directory, 'frame-index.wav');
        await renderEventsToWav({
            events: [{
                sequence: 2,
                frame: 10,
                recordingTimeSeconds: 0.9,
                recordingFrameIndex: 30,
                type: 'pulse',
                payload: {}
            }],
            audioTheme: {
                mapEvent() {
                    return [{ type: 'tone', duration: 0.04, frequency: 440, gain: 0.5, waveform: 'sine' }];
                }
            },
            eventFrameRate: 60,
            outputFps: 60,
            timingMode: 'frame-index',
            syncOffsetMs: -20,
            sampleRate: 48000,
            durationSeconds: 1.25,
            outputPath: frameIndexPath,
            masterVolume: 0.7
        });
        const frameIndexWav = await fs.readFile(frameIndexPath);
        let frameIndexFirstActive = -1;
        for (let offset = 44, frameIndex = 0; offset + 3 < frameIndexWav.length; offset += 4, frameIndex += 1) {
            const left = Math.abs(frameIndexWav.readInt16LE(offset));
            const right = Math.abs(frameIndexWav.readInt16LE(offset + 2));
            if (left > 8 || right > 8) {
                frameIndexFirstActive = frameIndex;
                break;
            }
        }
        const frameIndexSeconds = frameIndexFirstActive / 48000;
        assert.ok(frameIndexSeconds >= 0.475 && frameIndexSeconds <= 0.495,
            `Frame-index audio timing must use frame/fps plus offset; received ${frameIndexSeconds}s.`);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

async function validateSeedFinderApi() {
    let frame = 0;
    let seed = '';
    const events = [];
    const snapshot = () => {
        const ended = frame >= 120;
        return {
            seed,
            frameCount: frame,
            state: ended ? 'climax' : 'playing',
            winnerTeamId: ended ? 'cyan' : null,
            endedBy: ended ? 'timeout' : null,
            teams: [
                { id: 'cyan', alive: 1, members: 1, health: 20 + frame / 12 },
                { id: 'magenta', alive: ended ? 0 : 1, members: 1, health: Math.max(0, 20 - frame / 6) }
            ],
            bots: [
                { id: 'cyan-1', teamId: 'cyan', alive: true, health: 20, x: frame, y: 0, powerups: [] },
                { id: 'magenta-1', teamId: 'magenta', alive: !ended, health: Math.max(0, 20 - frame / 6), x: 120 - frame, y: 0, powerups: [] }
            ],
            powerups: []
        };
    };
    const finder = new SeedFinder({
        prepare(nextSeed) { seed = nextSeed; frame = 0; events.length = 0; },
        step(count) {
            frame = Math.min(120, frame + count);
            if (frame >= 120 && !events.some(event => event.type === 'bot-death')) {
                events.push({ type: 'bot-death' }, { type: 'match-end' });
            }
        },
        snapshot,
        events() { return [...events]; },
        state() { return frame >= 120 ? 'climax' : 'playing'; },
        frameCount() { return frame; }
    }, { sampleEveryFrames: 30, maxFrames: 120, topK: 2 });

    const evaluation = await finder.evaluateSeed('unit-seed');
    assert.equal(evaluation.seed, 'unit-seed');
    assert.equal(evaluation.final.winnerTeamId, 'cyan');
    assert.ok(Number.isFinite(evaluation.score));

    finder.registerEvaluator('winner-only', run => ({
        score: run.final.winnerTeamId ? 100 : 0,
        components: {},
        summary: { winnerTeamId: run.final.winnerTeamId }
    }));
    const custom = await finder.evaluateSeed('custom-seed', { evaluatorId: 'winner-only' });
    assert.equal(custom.score, 100);
    const search = await finder.search({
        prefix: 'batch', count: 2, topK: 1, evaluatorId: 'winner-only', returnScores: true
    });
    assert.equal(search.searched, 2);
    assert.equal(search.top.length, 1);
    assert.equal(search.results.length, 0, 'Default seed search must keep bounded candidates only.');
    assert.equal(search.scoreValues.length, 2);

    const complete = await finder.search({
        prefix: 'complete', count: 2, topK: 1, evaluatorId: 'winner-only', retainAllResults: true
    });
    assert.equal(complete.results.length, 2, 'retainAllResults must remain available for diagnostics.');
}

function validateSeededRandom() {
    const first = createRandomStreams('same-seed');
    const second = createRandomStreams('same-seed');
    const sequenceA = Array.from({ length: 20 }, () => first.random('ai:cyan-1'));
    const sequenceB = Array.from({ length: 20 }, () => second.random('ai:cyan-1'));
    assert.deepEqual(sequenceA, sequenceB);

    const different = createRandomStreams('different-seed');
    const sequenceC = Array.from({ length: 20 }, () => different.random('ai:cyan-1'));
    assert.notDeepEqual(sequenceA, sequenceC);

    const isolated = createRandomStreams('same-seed');
    isolated.random('effects');
    const aiAfterOtherStream = Array.from({ length: 20 }, () => isolated.random('ai:cyan-1'));
    assert.deepEqual(sequenceA, aiAfterOtherStream, 'Named streams must not disturb one another.');
}


function validateMatchRules() {
    assert.equal(resolveMatchFrameLimit({ maxFrames: 3600 }, { maxFrames: 3540 }, 60), 3540);
    assert.equal(resolveMatchFrameLimit({ maxFrames: 3600 }, { maxDurationSeconds: 45 }, 60), 2700);

    const blue = { id: 'cyan' };
    const pink = { id: 'magenta' };
    const winner = resolveTimeoutWinner([blue, pink], [
        { team: blue, alive: true, power: 12 },
        { team: blue, alive: true, power: 8 },
        { team: pink, alive: true, power: 100 }
    ], 'alive-then-power');
    assert.equal(winner, blue, 'Surviving member count must outrank total power.');

    const draw = resolveTimeoutWinner([blue, pink], [
        { team: blue, alive: true, power: 20 },
        { team: pink, alive: true, power: 20 }
    ], 'alive-then-power');
    assert.equal(draw, null);
}

function validateMapContracts() {
    const crossArena = new ArenaManager(crossMap);
    crossArena.reset(1280, 720);
    assert.equal(crossArena.walls.length, 6);
    assert.equal(crossArena.walls.filter(wall => wall.motion).length, 2);
    assert.equal(crossArena.walls.filter(wall => wall.collision.projectiles === false).length, 2);

    let events = crossArena.update(1200);
    assert.equal(events[0].stage.id, 'field-compression');
    const beforeShrink = crossArena.safeSize;
    crossArena.update(1201);
    assert.ok(crossArena.safeSize < beforeShrink);
    assert.equal(crossArena.update(3600).at(-1).stage.id, 'sudden-death');
    assert.equal(crossArena.damageActive, true);

    assert.deepEqual(portraitMap.viewport, { mode: 'fixed', width: 1080, height: 1920, fit: 'contain' });
    const portraitArena = new ArenaManager(portraitMap, { options: { matchDurationSeconds: 59, targetFps: 60 } });
    portraitArena.reset(1080, 1920);
    assert.equal(portraitArena.safeHalfWidth, 510);
    assert.equal(portraitArena.safeHalfHeight, 830);
    assert.equal(portraitArena.walls.length, 6);
    assert.equal(portraitArena.walls.filter(wall => wall.motion).length, 2);
    assert.equal(portraitArena.getMatchRules().maxFrames, 3540);
    assert.equal(portraitArena.getSpawnZone('cyan').shape, 'formation');
    events = portraitArena.update(900);
    assert.equal(events[0].stage.id, 'move-in');
    assert.equal(portraitArena.targetSafeHalfWidth, 455);
    assert.equal(portraitArena.targetSafeHalfHeight, 700);
    portraitArena.update(2700);
    assert.equal(portraitArena.damageActive, true);
}

function createRuntime(seed = 'runtime-test') {
    const streams = createRandomStreams(seed);
    const powerups = new PowerupSystem([overcharge, aegis, turbo, regen, focus], {
        random: () => streams.random('powerup-type')
    });
    const style = createMinimalStyle({ config: CONFIG, teams: TEAMS, powerupDefinitions: powerups.listDefinitions() });
    return { powerups, style, streams };
}

function validateOriginalStyleCompatibility() {
    const style = createNeonStyle({ config: CONFIG, teams: TEAMS, powerupDefinitions: [overcharge, aegis, turbo, regen] });
    assert.deepEqual(style.getGeometry('bot', { power: 10 }), {
        shape: 'circle',
        radius: 10 + Math.pow(10, 0.35) * 1.8
    });
    assert.deepEqual(style.getGeometry('food', {}), { shape: 'circle', radius: 2.5 });
    assert.deepEqual(style.getGeometry('powerup', { rotation: 0 }), { shape: 'circle', radius: 14 });
    const effectGame = { randomValue: () => 0.5 };
    const death = style.createEffectParticles('bot-death', { x: 0, y: 0, teamId: 'cyan' }, effectGame);
    assert.equal(death.length, 20);
    assert.equal(death.every(particle => particle.colorToken === 'team:cyan'), true);
}

function validatePowerupSystem() {
    const runtime = createRuntime();
    const bot = { power: 10, effectStates: new Map() };
    const game = { frameCount: 0, emitEffect() {} };
    const instance = { active: true, definition: overcharge, type: overcharge.id };
    runtime.powerups.collect(instance, bot, game);
    assert.equal(instance.active, false);
    assert.equal(runtime.powerups.getActiveViews(bot)[0].strength, 100);
    const modifiers = runtime.powerups.getModifiers(bot, game);
    assert.equal(modifiers.weapon.speedOverride, 14);
    assert.equal(modifiers.weapon.damageBaseOverride, 7);

    const first = createRuntime('pick-seed').powerups.pickDefinition().id;
    const second = createRuntime('pick-seed').powerups.pickDefinition().id;
    assert.equal(first, second);
}

function createSimulation(seed) {
    const runtime = createRuntime(seed);
    const geometryProvider = runtime.style.getGeometry.bind(runtime.style);
    const streams = runtime.streams;
    let capturedContext = null;
    const probeController = {
        decide(context) {
            capturedContext = context;
            return { movement: { x: 0, y: 0 }, fire: [], itemForces: [] };
        }
    };

    const game = {
        gameConfig: { timeScale: 1, targetFps: 60 },
        currentSeed: seed,
        match: { maxFrames: 3540 },
        width: 1080,
        height: 1920,
        frameCount: 0,
        bots: [],
        foods: [],
        powerups: [],
        projectiles: [],
        particles: [],
        topBot: null,
        runtime,
        style: runtime.style,
        randomValue(channel) { return streams.random(channel); },
        arena: new ArenaManager(portraitMap, {
            options: { matchDurationSeconds: 59, targetFps: 60 },
            random: () => streams.random('map')
        }),
        emitEffect() {},
        triggerKill(bot) { bot.alive = false; }
    };
    game.arena.reset(game.width, game.height);

    for (let index = 0; index < 80; index += 1) {
        game.foods.push(new Food(80 + (index % 10) * 95, 380 + Math.floor(index / 10) * 140, geometryProvider));
    }
    game.powerups.push(new Powerup(540, 960, focus, geometryProvider));

    let botCounter = 0;
    for (const team of Object.values(TEAMS)) {
        const zone = game.arena.getSpawnZone(team.id);
        for (let index = 0; index < 4; index += 1) {
            const id = `${team.id}-${index + 1}`;
            const aiId = botCounter % 2 === 0 ? 'sentinel-vector' : 'swarm-tactician';
            const aiRandom = streams.stream(`ai:${id}`);
            const aiController = botCounter === 0
                ? probeController
                : (aiId === 'sentinel-vector'
                    ? createSentinelController({ config: CONFIG, random: () => aiRandom.next(), botId: id, teamId: team.id, memberNumber: index + 1 })
                    : createSwarmController({ config: CONFIG, random: () => aiRandom.next(), botId: id, teamId: team.id }));
            game.bots.push(new Bot({
                id,
                team,
                x: zone.x + (index % 2 - 0.5) * 76,
                y: zone.y + (Math.floor(index / 2) - 0.5) * 76,
                aiId,
                aiController,
                geometryProvider,
                powerupSystem: runtime.powerups,
                random: () => streams.random(`bot:${id}`),
                initialCooldownFrames: 45
            }));
            botCounter += 1;
        }
    }

    for (let frame = 1; frame <= 500; frame += 1) {
        game.frameCount = frame;
        game.arena.update(frame);
        game.topBot = game.bots.reduce(
            (best, bot) => bot.alive && (!best || bot.power > best.power) ? bot : best,
            null
        );
        for (const powerup of game.powerups) if (powerup.active) powerup.update(game);
        for (const bot of game.bots) bot.update(game);
        for (const projectile of game.projectiles) if (projectile.active) projectile.update(game);
        for (const food of game.foods) if (food.active) food.update(game);

        for (const entity of [...game.bots, ...game.foods, ...game.powerups, ...game.projectiles]) {
            assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y), `Non-finite ${entity.id || entity.constructor.name}`);
        }
    }

    return { game, runtime, capturedContext };
}


function validateFoodAttraction() {
    const runtime = createRuntime('food-attraction');
    const geometryProvider = runtime.style.getGeometry.bind(runtime.style);
    const food = new Food(100, 100, geometryProvider);
    const bot = { alive: true, x: 180, y: 100 };
    const game = {
        bots: [bot],
        width: 1080,
        height: 1920,
        arena: {
            contains() { return true; },
            walls: []
        },
        style: runtime.style,
        frameCount: 1
    };
    const previousX = food.x;
    food.update(game);
    assert.ok(food.x > previousX, 'Food attraction should move food toward a nearby living bot.');
    assert.equal(food.y, 100);
}

function validateCollisionCaches() {
    const wall = { x: 100, y: 120, w: 80, h: 20, angle: 0.25 };
    const game = {
        frameCount: 10,
        style: { getGeometry: () => ({ shape: 'rect', width: 80, height: 20, rotation: 0.25 }) }
    };
    const first = createWallCollider(wall, 0, game);
    const second = createWallCollider(wall, 0, game);
    assert.equal(first, second, 'Wall collider must be reused within the same simulation frame.');
    game.frameCount += 1;
    const third = createWallCollider(wall, 0, game);
    assert.notEqual(first, third, 'Wall collider cache must reset on the next simulation frame.');
}

function runBotSimulation() {
    const first = createSimulation('simulation-seed');
    const second = createSimulation('simulation-seed');

    assert.equal(first.game.bots.length, 16);
    assert.ok(first.capturedContext);
    assert.equal(first.capturedContext.selfStatus.health, first.capturedContext.self.power);
    assert.ok(Array.isArray(first.capturedContext.walls));
    assert.ok(Array.isArray(first.capturedContext.ownedPowerups));
    assert.ok(Array.isArray(first.capturedContext.projectiles));
    assert.ok(first.capturedContext.walls[0].vertices.length === 4);
    assert.equal(first.runtime.style.getGeometry('bot', first.game.bots[0]).shape, 'circle');
    assert.equal(first.runtime.style.getGeometry('projectile', { visualVariant: 'standard', angle: 0 }).shape, 'rect');

    const snapshot = simulation => simulation.game.bots.map(bot => [
        bot.id,
        Number(bot.x.toFixed(6)),
        Number(bot.y.toFixed(6)),
        Number(bot.power.toFixed(6)),
        Number(bot.weaponCooldown.toFixed(6))
    ]);
    assert.deepEqual(snapshot(first), snapshot(second), 'The same seed must reproduce the same AI simulation.');
}

await validateGameConfig();
await validateManifests();
await validateAudioAndOfflineRenderer();
await validateSeedFinderApi();
validateSeededRandom();
validateMatchRules();
validateMapContracts();
validateOriginalStyleCompatibility();
validatePowerupSystem();
validateFoodAttraction();
validateCollisionCaches();
runBotSimulation();
console.log('Kinetic Arena deterministic modular smoke test passed.');
