import { TEAMS } from './config.js';

function assert(condition, message) {
    if (!condition) throw new Error(`game-config.json: ${message}`);
}

function positiveInteger(value, label, minimum = 1) {
    assert(Number.isInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}.`);
    return value;
}

function finiteNumber(value, label, minimum = -Infinity, maximum = Infinity) {
    assert(Number.isFinite(value) && value >= minimum && value <= maximum, `${label} must be between ${minimum} and ${maximum}.`);
    return value;
}

function resolveUrl(baseUrl, value, label) {
    assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty path.`);
    return new URL(value, baseUrl).href;
}

function normaliseTeam(raw, index, enabledAI, defaultAI) {
    assert(raw && typeof raw === 'object', `teams[${index}] must be an object.`);
    assert(typeof raw.id === 'string' && TEAMS[raw.id], `teams[${index}].id must be one of: ${Object.keys(TEAMS).join(', ')}.`);
    const members = positiveInteger(raw.members, `teams[${index}].members`);
    const teamDefaultAI = raw.defaultAI || defaultAI;
    assert(enabledAI.has(teamDefaultAI), `teams[${index}].defaultAI "${teamDefaultAI}" is not enabled.`);

    const memberAI = {};
    for (const [memberKey, aiId] of Object.entries(raw.memberAI || {})) {
        const memberNumber = Number(memberKey);
        assert(Number.isInteger(memberNumber) && memberNumber >= 1 && memberNumber <= members,
            `teams[${index}].memberAI key "${memberKey}" must identify a member from 1 to ${members}.`);
        assert(enabledAI.has(aiId), `teams[${index}].memberAI[${memberKey}] uses disabled AI "${aiId}".`);
        memberAI[memberNumber] = aiId;
    }

    return Object.freeze({
        id: raw.id,
        label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : TEAMS[raw.id].label,
        members,
        defaultAI: teamDefaultAI,
        memberAI: Object.freeze(memberAI)
    });
}

export async function loadGameConfig(path = '../game-config.json') {
    const configUrl = new URL(path, import.meta.url);
    const response = await fetch(configUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load ${configUrl.pathname}: HTTP ${response.status}`);
    const raw = await response.json();

    assert(raw?.schemaVersion === 1, 'schemaVersion must be 1.');
    assert(typeof raw.seed === 'string' || Number.isFinite(raw.seed), 'seed must be a string or number.');
    const timeScale = finiteNumber(raw.timeScale ?? 1, 'timeScale', 0.05, 8);
    const targetFps = positiveInteger(raw.targetFps ?? 60, 'targetFps');

    const registry = raw.pluginRegistry || {};
    const manifestUrls = Object.freeze({
        styles: resolveUrl(configUrl, registry.styles, 'pluginRegistry.styles'),
        ai: resolveUrl(configUrl, registry.ai, 'pluginRegistry.ai'),
        maps: resolveUrl(configUrl, registry.maps, 'pluginRegistry.maps'),
        powerups: resolveUrl(configUrl, registry.powerups, 'pluginRegistry.powerups'),
        audio: resolveUrl(configUrl, registry.audio, 'pluginRegistry.audio')
    });

    const plugins = raw.plugins || {};
    assert(typeof plugins.style === 'string' && plugins.style, 'plugins.style is required.');
    assert(typeof plugins.map === 'string' && plugins.map, 'plugins.map is required.');
    assert(typeof plugins.audio === 'string' && plugins.audio, 'plugins.audio is required.');

    const enabledAIList = plugins.ai?.enabled;
    assert(Array.isArray(enabledAIList) && enabledAIList.length > 0, 'plugins.ai.enabled must contain at least one AI id.');
    const enabledAI = new Set(enabledAIList);
    assert(enabledAI.size === enabledAIList.length, 'plugins.ai.enabled contains duplicates.');
    const defaultAI = plugins.ai.default;
    assert(enabledAI.has(defaultAI), 'plugins.ai.default must be present in plugins.ai.enabled.');

    const enabledPowerups = plugins.powerups?.enabled;
    assert(Array.isArray(enabledPowerups) && enabledPowerups.length > 0, 'plugins.powerups.enabled must contain at least one powerup id.');
    assert(new Set(enabledPowerups).size === enabledPowerups.length, 'plugins.powerups.enabled contains duplicates.');

    assert(Array.isArray(raw.teams), 'teams must be an array.');
    assert(raw.teams.length >= 2 && raw.teams.length <= 4, 'teams must contain 2 to 4 active teams.');
    const teams = raw.teams.map((team, index) => normaliseTeam(team, index, enabledAI, defaultAI));
    assert(new Set(teams.map(team => team.id)).size === teams.length, 'teams contains duplicate team ids.');

    const totalMembers = teams.reduce((sum, team) => sum + team.members, 0);
    const bots = raw.bots || {};
    const configuredBotCount = positiveInteger(bots.count ?? totalMembers, 'bots.count');
    assert(configuredBotCount === totalMembers,
        `bots.count (${configuredBotCount}) must equal the sum of team members (${totalMembers}).`);

    const spawnAttempts = positiveInteger(bots.spawnAttempts ?? 40, 'bots.spawnAttempts');
    const jitter = bots.positionJitter || {};
    const positionJitter = Object.freeze({
        x: finiteNumber(jitter.x ?? 0, 'bots.positionJitter.x', 0, 500),
        y: finiteNumber(jitter.y ?? 0, 'bots.positionJitter.y', 0, 500)
    });
    const initialCooldownFrames = finiteNumber(bots.initialCooldownFrames ?? 60, 'bots.initialCooldownFrames', 0, 10000);

    const match = raw.match || {};
    const maxDurationSeconds = finiteNumber(match.maxDurationSeconds ?? 60, 'match.maxDurationSeconds', 1, 3600);
    const winnerDisplayFrames = positiveInteger(match.winnerDisplayFrames ?? 180, 'match.winnerDisplayFrames', 0);
    const restartSeedPolicy = match.restartSeedPolicy || 'repeat';
    assert(['repeat', 'increment'].includes(restartSeedPolicy), 'match.restartSeedPolicy must be "repeat" or "increment".');
    const timeoutWinnerRule = match.timeoutWinnerRule || 'alive-then-power';
    assert(['alive-then-power', 'power-only'].includes(timeoutWinnerRule), 'match.timeoutWinnerRule is unsupported.');


    const displayTextRaw = raw.displayText || {};
    const displayText = Object.freeze({
        text: typeof displayTextRaw.text === 'string' ? displayTextRaw.text : '',
        startSeconds: finiteNumber(displayTextRaw.startSeconds ?? 0, 'displayText.startSeconds', 0, 3600),
        endSeconds: finiteNumber(displayTextRaw.endSeconds ?? 0, 'displayText.endSeconds', 0, 3600),
        x: displayTextRaw.x === undefined || displayTextRaw.x === null
            ? null
            : finiteNumber(displayTextRaw.x, 'displayText.x', -10000, 10000),
        y: displayTextRaw.y === undefined || displayTextRaw.y === null
            ? null
            : finiteNumber(displayTextRaw.y, 'displayText.y', -10000, 10000)
    });
    assert(displayText.endSeconds === 0 || displayText.endSeconds >= displayText.startSeconds,
        'displayText.endSeconds must be 0 or greater than/equal to displayText.startSeconds.');

    const uiRaw = raw.ui || {};
    const teamPanelsRaw = uiRaw.teamPanels || {};
    const winnerOverlayRaw = uiRaw.winnerOverlay || {};
    const botHealthRaw = uiRaw.botHealth || {};
    const powerupLabelsRaw = uiRaw.powerupLabels || {};
    const displayTextUiRaw = uiRaw.displayText || {};
    const matchClockRaw = uiRaw.matchClock || {};
    const ui = Object.freeze({
        teamPanels: Object.freeze({
            enabled: teamPanelsRaw.enabled !== false,
            width: finiteNumber(teamPanelsRaw.width ?? 282, 'ui.teamPanels.width', 160, 500),
            height: finiteNumber(teamPanelsRaw.height ?? 102, 'ui.teamPanels.height', 60, 220),
            marginX: finiteNumber(teamPanelsRaw.marginX ?? 24, 'ui.teamPanels.marginX', 0, 300),
            marginY: finiteNumber(teamPanelsRaw.marginY ?? 24, 'ui.teamPanels.marginY', 0, 300),
            cornerRadius: finiteNumber(teamPanelsRaw.cornerRadius ?? 9, 'ui.teamPanels.cornerRadius', 0, 60),
            colorBarWidth: finiteNumber(teamPanelsRaw.colorBarWidth ?? 14, 'ui.teamPanels.colorBarWidth', 4, 60),
            teamNameFontSize: finiteNumber(teamPanelsRaw.teamNameFontSize ?? 22, 'ui.teamPanels.teamNameFontSize', 10, 80),
            healthFontSize: finiteNumber(teamPanelsRaw.healthFontSize ?? 35, 'ui.teamPanels.healthFontSize', 12, 100),
            activeFontSize: finiteNumber(teamPanelsRaw.activeFontSize ?? 25, 'ui.teamPanels.activeFontSize', 10, 60),
            teamNameX: finiteNumber(teamPanelsRaw.teamNameX ?? 31, 'ui.teamPanels.teamNameX', 0, 200),
            teamNameY: finiteNumber(teamPanelsRaw.teamNameY ?? 28, 'ui.teamPanels.teamNameY', 0, 220),
            healthX: finiteNumber(teamPanelsRaw.healthX ?? 31, 'ui.teamPanels.healthX', 0, 200),
            healthY: finiteNumber(teamPanelsRaw.healthY ?? 68, 'ui.teamPanels.healthY', 0, 220),
            activeRightPadding: finiteNumber(teamPanelsRaw.activeRightPadding ?? 17, 'ui.teamPanels.activeRightPadding', 0, 100),
            activeY: finiteNumber(teamPanelsRaw.activeY ?? 69, 'ui.teamPanels.activeY', 0, 220)
        }),
        winnerOverlay: Object.freeze({
            enabled: winnerOverlayRaw.enabled !== false,
            width: finiteNumber(winnerOverlayRaw.width ?? 680, 'ui.winnerOverlay.width', 240, 1040),
            height: finiteNumber(winnerOverlayRaw.height ?? 154, 'ui.winnerOverlay.height', 80, 400),
            fontSize: finiteNumber(winnerOverlayRaw.fontSize ?? 62, 'ui.winnerOverlay.fontSize', 20, 140),
            colorBarWidth: finiteNumber(winnerOverlayRaw.colorBarWidth ?? 18, 'ui.winnerOverlay.colorBarWidth', 4, 80),
            centerY: finiteNumber(winnerOverlayRaw.centerY ?? 960, 'ui.winnerOverlay.centerY', -500, 2500),
            cornerRadius: finiteNumber(winnerOverlayRaw.cornerRadius ?? 13, 'ui.winnerOverlay.cornerRadius', 0, 80)
        }),
        botHealth: Object.freeze({
            minimumFontSize: finiteNumber(botHealthRaw.minimumFontSize ?? 18, 'ui.botHealth.minimumFontSize', 8, 80),
            maximumFontSize: finiteNumber(botHealthRaw.maximumFontSize ?? 34, 'ui.botHealth.maximumFontSize', 8, 100)
        }),
        powerupLabels: Object.freeze({
            fontSize: finiteNumber(powerupLabelsRaw.fontSize ?? 18, 'ui.powerupLabels.fontSize', 8, 60),
            offsetY: finiteNumber(powerupLabelsRaw.offsetY ?? 24, 'ui.powerupLabels.offsetY', 0, 100),
            fontWeight: finiteNumber(powerupLabelsRaw.fontWeight ?? 800, 'ui.powerupLabels.fontWeight', 100, 1000)
        }),
        displayText: Object.freeze({
            fontSize: finiteNumber(displayTextUiRaw.fontSize ?? 54, 'ui.displayText.fontSize', 10, 140),
            minimumFontSize: finiteNumber(displayTextUiRaw.minimumFontSize ?? 34, 'ui.displayText.minimumFontSize', 10, 140),
            maximumFontSize: finiteNumber(displayTextUiRaw.maximumFontSize ?? 60, 'ui.displayText.maximumFontSize', 10, 160),
            panelPaddingX: finiteNumber(displayTextUiRaw.panelPaddingX ?? 58, 'ui.displayText.panelPaddingX', 0, 200),
            panelHeightScale: finiteNumber(displayTextUiRaw.panelHeightScale ?? 1.58, 'ui.displayText.panelHeightScale', 1, 4)
        }),
        matchClock: Object.freeze({
            fontSize: finiteNumber(matchClockRaw.fontSize ?? 35, 'ui.matchClock.fontSize', 12, 100),
            boxWidth: finiteNumber(matchClockRaw.boxWidth ?? 226, 'ui.matchClock.boxWidth', 100, 600),
            boxHeight: finiteNumber(matchClockRaw.boxHeight ?? 66, 'ui.matchClock.boxHeight', 40, 220),
            y: finiteNumber(matchClockRaw.y ?? 28, 'ui.matchClock.y', -200, 1000),
            textY: finiteNumber(matchClockRaw.textY ?? 27, 'ui.matchClock.textY', 0, 200),
            progressY: finiteNumber(matchClockRaw.progressY ?? 49, 'ui.matchClock.progressY', 0, 220),
            progressHeight: finiteNumber(matchClockRaw.progressHeight ?? 8, 'ui.matchClock.progressHeight', 2, 40)
        })
    });
    assert(ui.botHealth.maximumFontSize >= ui.botHealth.minimumFontSize,
        'ui.botHealth.maximumFontSize must be greater than/equal to ui.botHealth.minimumFontSize.');
    assert(ui.displayText.maximumFontSize >= ui.displayText.minimumFontSize,
        'ui.displayText.maximumFontSize must be greater than/equal to ui.displayText.minimumFontSize.');

    const world = raw.world || {};
    let viewportOverride = null;
    if (world.override) {
        const mode = world.override.mode === 'responsive' ? 'responsive' : 'fixed';
        viewportOverride = mode === 'responsive'
            ? Object.freeze({ mode: 'responsive', fit: 'stretch' })
            : Object.freeze({
                mode: 'fixed',
                width: positiveInteger(world.override.width, 'world.override.width'),
                height: positiveInteger(world.override.height, 'world.override.height'),
                fit: world.override.fit === 'cover' ? 'cover' : 'contain'
            });
    }

    const botAI = {};
    for (const team of teams) {
        for (let member = 1; member <= team.members; member += 1) {
            botAI[`${team.id}-${member}`] = team.memberAI[member] || team.defaultAI;
        }
    }

    return Object.freeze({
        sourceUrl: configUrl.href,
        seed: String(raw.seed),
        timeScale,
        targetFps,
        manifestUrls,
        selection: Object.freeze({
            styleId: plugins.style,
            mapId: plugins.map,
            audioId: plugins.audio,
            powerupIds: Object.freeze([...enabledPowerups]),
            powerupOverrides: Object.freeze({ ...(plugins.powerups.overrides || {}) }),
            enabledAIIds: Object.freeze([...enabledAIList]),
            defaultAIId: defaultAI,
            botAI: Object.freeze(botAI),
            manifestUrls,
            pluginOptions: Object.freeze({
                style: Object.freeze({ ...(raw.pluginOptions?.style || {}) }),
                map: Object.freeze({ ...(raw.pluginOptions?.map || {}) }),
                ai: Object.freeze({ ...(raw.pluginOptions?.ai || {}) }),
                audio: Object.freeze({ ...(raw.pluginOptions?.audio || {}) })
            })
        }),
        teams: Object.freeze(teams),
        bots: Object.freeze({
            count: configuredBotCount,
            spawnAttempts,
            positionJitter,
            initialCooldownFrames
        }),
        displayText,
        ui,
        world: Object.freeze({
            useMapViewport: world.useMapViewport !== false,
            override: viewportOverride
        }),
        match: Object.freeze({
            maxDurationSeconds,
            maxFrames: Math.round(maxDurationSeconds * targetFps),
            winnerDisplayFrames,
            autoRestart: match.autoRestart !== false,
            restartSeedPolicy,
            timeoutWinnerRule
        }),
        audio: Object.freeze({
            enabled: raw.audio?.enabled !== false,
            masterVolume: finiteNumber(raw.audio?.masterVolume ?? 0.7, 'audio.masterVolume', 0, 1),
            sampleRate: positiveInteger(raw.audio?.sampleRate ?? 48000, 'audio.sampleRate', 8000)
        }),
        recording: (() => {
            const recording = raw.recording || {};
            const allowedFps = Array.isArray(recording.allowedFps) && recording.allowedFps.length > 0
                ? recording.allowedFps.map((value, index) => positiveInteger(value, `recording.allowedFps[${index}]`))
                : [30, 60];
            const fps = positiveInteger(recording.fps ?? 60, 'recording.fps');
            assert(allowedFps.includes(fps), 'recording.fps must be present in recording.allowedFps.');
            const hardwareEncoder = String(recording.hardwareEncoder || 'auto').toLowerCase();
            assert(['auto', 'qsv', 'software', 'h264_qsv', 'libx264'].includes(hardwareEncoder),
                'recording.hardwareEncoder must be auto, qsv, software, h264_qsv, or libx264.');
            const deliveryPresetsRaw = recording.deliveryPresets && typeof recording.deliveryPresets === 'object'
                ? recording.deliveryPresets
                : {};
            const deliveryPresets = {};
            for (const [presetId, presetRawValue] of Object.entries(deliveryPresetsRaw)) {
                const presetRaw = presetRawValue || {};
                deliveryPresets[presetId] = Object.freeze({
                    description: String(presetRaw.description || ''),
                    format: String(presetRaw.format || 'mp4').toLowerCase(),
                    fps: positiveInteger(presetRaw.fps ?? fps, `recording.deliveryPresets.${presetId}.fps`),
                    videoCodec: String(presetRaw.videoCodec || 'libx264'),
                    profile: String(presetRaw.profile || 'high'),
                    level: String(presetRaw.level || '4.1'),
                    pixelFormat: String(presetRaw.pixelFormat || 'yuv420p'),
                    crf: finiteNumber(presetRaw.crf ?? 18, `recording.deliveryPresets.${presetId}.crf`, 0, 51),
                    encoderPreset: String(presetRaw.encoderPreset || 'fast'),
                    maximumBitrate: presetRaw.maximumBitrate == null ? null : String(presetRaw.maximumBitrate),
                    bufferSize: presetRaw.bufferSize == null ? null : String(presetRaw.bufferSize),
                    colorPrimaries: String(presetRaw.colorPrimaries || 'bt709'),
                    colorTransfer: String(presetRaw.colorTransfer || 'bt709'),
                    colorSpace: String(presetRaw.colorSpace || 'bt709'),
                    colorRange: String(presetRaw.colorRange || 'tv'),
                    audioCodec: String(presetRaw.audioCodec || 'aac'),
                    audioSampleRate: positiveInteger(presetRaw.audioSampleRate ?? 48000, `recording.deliveryPresets.${presetId}.audioSampleRate`, 8000),
                    audioChannels: positiveInteger(presetRaw.audioChannels ?? 2, `recording.deliveryPresets.${presetId}.audioChannels`, 1),
                    audioBitrate: String(presetRaw.audioBitrate || '192k'),
                    audioPeakLimit: finiteNumber(presetRaw.audioPeakLimit ?? 0.891, `recording.deliveryPresets.${presetId}.audioPeakLimit`, 0.1, 1),
                    keyframeIntervalSeconds: finiteNumber(presetRaw.keyframeIntervalSeconds ?? 2, `recording.deliveryPresets.${presetId}.keyframeIntervalSeconds`, 0.25, 10)
                });
                assert(['mp4', 'webm'].includes(deliveryPresets[presetId].format),
                    `recording.deliveryPresets.${presetId}.format must be mp4 or webm.`);
            }
            const deliveryPreset = String(recording.deliveryPreset || 'master');
            if (Object.keys(deliveryPresets).length > 0) {
                assert(deliveryPresets[deliveryPreset], `recording.deliveryPreset "${deliveryPreset}" is not defined in recording.deliveryPresets.`);
            }
            return Object.freeze({
                width: positiveInteger(recording.width ?? 1080, 'recording.width'),
                height: positiveInteger(recording.height ?? 1920, 'recording.height'),
                fps,
                allowedFps: Object.freeze([...new Set(allowedFps)]),
                winnerHoldSeconds: finiteNumber(recording.winnerHoldSeconds ?? 3, 'recording.winnerHoldSeconds', 0, 30),
                mode: String(recording.mode || 'paced'),
                outputFormat: String(recording.outputFormat || 'webm').toLowerCase(),
                captureSpeed: finiteNumber(recording.captureSpeed ?? 0.5, 'recording.captureSpeed', 0.25, 1),
                videoBitsPerSecond: positiveInteger(recording.videoBitsPerSecond ?? 18000000, 'recording.videoBitsPerSecond'),
                mimeTypes: Object.freeze(Array.isArray(recording.mimeTypes) ? recording.mimeTypes.map(String) : [
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm'
                ]),
                videoCodec: String(recording.videoCodec || 'libx264'),
                pixelFormat: String(recording.pixelFormat || 'yuv420p'),
                crf: finiteNumber(recording.crf ?? 18, 'recording.crf', 0, 51),
                preset: String(recording.preset || 'fast'),
                audioCodec: String(recording.audioCodec || 'aac'),
                webmAudioCodec: String(recording.webmAudioCodec || 'libopus'),
                audioBitrate: String(recording.audioBitrate || '192k'),
                deliveryPreset,
                deliveryPresets: Object.freeze(deliveryPresets),
                audioSyncOffsetMs: finiteNumber(recording.audioSyncOffsetMs ?? 0, 'recording.audioSyncOffsetMs', -1000, 1000),
                renderAtOutputFps: recording.renderAtOutputFps !== false,
                renderWorkers: positiveInteger(recording.renderWorkers ?? 4, 'recording.renderWorkers'),
                maximumRenderWorkers: positiveInteger(recording.maximumRenderWorkers ?? 6, 'recording.maximumRenderWorkers'),
                encoderThreads: positiveInteger(recording.encoderThreads ?? 6, 'recording.encoderThreads'),
                hardwareEncoder,
                hardwareQuality: finiteNumber(recording.hardwareQuality ?? 18, 'recording.hardwareQuality', 1, 51),
                retryOnStall: recording.retryOnStall !== false,
                maximumFrameGapMs: finiteNumber(recording.maximumFrameGapMs ?? 180, 'recording.maximumFrameGapMs', 16, 5000),
                maximumCatchUpRatio: finiteNumber(recording.maximumCatchUpRatio ?? 0.005, 'recording.maximumCatchUpRatio', 0, 1),
                minimumCaptureSpeed: finiteNumber(recording.minimumCaptureSpeed ?? (1 / 3), 'recording.minimumCaptureSpeed', 0.25, 1)
            });
        })(),
        seedFinder: (() => {
            const minimumTier = String(raw.seedFinder?.minimumTier || 'A').toUpperCase();
            assert(['S', 'A', 'B', 'C', 'D'].includes(minimumTier), 'seedFinder.minimumTier must be S, A, B, C, or D.');
            const topK = positiveInteger(raw.seedFinder?.topK ?? 10, 'seedFinder.topK');
            return Object.freeze({
                evaluator: String(raw.seedFinder?.evaluator || 'engaging-v2'),
                sampleEveryFrames: positiveInteger(raw.seedFinder?.sampleEveryFrames ?? Math.max(1, Math.round(targetFps / 2)), 'seedFinder.sampleEveryFrames'),
                maxFrames: positiveInteger(raw.seedFinder?.maxFrames ?? Math.round(maxDurationSeconds * targetFps), 'seedFinder.maxFrames'),
                topK,
                minimumScore: finiteNumber(raw.seedFinder?.minimumScore ?? 190, 'seedFinder.minimumScore', 0, 10000),
                minimumTier,
                selectedLimit: positiveInteger(raw.seedFinder?.selectedLimit ?? topK, 'seedFinder.selectedLimit'),
                parallelWorkers: positiveInteger(raw.seedFinder?.parallelWorkers ?? 4, 'seedFinder.parallelWorkers'),
                logicOnly: raw.seedFinder?.logicOnly !== false,
                retainAllResults: raw.seedFinder?.retainAllResults === true,
                framesPerSecond: targetFps,
                scoring: Object.freeze({ ...(raw.seedFinder?.scoring || {}) })
            });
        })(),
        simulation: Object.freeze({ ...(raw.simulation || {}) }),
        raw: Object.freeze(raw)
    });
}
