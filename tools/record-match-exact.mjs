#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
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

function numberArg(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric.`);
    return parsed;
}

async function waitForProcess(child, label) {
    return await new Promise((resolve, reject) => {
        child.once('error', error => reject(new Error(`${label} failed to start: ${error.message}`)));
        child.once('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(`${label} exited with code ${code}.`));
        });
    });
}

async function writeFrame(stream, buffer) {
    if (stream.write(buffer)) return;
    await once(stream, 'drain');
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

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage: node tools/record-match.mjs [options]\n\n` +
            `  --seed <value>              Seed to record (default: game-config.json seed)\n` +
            `  --fps <30|60>               Output frame rate (default: recording.fps)\n` +
            `  --output <file.mp4>          Output path (default: recordings/<seed>-<fps>fps.mp4)\n` +
            `  --hold <seconds>             Winner hold duration (default: recording.winnerHoldSeconds)\n` +
            `  --crf <0-51>                 H.264 CRF override\n` +
            `  --preset <ffmpeg preset>     H.264 preset override\n` +
            `  --max-output-frames <count>  Development/smoke-test limit\n` +
            `  --chromium <path>            Chromium executable override\n`);
        return;
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'game-config.json'), 'utf8'));
    const recording = config.recording || {};
    const width = Number(recording.width) || 1080;
    const height = Number(recording.height) || 1920;
    if (width !== 1080 || height !== 1920) {
        throw new Error(`Frame-by-frame recorder requires 1080x1920. Current recording size is ${width}x${height}.`);
    }
    const fps = Math.round(numberArg(args.fps, Number(recording.fps) || 60, '--fps'));
    const allowedFps = recording.allowedFps || [30, 60];
    if (![30, 60].includes(fps) || !allowedFps.includes(fps)) {
        throw new Error(`--fps must be 30 or 60 and must be enabled in recording.allowedFps.`);
    }
    const targetFps = Number(config.targetFps) || 60;
    const timeScale = Number(config.timeScale) || 1;
    const simulationFramesPerOutputSecond = targetFps * timeScale;

    const seed = String(args.seed ?? config.seed);
    const holdSeconds = numberArg(args.hold, Number(recording.winnerHoldSeconds) || 3, '--hold');
    const maxOutputFrames = args['max-output-frames'] === undefined
        ? Infinity
        : Math.max(1, Math.round(numberArg(args['max-output-frames'], Infinity, '--max-output-frames')));
    const safeSeed = seed.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'seed';
    const outputPath = path.resolve(root, String(args.output || `recordings/${safeSeed}-${fps}fps.mp4`));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryDir = await fs.mkdtemp(path.join(path.dirname(outputPath), '.kinetic-record-'));
    const videoPath = path.join(temporaryDir, 'video-only.mp4');
    const audioPath = path.join(temporaryDir, 'audio.wav');

    const server = await startStaticServer(root);
    let browser;
    let videoEncoder;
    try {
        browser = await launchAutomationBrowser({
            url: `${server.url}/?automation=record`,
            width,
            height,
            chromium: args.chromium || process.env.CHROMIUM_PATH || null
        });
        const prepareExpression = `window.KineticArena.recording.prepare(${JSON.stringify({ seed })})`;
        let snapshot = await browser.client.evaluate(prepareExpression);
        const browserSettings = await browser.client.evaluate('window.KineticArena.recording.settings');
        if (browserSettings.width !== width || browserSettings.height !== height) {
            throw new Error(`Browser recording settings are ${browserSettings.width}x${browserSettings.height}; expected ${width}x${height}.`);
        }

        const crf = Math.round(numberArg(args.crf, Number(recording.crf) || 18, '--crf'));
        const preset = String(args.preset || recording.preset || 'medium');
        const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
        videoEncoder = spawn(ffmpeg, [
            '-hide_banner', '-loglevel', 'warning', '-y',
            '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
            '-an', '-c:v', String(recording.videoCodec || 'libx264'),
            '-preset', preset, '-crf', String(crf),
            '-pix_fmt', String(recording.pixelFormat || 'yuv420p'),
            '-movflags', '+faststart', videoPath
        ], { stdio: ['pipe', 'inherit', 'inherit'] });

        let outputFrame = 0;
        let capturedFrames = 0;
        let stopSimulationFrame = null;
        const holdFrames = Math.round(holdSeconds * simulationFramesPerOutputSecond);

        await writeFrame(videoEncoder.stdin, await browser.capturePng());
        capturedFrames += 1;

        while (capturedFrames < maxOutputFrames) {
            outputFrame += 1;
            const targetSimulationFrame = Math.floor(outputFrame * simulationFramesPerOutputSecond / fps + 1e-9);
            snapshot = await browser.client.evaluate(
                `window.KineticArena.recording.stepToFrame(${targetSimulationFrame})`
            );
            if (snapshot.matchEndFrame !== null && stopSimulationFrame === null) {
                stopSimulationFrame = snapshot.matchEndFrame + holdFrames;
            }
            await writeFrame(videoEncoder.stdin, await browser.capturePng());
            capturedFrames += 1;

            if (capturedFrames % Math.max(1, fps * 5) === 0) {
                const seconds = (capturedFrames / fps).toFixed(1);
                console.log(`Captured ${capturedFrames} frames (${seconds}s), simulation frame ${snapshot.frameCount}.`);
            }
            if (stopSimulationFrame !== null && targetSimulationFrame >= stopSimulationFrame) break;
        }

        videoEncoder.stdin.end();
        await waitForProcess(videoEncoder, 'Video encoder');
        videoEncoder = null;

        const events = await browser.client.evaluate('window.KineticArena.recording.events()');
        const audioTheme = await loadAudioTheme(config);
        const durationSeconds = capturedFrames / fps;
        await renderEventsToWav({
            events,
            audioTheme,
            eventFrameRate: simulationFramesPerOutputSecond,
            targetFps,
            sampleRate: Number(config.audio?.sampleRate) || 48000,
            durationSeconds,
            outputPath: audioPath,
            masterVolume: Number(config.audio?.masterVolume) || 0.7
        });

        const muxer = spawn(ffmpeg, [
            '-hide_banner', '-loglevel', 'warning', '-y',
            '-i', videoPath, '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', String(recording.audioCodec || 'aac'),
            '-b:a', String(recording.audioBitrate || '192k'),
            '-shortest', '-movflags', '+faststart', outputPath
        ], { stdio: ['ignore', 'inherit', 'inherit'] });
        await waitForProcess(muxer, 'MP4 muxer');

        const metadata = {
            output: outputPath,
            seed,
            width,
            height,
            fps,
            targetFps,
            timeScale,
            simulationFramesPerOutputSecond,
            frames: capturedFrames,
            durationSeconds,
            matchEndFrame: snapshot.matchEndFrame,
            winnerTeamId: snapshot.winnerTeamId,
            endedBy: snapshot.endedBy,
            audioEvents: events.length
        };
        await fs.writeFile(`${outputPath}.json`, JSON.stringify(metadata, null, 2) + '\n');
        console.log(`Created ${outputPath}`);
        console.log(JSON.stringify(metadata, null, 2));
    } finally {
        if (videoEncoder?.stdin && !videoEncoder.stdin.destroyed) videoEncoder.stdin.destroy();
        if (videoEncoder && videoEncoder.exitCode === null) videoEncoder.kill('SIGKILL');
        await browser?.close().catch(() => {});
        await new Promise(resolve => server.server.close(resolve));
        await fs.rm(temporaryDir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
