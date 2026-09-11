#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startStaticServer, launchAutomationBrowser } from './lib/browser-automation.mjs';
import { renderEventsToWav } from './lib/offline-audio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [key, inline] = token.slice(2).split('=', 2);
        if (inline !== undefined) result[key] = inline;
        else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index];
        else result[key] = true;
    }
    return result;
}

function numeric(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric.`);
    return parsed;
}

function integer(value, fallback, label, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const parsed = Math.round(numeric(value, fallback, label));
    if (parsed < minimum || parsed > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
    return parsed;
}

function safeFilePart(value) {
    return String(value).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'seed';
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForProcess(child, label) {
    return await new Promise((resolve, reject) => {
        child.once('error', error => reject(new Error(`${label} failed to start: ${error.message}`)));
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}.`)));
    });
}

async function runProcess(command, args, label, { captureStdout = false } = {}) {
    const child = spawn(command, args, {
        stdio: ['ignore', captureStdout ? 'pipe' : 'inherit', 'inherit']
    });
    let stdout = '';
    if (captureStdout) child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    await waitForProcess(child, label);
    return stdout;
}

function writeFrame(stream, buffer) {
    return new Promise((resolve, reject) => {
        if (stream.destroyed) return reject(new Error('Frame encoder input closed unexpectedly.'));
        const accepted = stream.write(buffer, error => error ? reject(error) : resolve());
        if (!accepted) stream.once('drain', resolve);
    });
}

async function loadAudioTheme(config) {
    const manifestPath = path.resolve(root, config.pluginRegistry.audio);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const entry = manifest.plugins.find(plugin => plugin.id === config.plugins.audio);
    if (!entry) throw new Error(`Audio plugin "${config.plugins.audio}" is not present in ${manifestPath}.`);
    const modulePath = path.resolve(path.dirname(manifestPath), entry.module);
    const module = await import(pathToFileURL(modulePath));
    if (typeof module.createAudioTheme !== 'function') throw new Error(`Audio plugin "${entry.id}" does not export createAudioTheme().`);
    return module.createAudioTheme({ options: config.pluginOptions?.audio || {} });
}

function ffconcatPath(filePath) {
    return path.resolve(filePath).replaceAll('\\', '/').replaceAll("'", "'\\''");
}

async function probeOutput(ffprobe, outputPath, { countFrames = false } = {}) {
    const stdout = await runProcess(ffprobe, [
        '-v', 'error', ...(countFrames ? ['-count_frames'] : []),
        '-show_streams', '-show_format', '-of', 'json', outputPath
    ], 'ffprobe validation', { captureStdout: true });
    return JSON.parse(stdout);
}

function streamFrameCount(stream) {
    for (const value of [stream?.nb_read_frames, stream?.nb_frames]) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
    return null;
}

function splitSegments(totalFrames, workerCount) {
    const segments = [];
    const count = Math.max(1, Math.min(workerCount, totalFrames));
    for (let worker = 0; worker < count; worker += 1) {
        const start = Math.floor(totalFrames * worker / count);
        const end = Math.floor(totalFrames * (worker + 1) / count);
        if (end > start) segments.push({ index: worker, startFrame: start, endFrame: end });
    }
    return segments;
}

const FALLBACK_DELIVERY_PRESETS = Object.freeze({
    master: Object.freeze({
        format: 'mp4', fps: 60, videoCodec: 'libx264', profile: 'high', level: '4.2',
        pixelFormat: 'yuv420p', crf: 18, encoderPreset: 'veryfast', maximumBitrate: null,
        bufferSize: null, colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709',
        colorRange: 'tv', audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2,
        audioBitrate: '192k', audioPeakLimit: 0.891, keyframeIntervalSeconds: 2
    }),
    'instagram-hd-30': Object.freeze({
        format: 'mp4', fps: 30, videoCodec: 'libx264', profile: 'high', level: '4.1',
        pixelFormat: 'yuv420p', crf: 16, encoderPreset: 'medium', maximumBitrate: '14M',
        bufferSize: '28M', colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709',
        colorRange: 'tv', audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2,
        audioBitrate: '192k', audioPeakLimit: 0.891, keyframeIntervalSeconds: 2
    }),
    'instagram-smooth-60': Object.freeze({
        format: 'mp4', fps: 60, videoCodec: 'libx264', profile: 'high', level: '4.2',
        pixelFormat: 'yuv420p', crf: 16, encoderPreset: 'fast', maximumBitrate: '24M',
        bufferSize: '48M', colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709',
        colorRange: 'tv', audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2,
        audioBitrate: '192k', audioPeakLimit: 0.891, keyframeIntervalSeconds: 2
    })
});

function resolveDeliveryPreset(recording, args) {
    const configured = recording.deliveryPresets && typeof recording.deliveryPresets === 'object'
        ? recording.deliveryPresets
        : {};
    const presets = { ...FALLBACK_DELIVERY_PRESETS, ...configured };
    let presetId = String(args['delivery-preset'] || recording.deliveryPreset || 'master');
    if (args['delivery-preset'] === undefined && args.fps !== undefined) {
        const requestedFps = Math.round(Number(args.fps));
        if (requestedFps === 30 && presets['instagram-hd-30']) presetId = 'instagram-hd-30';
        if (requestedFps === 60 && presets['instagram-smooth-60']) presetId = 'instagram-smooth-60';
    }
    const base = presets[presetId];
    if (!base) {
        throw new Error(`Unknown --delivery-preset "${presetId}". Available presets: ${Object.keys(presets).join(', ')}.`);
    }
    const delivery = {
        ...FALLBACK_DELIVERY_PRESETS.master,
        ...base,
        id: presetId
    };
    const requestedFps = integer(args.fps, Number(delivery.fps) || Number(recording.fps) || 60, '--fps', 1, 240);
    if (![30, 60].includes(requestedFps)) throw new Error('--fps must be 30 or 60.');
    if (args['delivery-preset'] !== undefined && Number(delivery.fps) !== requestedFps) {
        throw new Error(
            `Delivery preset "${presetId}" requires ${delivery.fps} FPS, but --fps ${requestedFps} was requested. ` +
            `Remove --fps or select the matching Instagram preset.`
        );
    }
    delivery.fps = requestedFps;
    delivery.format = String(args.format || delivery.format || recording.outputFormat || 'mp4').toLowerCase();
    delivery.crf = integer(args.crf, Number(delivery.crf) || Number(recording.crf) || 18, '--crf', 0, 51);
    delivery.encoderPreset = String(args['encoder-preset'] || args.preset || delivery.encoderPreset || recording.preset || 'fast');
    if (!['mp4', 'webm'].includes(delivery.format)) throw new Error('--format must be mp4 or webm.');
    if (presetId.startsWith('instagram-') && delivery.format !== 'mp4') {
        throw new Error(`${presetId} requires MP4 output.`);
    }
    return delivery;
}

function segmentEncoderArgs({ format, fps, delivery, threads, outputPath }) {
    if (format === 'webm') {
        return [
            '-hide_banner', '-loglevel', 'warning', '-y',
            '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
            '-an', '-c:v', 'libvpx-vp9', '-crf', String(Math.max(18, Number(delivery.crf) + 8)), '-b:v', '0',
            '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-threads', String(threads),
            '-pix_fmt', String(delivery.pixelFormat || 'yuv420p'), outputPath
        ];
    }
    const keyframeFrames = Math.max(1, Math.round(fps * Number(delivery.keyframeIntervalSeconds || 2)));
    const colorPrimaries = String(delivery.colorPrimaries || 'bt709');
    const colorTransfer = String(delivery.colorTransfer || 'bt709');
    const colorSpace = String(delivery.colorSpace || 'bt709');
    const colorRange = String(delivery.colorRange || 'tv');
    const pixelFormat = String(delivery.pixelFormat || 'yuv420p');
    const args = [
        '-hide_banner', '-loglevel', 'warning', '-y',
        '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
        '-an',
        '-vf', `scale=in_range=full:out_range=limited:out_color_matrix=${colorSpace},format=${pixelFormat}`,
        '-c:v', String(delivery.videoCodec || 'libx264'),
        '-preset', String(delivery.encoderPreset || 'fast'),
        '-crf', String(delivery.crf),
        '-profile:v', String(delivery.profile || 'high'),
        '-level:v', String(delivery.level || (fps > 30 ? '4.2' : '4.1')),
        '-pix_fmt', pixelFormat,
        '-threads', String(threads),
        '-g', String(keyframeFrames), '-keyint_min', String(keyframeFrames), '-sc_threshold', '0',
        '-x264-params', `colorprim=${colorPrimaries}:transfer=${colorTransfer}:colormatrix=${colorSpace}:force-cfr=1`,
        '-color_primaries', colorPrimaries,
        '-color_trc', colorTransfer,
        '-colorspace', colorSpace,
        '-color_range', colorRange,
        '-fps_mode', 'cfr',
        '-movflags', '+faststart'
    ];
    if (delivery.maximumBitrate) args.push('-maxrate', String(delivery.maximumBitrate));
    if (delivery.bufferSize) args.push('-bufsize', String(delivery.bufferSize));
    args.push(outputPath);
    return args;
}

async function renderSegment({
    segment,
    serverUrl,
    temporaryDir,
    seed,
    fps,
    simulationFramesPerSecond,
    width,
    height,
    format,
    delivery,
    threads,
    chromium,
    headed,
    ffmpeg,
    expectedResult
}) {
    const extension = format === 'webm' ? 'webm' : 'mp4';
    const outputPath = path.join(temporaryDir, `segment-${String(segment.index).padStart(3, '0')}.${extension}`);
    const browser = await launchAutomationBrowser({
        url: `${serverUrl}/?automation=offline-replay`,
        width,
        height,
        chromium,
        headless: !headed
    });
    let encoder = null;
    const startedAt = performance.now();
    try {
        await browser.client.evaluate(`window.KineticArena.recording.prepare(${JSON.stringify({
            seed,
            render: false,
            suppressVisualEffects: false,
            suppressDomUi: true,
            suppressEventLog: true
        })})`);

        encoder = spawn(ffmpeg, segmentEncoderArgs({ format, fps, delivery, threads, outputPath }), {
            stdio: ['pipe', 'inherit', 'inherit']
        });

        let rendered = 0;
        let lastSnapshot = null;
        const reportEvery = Math.max(1, Math.floor((segment.endFrame - segment.startFrame) / 5));
        for (let outputFrame = segment.startFrame; outputFrame < segment.endFrame; outputFrame += 1) {
            const targetSimulationFrame = Math.floor(outputFrame * simulationFramesPerSecond / fps + 1e-9);
            lastSnapshot = await browser.client.evaluate(
                `window.KineticArena.recording.stepToFrame(${targetSimulationFrame}, { render: false })`
            );
            await browser.client.evaluate('window.KineticArena.recording.render()');
            await writeFrame(encoder.stdin, await browser.capturePng());
            rendered += 1;
            if (rendered % reportEvery === 0 || outputFrame + 1 === segment.endFrame) {
                const percent = Math.round(rendered * 100 / (segment.endFrame - segment.startFrame));
                console.log(`[render ${segment.index + 1}] ${percent}% (${rendered}/${segment.endFrame - segment.startFrame})`);
            }
        }

        encoder.stdin.end();
        await waitForProcess(encoder, `segment ${segment.index + 1} encoder`);
        encoder = null;

        if (segment.endFrame === expectedResult.totalFrames) {
            if (lastSnapshot?.winnerTeamId !== expectedResult.winnerTeamId ||
                lastSnapshot?.matchEndFrame !== expectedResult.matchEndFrame) {
                throw new Error(
                    `Replay divergence in final segment: authoritative winner=${expectedResult.winnerTeamId}, ` +
                    `rendered winner=${lastSnapshot?.winnerTeamId}, authoritative end=${expectedResult.matchEndFrame}, ` +
                    `rendered end=${lastSnapshot?.matchEndFrame}.`
                );
            }
        }

        return {
            ...segment,
            outputPath,
            frames: rendered,
            elapsedSeconds: (performance.now() - startedAt) / 1000,
            winnerTeamId: lastSnapshot?.winnerTeamId || null,
            matchEndFrame: lastSnapshot?.matchEndFrame ?? null
        };
    } finally {
        if (encoder?.stdin && !encoder.stdin.destroyed) encoder.stdin.destroy();
        if (encoder && encoder.exitCode === null) encoder.kill('SIGKILL');
        await browser.close().catch(() => {});
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage: node tools/record-match.mjs [options]\n\n` +
            `  --seed <value>               Seed to record\n` +
            `  --delivery-preset <id>       master, instagram-hd-30, or instagram-smooth-60\n` +
            `  --fps <30|60>                Output frame rate; auto-selects the matching Instagram preset\n` +
            `  --workers <1-6>              Parallel replay-render browser processes\n` +
            `  --format <mp4|webm>           Output container; Instagram presets require MP4\n` +
            `  --output <path>               Final output path\n` +
            `  --hold <seconds>              Winner hold duration\n` +
            `  --crf <0-51>                  Override preset quality\n` +
            `  --encoder-preset <name>       Override x264 speed/quality preset\n` +
            `  --threads <n>                 Total FFmpeg threads shared across workers\n` +
            `  --headed                      Use visible Chromium windows\n` +
            `  --max-simulation-frames <n>   Simulation safety cap\n` +
            `  --chromium <path>             Chrome/Edge executable\n\n` +
            `This is an offline deterministic replay renderer. --capture-speed and --source-codec are ignored.\n` +
            `Use npm run record:legacy only for the old MediaRecorder pipeline.`);
        return;
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'game-config.json'), 'utf8'));
    const recording = config.recording || {};
    const width = Number(recording.width) || 1080;
    const height = Number(recording.height) || 1920;
    if (width !== 1080 || height !== 1920) throw new Error(`Offline replay recorder requires 1080x1920; got ${width}x${height}.`);

    const delivery = resolveDeliveryPreset(recording, args);
    const fps = delivery.fps;
    const simulationFramesPerSecond = (Number(config.targetFps) || 60) * (Number(config.timeScale) || 1);
    if (simulationFramesPerSecond !== 60) {
        console.warn(`Simulation rate is ${simulationFramesPerSecond}; deterministic mapping will use that exact rate.`);
    }

    const requestedWorkers = integer(args.workers, Number(recording.renderWorkers) || 4, '--workers', 1, 6);
    const totalThreads = integer(args.threads, Number(recording.encoderThreads) || 6, '--threads', 1, 32);
    const format = delivery.format;
    const seed = String(args.seed ?? config.seed);
    const holdSeconds = numeric(args.hold, Number(recording.winnerHoldSeconds) || 3, '--hold');
    const holdFrames = Math.round(holdSeconds * simulationFramesPerSecond);
    const maxSimulationFrames = integer(
        args['max-simulation-frames'],
        Math.round((Number(config.match?.maxDurationSeconds) || 60) * simulationFramesPerSecond + holdFrames + simulationFramesPerSecond),
        '--max-simulation-frames', 1
    );
    const headed = args.headed === true;
    const chromium = args.chromium || process.env.CHROMIUM_PATH || null;
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    const safeSeed = safeFilePart(seed);
    const outputPath = path.resolve(root, String(args.output || `recordings/${safeSeed}-${delivery.id}-${fps}fps.${format}`));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryDir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.kinetic-replay-'));

    if (args['capture-speed'] !== undefined || args['source-codec'] !== undefined) {
        console.warn('Offline replay mode does not use --capture-speed or --source-codec; these options are ignored.');
    }

    const server = await startStaticServer(root);
    let authoritativeBrowser = null;
    const overallStartedAt = performance.now();
    try {
        console.log(`Building authoritative replay for ${seed} at ${simulationFramesPerSecond} simulation frames/s.`);
        authoritativeBrowser = await launchAutomationBrowser({
            url: `${server.url}/?automation=offline-replay`, width, height, chromium, headless: true
        });
        const authoritative = await authoritativeBrowser.client.evaluate(
            `window.KineticArena.recording.runAuthoritative(${JSON.stringify({
                seed,
                holdFrames,
                maxFrames: maxSimulationFrames
            })})`
        );
        await authoritativeBrowser.close();
        authoritativeBrowser = null;

        const stopSimulationFrame = Number(authoritative.stopSimulationFrame);
        const lastOutputFrameIndex = Math.ceil(stopSimulationFrame * fps / simulationFramesPerSecond);
        const totalFrames = lastOutputFrameIndex + 1;
        const durationSeconds = totalFrames / fps;
        const workerCount = Math.min(requestedWorkers, totalFrames);
        const segments = splitSegments(totalFrames, workerCount);
        const threadsPerWorker = Math.max(1, Math.floor(totalThreads / workerCount));
        const extension = format === 'webm' ? 'webm' : 'mp4';

        console.log(
            `Rendering ${totalFrames} exact frames (${durationSeconds.toFixed(3)}s) at ${fps} FPS ` +
            `with ${workerCount} parallel browser processes and ${threadsPerWorker} FFmpeg thread(s) per segment.\n` +
            `Delivery preset: ${delivery.id}; H.264 ${delivery.profile} level ${delivery.level}; ` +
            `CRF ${delivery.crf}; maxrate ${delivery.maximumBitrate || 'unlimited'}; Rec.709 ${delivery.colorRange}.`
        );

        const segmentResults = await Promise.all(segments.map(segment => renderSegment({
            segment,
            serverUrl: server.url,
            temporaryDir,
            seed,
            fps,
            simulationFramesPerSecond,
            width,
            height,
            format,
            delivery,
            threads: threadsPerWorker,
            chromium,
            headed,
            ffmpeg,
            expectedResult: {
                totalFrames,
                winnerTeamId: authoritative.snapshot.winnerTeamId,
                matchEndFrame: authoritative.snapshot.matchEndFrame
            }
        })));
        segmentResults.sort((a, b) => a.index - b.index);

        const concatList = path.join(temporaryDir, 'segments.ffconcat');
        await fs.writeFile(concatList,
            `ffconcat version 1.0\n` + segmentResults.map(result => `file '${ffconcatPath(result.outputPath)}'`).join('\n') + '\n'
        );
        const videoOnlyPath = path.join(temporaryDir, `video-only.${extension}`);
        await runProcess(ffmpeg, [
            '-hide_banner', '-loglevel', 'warning', '-y',
            '-f', 'concat', '-safe', '0', '-i', concatList,
            '-c', 'copy', videoOnlyPath
        ], 'segment concatenation');

        const audioPath = path.join(temporaryDir, 'audio.wav');
        const audioTheme = await loadAudioTheme(config);
        const audioStartedAt = performance.now();
        const audioStats = await renderEventsToWav({
            events: authoritative.events,
            audioTheme,
            eventFrameRate: simulationFramesPerSecond,
            targetFps: Number(config.targetFps) || 60,
            outputFps: fps,
            timingMode: 'simulation',
            syncOffsetMs: Number(recording.audioSyncOffsetMs) || 0,
            sampleRate: Number(config.audio?.sampleRate) || 48000,
            durationSeconds,
            outputPath: audioPath,
            masterVolume: Number(config.audio?.masterVolume) || 0.7
        });
        const audioRenderSeconds = (performance.now() - audioStartedAt) / 1000;

        const audioEnabled = config.audio?.enabled !== false && audioTheme.id !== 'silent';
        const latestEventSeconds = Number(audioStats.latestEventFrame) / simulationFramesPerSecond;
        if (audioEnabled && authoritative.events.length > 1) {
            if (audioStats.cueCount <= 1 || audioStats.audibleEventCount <= 1) {
                throw new Error(
                    `Offline audio mapping produced only ${audioStats.cueCount} cue(s) from ` +
                    `${authoritative.events.length} authoritative events. Check the selected audio theme.`
                );
            }
            if (latestEventSeconds > 2 && Number(audioStats.lastCueSeconds) < Math.min(2, latestEventSeconds * 0.25)) {
                throw new Error(
                    `Offline audio collapsed near the start: last cue=${audioStats.lastCueSeconds}s, ` +
                    `latest event=${latestEventSeconds.toFixed(3)}s. The recording was not written.`
                );
            }
            if (audioStats.peak < 1e-5 || audioStats.nonSilentSampleCount === 0) {
                throw new Error('Offline audio renderer produced an effectively silent WAV.');
            }
        }

        const audioCodec = format === 'webm'
            ? String(recording.webmAudioCodec || 'libopus')
            : String(delivery.audioCodec || recording.audioCodec || 'aac');
        const audioSampleRate = Number(delivery.audioSampleRate) || 48000;
        const audioChannels = Number(delivery.audioChannels) || 2;
        const audioBitrate = String(delivery.audioBitrate || recording.audioBitrate || '192k');
        const audioPeakLimit = Number(delivery.audioPeakLimit) || 0.891;
        await runProcess(ffmpeg, [
            '-hide_banner', '-loglevel', 'warning', '-y',
            '-i', videoOnlyPath, '-i', audioPath,
            '-filter_complex',
            `[1:a]aresample=${audioSampleRate},alimiter=limit=${audioPeakLimit.toFixed(6)},` +
            `apad=whole_dur=${durationSeconds.toFixed(9)}[audio]`,
            '-map', '0:v:0', '-map', '[audio]',
            '-c:v', 'copy', '-c:a', audioCodec,
            ...(format === 'mp4' && audioCodec === 'aac' ? ['-profile:a', 'aac_low'] : []),
            '-ar', String(audioSampleRate), '-ac', String(audioChannels), '-b:a', audioBitrate,
            '-t', durationSeconds.toFixed(9),
            ...(format === 'mp4' ? ['-tag:v', 'avc1', '-movflags', '+faststart'] : []),
            outputPath
        ], 'final audio/video mux');

        const probe = await probeOutput(ffprobe, outputPath, { countFrames: true });
        const videoStream = probe.streams.find(stream => stream.codec_type === 'video');
        const audioStream = probe.streams.find(stream => stream.codec_type === 'audio');
        const finalFrameCount = streamFrameCount(videoStream);
        const finalDuration = Number(probe.format?.duration || videoStream?.duration || 0);
        if (Number(videoStream?.width) !== width || Number(videoStream?.height) !== height) {
            throw new Error(`Output resolution is ${videoStream?.width}x${videoStream?.height}, expected ${width}x${height}.`);
        }
        if (!audioStream) throw new Error('Final recording has no audio stream.');
        if (format === 'mp4') {
            const expectedLevel = Math.round(Number(delivery.level) * 10);
            const actualFpsText = String(videoStream?.avg_frame_rate || videoStream?.r_frame_rate || '0/1');
            const [fpsNumerator, fpsDenominator] = actualFpsText.split('/').map(Number);
            const actualFps = fpsDenominator ? fpsNumerator / fpsDenominator : Number(actualFpsText);
            const instagramProblems = [];
            if (String(videoStream?.codec_name) !== 'h264') instagramProblems.push(`video codec=${videoStream?.codec_name}`);
            if (String(videoStream?.profile).toLowerCase() !== String(delivery.profile).toLowerCase()) {
                instagramProblems.push(`profile=${videoStream?.profile}`);
            }
            if (Number.isFinite(expectedLevel) && Number(videoStream?.level) !== expectedLevel) {
                instagramProblems.push(`level=${videoStream?.level}`);
            }
            if (String(videoStream?.pix_fmt) !== String(delivery.pixelFormat)) instagramProblems.push(`pix_fmt=${videoStream?.pix_fmt}`);
            if (String(videoStream?.color_primaries) !== String(delivery.colorPrimaries)) {
                instagramProblems.push(`color_primaries=${videoStream?.color_primaries}`);
            }
            if (String(videoStream?.color_transfer) !== String(delivery.colorTransfer)) {
                instagramProblems.push(`color_transfer=${videoStream?.color_transfer}`);
            }
            if (String(videoStream?.color_space) !== String(delivery.colorSpace)) {
                instagramProblems.push(`color_space=${videoStream?.color_space}`);
            }
            if (String(videoStream?.color_range) !== String(delivery.colorRange)) {
                instagramProblems.push(`color_range=${videoStream?.color_range}`);
            }
            if (Math.abs(actualFps - fps) > 0.001) instagramProblems.push(`fps=${actualFpsText}`);
            if (String(audioStream?.codec_name) !== 'aac') instagramProblems.push(`audio codec=${audioStream?.codec_name}`);
            if (Number(audioStream?.sample_rate) !== Number(delivery.audioSampleRate)) {
                instagramProblems.push(`audio sample_rate=${audioStream?.sample_rate}`);
            }
            if (Number(audioStream?.channels) !== Number(delivery.audioChannels)) {
                instagramProblems.push(`audio channels=${audioStream?.channels}`);
            }
            if (delivery.id.startsWith('instagram-') && instagramProblems.length > 0) {
                throw new Error(`Instagram delivery validation failed: ${instagramProblems.join(', ')}.`);
            }
        }
        if (finalFrameCount !== null && Math.abs(finalFrameCount - totalFrames) > segments.length) {
            throw new Error(`Final recording contains ${finalFrameCount} frames; expected ${totalFrames}.`);
        }
        if (Math.abs(finalDuration - durationSeconds) > Math.max(0.05, 2 / fps)) {
            throw new Error(`Final duration ${finalDuration}s differs from target ${durationSeconds}s.`);
        }

        const stat = await fs.stat(outputPath);
        const metadata = {
            output: outputPath,
            format,
            mode: 'offline-replay-parallel',
            seed,
            width,
            height,
            requestedFps: fps,
            deliveryPreset: delivery.id,
            videoProfile: videoStream?.profile || null,
            videoLevel: videoStream?.level || null,
            videoPixelFormat: videoStream?.pix_fmt || null,
            colorPrimaries: videoStream?.color_primaries || null,
            colorTransfer: videoStream?.color_transfer || null,
            colorSpace: videoStream?.color_space || null,
            colorRange: videoStream?.color_range || null,
            maximumBitrate: delivery.maximumBitrate || null,
            bufferSize: delivery.bufferSize || null,
            videoBitRate: Number(videoStream?.bit_rate || 0) || null,
            containerBitRate: Number(probe.format?.bit_rate || 0) || null,
            audioSampleRate: Number(audioStream?.sample_rate || 0) || null,
            audioChannels: Number(audioStream?.channels || 0) || null,
            audioBitRate: Number(audioStream?.bit_rate || 0) || null,
            simulationFramesPerOutputSecond: simulationFramesPerSecond,
            renderWorkers: workerCount,
            requestedRenderWorkers: requestedWorkers,
            encoderThreadsTotal: totalThreads,
            encoderThreadsPerWorker: threadsPerWorker,
            totalFrames,
            finalFrameCount,
            durationSeconds,
            probedDurationSeconds: finalDuration,
            stopSimulationFrame,
            matchEndFrame: authoritative.snapshot.matchEndFrame,
            winnerTeamId: authoritative.snapshot.winnerTeamId,
            endedBy: authoritative.snapshot.endedBy,
            authoritativeChecksum: authoritative.checksum,
            audioEvents: authoritative.events.length,
            audibleAudioEvents: audioStats.audibleEventCount,
            audioCueCount: audioStats.cueCount,
            audioFirstCueSeconds: audioStats.firstCueSeconds,
            audioLastCueSeconds: audioStats.lastCueSeconds,
            audioPeak: audioStats.peak,
            audioRms: audioStats.rms,
            audioNonSilentSamples: audioStats.nonSilentSampleCount,
            audioTimingMode: audioStats.timingMode,
            audioSyncMode: 'authoritative-simulation-frame',
            audioRenderSeconds,
            segmentTimings: segmentResults.map(result => ({
                index: result.index,
                startFrame: result.startFrame,
                endFrame: result.endFrame,
                frames: result.frames,
                elapsedSeconds: Number(result.elapsedSeconds.toFixed(3))
            })),
            outputBytes: stat.size,
            totalWallSeconds: Number(((performance.now() - overallStartedAt) / 1000).toFixed(3)),
            qualityStatus: 'passed',
            sourceFrameLoss: 0,
            captureSpeed: null,
            mediaRecorderUsed: false
        };
        await fs.writeFile(`${outputPath}.json`, JSON.stringify(metadata, null, 2) + '\n');
        console.log(`Created ${outputPath}`);
        console.log(JSON.stringify(metadata, null, 2));
    } finally {
        await authoritativeBrowser?.close().catch(() => {});
        await new Promise(resolve => server.server.close(resolve));
        await fs.rm(temporaryDir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
