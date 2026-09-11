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

function safeFilePart(value) {
    return String(value).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'seed';
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

async function waitForDownload(filePath, timeoutMs = 30000) {
    const partialPath = `${filePath}.crdownload`;
    const startedAt = Date.now();
    let previousSize = -1;
    let stableChecks = 0;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const stat = await fs.stat(filePath);
            let partialExists = false;
            try { await fs.access(partialPath); partialExists = true; } catch {}
            if (!partialExists && stat.size > 0) {
                if (stat.size === previousSize) stableChecks += 1;
                else stableChecks = 0;
                previousSize = stat.size;
                if (stableChecks >= 2) return stat;
            }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for browser download: ${filePath}`);
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
        if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
    return null;
}

async function ffmpegHasEncoder(ffmpeg, encoderName) {
    try {
        const stdout = await runProcess(ffmpeg, ['-hide_banner', '-v', 'quiet', '-encoders'], 'FFmpeg encoder probe', { captureStdout: true });
        return new RegExp(`\\b${encoderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(stdout);
    } catch {
        return false;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage: node tools/record-match.mjs [options]\n\n` +
            `  --seed <value>           Seed to record\n` +
            `  --fps <30|60>            Final frame rate\n` +
            `  --capture-speed <0.25-1> Safe simulation speed while recording (default: 0.5)\n` +
            `  --source-codec <auto|vp8|vp9> Canvas MediaRecorder source codec (default: auto/VP8-first)\n` +
            `  --headed               Start with a visible Chromium window\n` +
            `  --headless              Force headless Chromium and disable visible fallback\n` +
            `  --max-frame-gap <ms>    Retry slower when a capture stall exceeds this value\n` +
            `  --no-retry              Disable automatic slower retry on capture stalls\n` +
            `  --format <webm|mp4>      WebM copies the captured video; MP4 transcodes to H.264\n` +
            `  --output <path>          Final output path\n` +
            `  --hold <seconds>         Winner hold duration (default: 3)\n` +
            `  --bitrate <bps>          Intended final video bitrate\n` +
            `  --crf <0-51>             MP4 H.264 quality override\n` +
            `  --preset <name>          MP4 software H.264 preset override\n` +
            `  --threads <n>            FFmpeg filter/encoder threads (default: 6)\n` +
            `  --encoder <auto|qsv|software> MP4 encoder selection (default: auto)\n` +
            `  --chromium <path>        Chromium/Chrome/Edge executable\n` +
            `  --max-simulation-frames <n> Development smoke-test limit\n\n` +
            `Use "npm run record:exact" for the older screenshot-based exact exporter.`);
        return;
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'game-config.json'), 'utf8'));
    const recording = config.recording || {};
    const width = Number(recording.width) || 1080;
    const height = Number(recording.height) || 1920;
    if (width !== 1080 || height !== 1920) {
        throw new Error(`Optimized recorder is fixed to 1080x1920. Current configuration is ${width}x${height}.`);
    }

    const fps = Math.round(numeric(args.fps, Number(recording.fps) || 60, '--fps'));
    const allowedFps = recording.allowedFps || [30, 60];
    if (![30, 60].includes(fps) || !allowedFps.includes(fps)) throw new Error('--fps must be an enabled value of 30 or 60.');

    const captureSpeed = numeric(args['capture-speed'], Number(recording.captureSpeed) || 0.5, '--capture-speed');
    if (captureSpeed < 0.25 || captureSpeed > 1) throw new Error('--capture-speed must be between 0.25 and 1.');
    const sourceCodec = String(args['source-codec'] || recording.sourceCodec || 'auto').toLowerCase();
    if (!['auto', 'vp8', 'vp9'].includes(sourceCodec)) throw new Error('--source-codec must be auto, vp8, or vp9.');
    if (args.headed === true && args.headless === true) throw new Error('Use only one of --headed or --headless.');
    const forceHeaded = args.headed === true;
    const forceHeadless = args.headless === true;
    const maximumFrameGapMs = numeric(
        args['max-frame-gap'],
        Number(recording.maximumFrameGapMs) || 180,
        '--max-frame-gap'
    );
    const maximumCatchUpRatio = Number(recording.maximumCatchUpRatio) || 0.005;
    const minimumCaptureSpeed = Math.max(0.25, Math.min(1, Number(recording.minimumCaptureSpeed) || (1 / 3)));
    const retryOnStall = args['no-retry'] !== true && recording.retryOnStall !== false;
    const format = String(args.format || recording.outputFormat || 'webm').toLowerCase();
    if (!['webm', 'mp4'].includes(format)) throw new Error('--format must be webm or mp4.');

    const seed = String(args.seed ?? config.seed);
    const holdSeconds = numeric(args.hold, Number(recording.winnerHoldSeconds) || 3, '--hold');
    const videoBitsPerSecond = Math.round(numeric(args.bitrate, Number(recording.videoBitsPerSecond) || 18_000_000, '--bitrate'));
    const audioSyncOffsetMs = numeric(args['audio-offset-ms'], Number(recording.audioSyncOffsetMs) || 0, '--audio-offset-ms');
    if (audioSyncOffsetMs < -1000 || audioSyncOffsetMs > 1000) throw new Error('--audio-offset-ms must be between -1000 and 1000.');
    const encoderThreads = Math.max(1, Math.min(32, Math.round(numeric(args.threads, Number(recording.encoderThreads) || 6, '--threads'))));
    const encoderModeRaw = String(args.encoder || recording.hardwareEncoder || 'auto').toLowerCase();
    const encoderMode = encoderModeRaw === 'h264_qsv' ? 'qsv' : (encoderModeRaw === 'libx264' ? 'software' : encoderModeRaw);
    if (!['auto', 'qsv', 'software'].includes(encoderMode)) throw new Error('--encoder must be auto, qsv, or software.');
    const hardwareQuality = Math.max(1, Math.min(51, Math.round(Number(recording.hardwareQuality) || 18)));
    const maxSimulationFrames = args['max-simulation-frames'] === undefined
        ? null
        : Math.max(1, Math.round(numeric(args['max-simulation-frames'], 1, '--max-simulation-frames')));
    const safeSeed = safeFilePart(seed);
    const defaultOutput = `recordings/${safeSeed}-${fps}fps.${format}`;
    const outputPath = path.resolve(root, String(args.output || defaultOutput));
    if (path.extname(outputPath).toLowerCase() !== `.${format}`) {
        throw new Error(`Output extension must be .${format} when --format is ${format}.`);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const temporaryDir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.kinetic-paced-'));
    const sourceFileName = 'capture-source.webm';
    const sourcePath = path.join(temporaryDir, sourceFileName);
    const audioPath = path.join(temporaryDir, 'audio.wav');
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    const targetFps = Number(config.targetFps) || 60;
    const timeScale = Number(config.timeScale) || 1;
    const simulationFramesPerOutputSecond = targetFps * timeScale;

    const server = await startStaticServer(root, { uploadDirectory: temporaryDir });
    let browser;
    const wallStartedAt = Date.now();
    try {
        let browserHeadless = !forceHeaded;
        const launchRecorderBrowser = async () => await launchAutomationBrowser({
            url: `${server.url}/?automation=record`,
            width,
            height,
            chromium: args.chromium || process.env.CHROMIUM_PATH || null,
            headless: browserHeadless
        });
        browser = await launchRecorderBrowser();

        const retrySpeeds = [captureSpeed];
        if (retryOnStall) {
            for (const fallback of [0.4, 1 / 3, minimumCaptureSpeed]) {
                if (fallback < retrySpeeds.at(-1) - 0.001 && fallback >= minimumCaptureSpeed - 0.001) {
                    retrySpeeds.push(fallback);
                }
            }
        }

        let captureResult = null;
        let sourceProbe = null;
        let attemptSourceFrameLoss = 0;
        let qualityPassed = false;
        for (let attempt = 0; attempt < retrySpeeds.length; attempt += 1) {
            const attemptSpeed = retrySpeeds[attempt];
            await fs.rm(sourcePath, { force: true });
            console.log(`Recording ${seed} at ${fps} fps, 1080x1920, capture speed ${attemptSpeed.toFixed(3)}.`);
            console.log(`Expected capture duration is approximately ${(1 / attemptSpeed).toFixed(2)}x the final video duration.`);
            const captureExpression = `window.KineticArena.recording.captureToDownload(${JSON.stringify({
                seed,
                fps,
                captureSpeed: attemptSpeed,
                holdSeconds,
                videoBitsPerSecond,
                sourceCodec,
                fileName: sourceFileName,
                uploadUrl: `${server.url}/__kinetic_capture`,
                maxSimulationFrames
            })})`;
            try {
                captureResult = await browser.client.evaluate(captureExpression);
            } catch (error) {
                const mediaRecorderFailure = /MEDIARECORDER_|MediaRecorder produced an empty video/i.test(error?.message || '');
                if (!mediaRecorderFailure || !browserHeadless || forceHeadless) throw error;

                console.warn('Headless Chromium did not produce canvas video. Retrying once in visible Chromium mode.');
                await browser.close().catch(() => {});
                browserHeadless = false;
                browser = await launchRecorderBrowser();
                captureResult = await browser.client.evaluate(captureExpression);
            }
            await waitForDownload(sourcePath, 120000);
            sourceProbe = await probeOutput(ffprobe, sourcePath, { countFrames: true });
            const attemptVideo = sourceProbe.streams?.find(stream => stream.codec_type === 'video');
            if (!attemptVideo) throw new Error('Captured source validation failed: no video stream was found.');
            const attemptFrameCount = streamFrameCount(attemptVideo) || Number(captureResult.requestedVideoFrames) || 0;
            attemptSourceFrameLoss = Math.max(0, Number(captureResult.requestedVideoFrames) - attemptFrameCount);
            const permittedAttemptFrameLoss = Math.max(3, Math.ceil(Number(captureResult.requestedVideoFrames) * 0.002));

            const catchUpRatio = captureResult.catchUpSteps / Math.max(1, captureResult.frameCount);
            qualityPassed = captureResult.fixedFramePacing === true
                ? captureResult.missedCaptureIntervals === 0 && attemptSourceFrameLoss <= permittedAttemptFrameLoss
                : captureResult.maximumFrameGapMs <= maximumFrameGapMs && catchUpRatio <= maximumCatchUpRatio;
            if (qualityPassed) break;

            const hasRetry = attempt + 1 < retrySpeeds.length;
            const message = `Capture health warning: max frame gap=${captureResult.maximumFrameGapMs.toFixed(1)}ms, ` +
                `catch-up ratio=${(catchUpRatio * 100).toFixed(3)}%, source frame loss=${attemptSourceFrameLoss}.`;
            if (hasRetry) console.warn(`${message} Retrying at a slower capture speed.`);
            else console.warn(`${message} No slower retry remains; output will be marked with a quality warning.`);
        }

        const events = await browser.client.evaluate('window.KineticArena.recording.events()');
        const intendedDurationSeconds = captureResult.frameCount / simulationFramesPerOutputSecond;
        sourceProbe ||= await probeOutput(ffprobe, sourcePath, { countFrames: true });
        const sourceVideo = sourceProbe.streams?.find(stream => stream.codec_type === 'video');
        if (!sourceVideo) throw new Error('Captured source validation failed: no video stream was found.');

        const sourceFrameCount = streamFrameCount(sourceVideo) || Number(captureResult.requestedVideoFrames) || null;
        const sourceDurationSeconds = Number(sourceVideo.duration) || Number(sourceProbe.format?.duration) || 0;
        const sourceFrameLoss = sourceFrameCount
            ? Math.max(0, Number(captureResult.requestedVideoFrames) - sourceFrameCount)
            : 0;
        const permittedSourceFrameLoss = Math.max(3, Math.ceil(Number(captureResult.requestedVideoFrames) * 0.002));
        if (captureResult.fixedFramePacing === true && sourceFrameLoss > permittedSourceFrameLoss) {
            throw new Error(`Captured source lost ${sourceFrameLoss} of ${captureResult.requestedVideoFrames} requested frames.`);
        }
        // MP4 is re-timestamped by decoded frame index, so every captured source frame
        // becomes exactly one final 30/60 fps frame. WebM keeps the encoded VP8/VP9
        // packets and therefore follows their compressed presentation timeline.
        const timingMode = format === 'mp4' ? 'frame-index' : 'presentation';
        const finalTargetDurationSeconds = timingMode === 'frame-index' && sourceFrameCount
            ? sourceFrameCount / fps
            : sourceDurationSeconds * captureResult.captureSpeed;
        if (!(finalTargetDurationSeconds > 0)) {
            throw new Error('Could not determine the final video duration from the captured source.');
        }

        const audioTheme = await loadAudioTheme(config);
        const audioRenderStartedAt = Date.now();
        await renderEventsToWav({
            events,
            audioTheme,
            eventFrameRate: simulationFramesPerOutputSecond,
            targetFps,
            outputFps: fps,
            timingMode,
            syncOffsetMs: audioSyncOffsetMs,
            sampleRate: Number(config.audio?.sampleRate) || 48000,
            durationSeconds: finalTargetDurationSeconds,
            outputPath: audioPath,
            masterVolume: Number(config.audio?.masterVolume) || 0.7
        });
        const audioRenderSeconds = (Date.now() - audioRenderStartedAt) / 1000;
        const encodeStartedAt = Date.now();
        let selectedVideoEncoder = format === 'webm' ? 'copy' : 'libx264';
        let hardwareEncoderFallback = false;

        if (format === 'webm') {
            await runProcess(ffmpeg, [
                '-hide_banner', '-loglevel', 'warning', '-y',
                '-itsscale', String(captureResult.captureSpeed), '-i', sourcePath,
                '-i', audioPath,
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', String(recording.webmAudioCodec || 'libopus'),
                '-b:a', String(recording.audioBitrate || '192k'),
                '-t', finalTargetDurationSeconds.toFixed(9),
                '-avoid_negative_ts', 'make_zero', outputPath
            ], 'WebM muxer');
        } else {
            const crf = Math.round(numeric(args.crf, Number(recording.crf) || 18, '--crf'));
            const preset = String(args.preset || recording.preset || 'veryfast');
            const commonInputArgs = [
                '-hide_banner', '-loglevel', 'warning', '-y',
                '-filter_threads', String(encoderThreads),
                '-filter_complex_threads', String(encoderThreads),
                '-i', sourcePath, '-i', audioPath,
                '-map', '0:v:0', '-map', '1:a:0'
            ];
            const commonOutputArgs = [
                '-fps_mode', 'cfr',
                '-r', String(fps),
                '-c:a', String(recording.audioCodec || 'aac'),
                '-b:a', String(recording.audioBitrate || '192k'),
                '-t', finalTargetDurationSeconds.toFixed(9),
                '-movflags', '+faststart', outputPath
            ];

            const qsvAvailable = encoderMode !== 'software' && await ffmpegHasEncoder(ffmpeg, 'h264_qsv');
            if (encoderMode === 'qsv' && !qsvAvailable) {
                throw new Error('FFmpeg does not expose h264_qsv. Use --encoder software or install a QSV-enabled FFmpeg build.');
            }

            if (qsvAvailable) {
                try {
                    selectedVideoEncoder = 'h264_qsv';
                    await runProcess(ffmpeg, [
                        ...commonInputArgs,
                        '-vf', `setpts=N/(${fps}*TB),format=nv12`,
                        '-c:v', 'h264_qsv',
                        '-preset', 'medium',
                        '-global_quality', String(hardwareQuality),
                        ...commonOutputArgs
                    ], 'MP4 Intel Quick Sync encoder');
                } catch (error) {
                    if (encoderMode === 'qsv') throw error;
                    hardwareEncoderFallback = true;
                    selectedVideoEncoder = 'libx264';
                    await fs.rm(outputPath, { force: true });
                    console.warn('Intel Quick Sync encode failed; falling back to six-thread libx264.');
                }
            }

            if (selectedVideoEncoder === 'libx264') {
                await runProcess(ffmpeg, [
                    ...commonInputArgs,
                    '-vf', `setpts=N/(${fps}*TB)`,
                    '-c:v', String(recording.videoCodec || 'libx264'),
                    '-preset', preset, '-crf', String(crf),
                    '-threads:v', String(encoderThreads),
                    '-pix_fmt', String(recording.pixelFormat || 'yuv420p'),
                    ...commonOutputArgs
                ], 'MP4 software encoder');
            }
        }
        const encodeWallSeconds = (Date.now() - encodeStartedAt) / 1000;

        const probe = await probeOutput(ffprobe, outputPath);
        const video = probe.streams?.find(stream => stream.codec_type === 'video');
        const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
        if (!video || Number(video.width) !== width || Number(video.height) !== height) {
            throw new Error(`Output validation failed: expected ${width}x${height} video.`);
        }
        if (!audio) throw new Error('Output validation failed: no audio stream was found.');
        const [fpsNumerator, fpsDenominator = '1'] = String(video.avg_frame_rate || '').split('/');
        const probedFps = Number(fpsNumerator) / Math.max(1, Number(fpsDenominator));
        if (!Number.isFinite(probedFps) || Math.abs(probedFps - fps) > 0.1) {
            throw new Error(`Output validation failed: expected ${fps} fps, received ${video.avg_frame_rate || 'unknown'}.`);
        }
        const probedDurationSeconds = Number(probe.format?.duration) || 0;
        const durationErrorMs = (probedDurationSeconds - finalTargetDurationSeconds) * 1000;
        const allowedDurationErrorMs = Math.max(50, 2000 / fps);
        if (Math.abs(durationErrorMs) > allowedDurationErrorMs) {
            throw new Error(`Output validation failed: duration differs from target by ${durationErrorMs.toFixed(1)} ms.`);
        }
        const videoStartSeconds = Number(video.start_time) || 0;
        const audioStartSeconds = Number(audio.start_time) || 0;
        const streamStartSkewMs = (audioStartSeconds - videoStartSeconds) * 1000;
        if (Math.abs(streamStartSkewMs) > 25) {
            throw new Error(`Output validation failed: audio/video stream starts differ by ${streamStartSkewMs.toFixed(1)} ms.`);
        }

        const metadata = {
            output: outputPath,
            format,
            seed,
            width,
            height,
            requestedFps: fps,
            sourceCaptureFps: captureResult.sourceCaptureFps,
            sourceCodecRequested: sourceCodec,
            sourceMimeType: captureResult.selectedMimeType || captureResult.mimeType,
            manualFrameCapture: captureResult.manualFrameCapture,
            captureMode: captureResult.manualFrameCapture ? 'manual' : 'automatic',
            renderedFrames: captureResult.renderedFrames,
            sourceAudioTrackCount: 0,
            sourceAudioCodec: null,
            audioSyncMode: `deterministic-${timingMode}`,
            audioSyncOffsetMs,
            sourceFrameCount,
            sourceFrameLoss,
            sourceDurationSeconds,
            finalTargetDurationSeconds,
            durationErrorMs,
            streamStartSkewMs,
            requestedVideoFrames: captureResult.requestedVideoFrames,
            missedCaptureIntervals: captureResult.missedCaptureIntervals,
            dataChunkCount: captureResult.dataChunkCount,
            browserMode: browserHeadless ? 'headless' : 'headed',
            captureSpeed: captureResult.captureSpeed,
            requestedCaptureSpeed: captureSpeed,
            qualityStatus: qualityPassed ? 'passed' : 'warning',
            qualityLimits: { maximumFrameGapMs, maximumCatchUpRatio },
            simulationFramesPerOutputSecond,
            framesSimulated: captureResult.frameCount,
            intendedDurationSeconds,
            captureWallSeconds: captureResult.captureWallSeconds,
            totalWallSeconds: (Date.now() - wallStartedAt) / 1000,
            maximumFrameGapMs: captureResult.maximumFrameGapMs,
            maximumScheduleLagMs: captureResult.maximumScheduleLagMs || 0,
            lateFrameCount: captureResult.lateFrameCount || 0,
            maximumRenderTimeMs: captureResult.maximumRenderTimeMs || 0,
            averageRenderTimeMs: captureResult.averageRenderTimeMs || 0,
            catchUpSteps: captureResult.catchUpSteps,
            fixedFramePacing: captureResult.fixedFramePacing === true,
            encoderThreads,
            requestedEncoder: encoderMode,
            selectedVideoEncoder,
            hardwareEncoderFallback,
            audioRenderSeconds,
            encodeWallSeconds,
            sourceBytes: captureResult.bytes,
            outputBytes: (await fs.stat(outputPath)).size,
            matchEndFrame: captureResult.matchEndFrame,
            winnerTeamId: captureResult.winnerTeamId,
            endedBy: captureResult.endedBy,
            audioEvents: events.length,
            videoCodec: video.codec_name,
            audioCodec: audio.codec_name,
            averageFrameRate: video.avg_frame_rate,
            probedDurationSeconds
        };
        await fs.writeFile(`${outputPath}.json`, JSON.stringify(metadata, null, 2) + '\n');
        console.log(`Created ${outputPath}`);
        console.log(JSON.stringify(metadata, null, 2));
    } finally {
        await browser?.close().catch(() => {});
        await new Promise(resolve => server.server.close(resolve));
        await fs.rm(temporaryDir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
