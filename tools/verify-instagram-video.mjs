#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.once('error', reject);
        child.once('exit', code => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `ffprobe exited with code ${code}.`));
        });
    });
}

function rational(value) {
    const text = String(value || '0');
    if (!text.includes('/')) return Number(text) || 0;
    const [numerator, denominator] = text.split('/').map(Number);
    return denominator ? numerator / denominator : 0;
}

function mbps(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number / 1_000_000 : null;
}

async function main() {
    const input = process.argv[2];
    if (!input || input === '--help') {
        console.log('Usage: npm run verify:instagram -- recordings/video.mp4');
        return;
    }
    const file = path.resolve(input);
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    const output = await run(ffprobe, [
        '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file
    ]);
    const probe = JSON.parse(output);
    const video = probe.streams?.find(stream => stream.codec_type === 'video');
    const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
    const fps = rational(video?.avg_frame_rate || video?.r_frame_rate);
    const levelMinimum = fps > 30.1 ? 42 : 41;
    const failures = [];
    const warnings = [];

    if (!video) failures.push('No video stream.');
    if (!audio) failures.push('No audio stream.');
    if (Number(video?.width) !== 1080 || Number(video?.height) !== 1920) failures.push(`Resolution is ${video?.width}x${video?.height}; expected 1080x1920.`);
    if (String(video?.codec_name) !== 'h264') failures.push(`Video codec is ${video?.codec_name}; expected H.264.`);
    if (String(video?.profile).toLowerCase() !== 'high') failures.push(`H.264 profile is ${video?.profile}; expected High.`);
    if (Number(video?.level) < levelMinimum) failures.push(`H.264 level is ${video?.level}; expected at least ${levelMinimum}.`);
    if (String(video?.pix_fmt) !== 'yuv420p') failures.push(`Pixel format is ${video?.pix_fmt}; expected yuv420p.`);
    if (![30, 60].some(expected => Math.abs(fps - expected) < 0.001)) failures.push(`Frame rate is ${video?.avg_frame_rate}; expected constant 30 or 60 FPS.`);
    if (String(video?.color_primaries) !== 'bt709') failures.push(`Color primaries are ${video?.color_primaries}; expected bt709.`);
    if (String(video?.color_transfer) !== 'bt709') failures.push(`Color transfer is ${video?.color_transfer}; expected bt709.`);
    if (String(video?.color_space) !== 'bt709') failures.push(`Color matrix is ${video?.color_space}; expected bt709.`);
    if (String(video?.color_range) !== 'tv') failures.push(`Color range is ${video?.color_range}; expected limited/tv.`);
    if (String(audio?.codec_name) !== 'aac') failures.push(`Audio codec is ${audio?.codec_name}; expected AAC.`);
    if (Number(audio?.sample_rate) !== 48000) failures.push(`Audio sample rate is ${audio?.sample_rate}; expected 48000 Hz.`);
    if (Number(audio?.channels) !== 2) failures.push(`Audio channel count is ${audio?.channels}; expected stereo.`);

    const containerBitrateMbps = mbps(probe.format?.bit_rate);
    const videoBitrateMbps = mbps(video?.bit_rate);
    if (containerBitrateMbps !== null && containerBitrateMbps > 25.2) {
        warnings.push(`Container bitrate is ${containerBitrateMbps.toFixed(2)} Mbps, above the conservative 25 Mbps upload ceiling.`);
    }
    if (fps > 30.1 && videoBitrateMbps !== null && videoBitrateMbps < 8) {
        warnings.push(`60 FPS video bitrate is only ${videoBitrateMbps.toFixed(2)} Mbps; fast arena detail may compress poorly.`);
    }
    if (fps <= 30.1 && videoBitrateMbps !== null && videoBitrateMbps < 5) {
        warnings.push(`30 FPS video bitrate is only ${videoBitrateMbps.toFixed(2)} Mbps; inspect small text carefully.`);
    }

    const report = {
        file,
        status: failures.length === 0 ? 'passed' : 'failed',
        video: {
            resolution: `${video?.width}x${video?.height}`,
            codec: video?.codec_name || null,
            profile: video?.profile || null,
            level: video?.level || null,
            fps,
            pixelFormat: video?.pix_fmt || null,
            colorPrimaries: video?.color_primaries || null,
            colorTransfer: video?.color_transfer || null,
            colorSpace: video?.color_space || null,
            colorRange: video?.color_range || null,
            bitrateMbps: videoBitrateMbps
        },
        audio: {
            codec: audio?.codec_name || null,
            sampleRate: Number(audio?.sample_rate || 0) || null,
            channels: Number(audio?.channels || 0) || null,
            bitrateKbps: Number(audio?.bit_rate || 0) ? Number(audio.bit_rate) / 1000 : null
        },
        containerBitrateMbps,
        failures,
        warnings
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) process.exitCode = 1;
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
