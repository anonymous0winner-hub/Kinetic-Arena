import fs from 'node:fs/promises';

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function hash32(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function waveform(type, phase) {
    const cycle = phase / (Math.PI * 2);
    switch (type) {
        case 'square': return Math.sin(phase) >= 0 ? 1 : -1;
        case 'triangle': return 2 * Math.abs(2 * (cycle - Math.floor(cycle + 0.5))) - 1;
        case 'sawtooth': return 2 * (cycle - Math.floor(cycle + 0.5));
        default: return Math.sin(phase);
    }
}

function envelope(time, duration, attack, release) {
    if (time < 0 || time >= duration) return 0;
    const safeAttack = clamp(Number(attack) || 0.002, 0.0005, duration * 0.8);
    const safeRelease = clamp(Number(release) || duration * 0.5, 0.002, duration);
    if (time < safeAttack) return time / safeAttack;
    if (time > duration - safeRelease) return Math.max(0, (duration - time) / safeRelease);
    return 1;
}

function panGains(pan) {
    const angle = (clamp(Number(pan) || 0, -1, 1) + 1) * Math.PI / 4;
    return [Math.cos(angle), Math.sin(angle)];
}

function renderTone(left, right, startSample, cue, sampleRate) {
    const duration = Math.max(0.005, Number(cue.duration) || 0.05);
    const count = Math.max(1, Math.ceil(duration * sampleRate));
    const startFrequency = Math.max(20, Number(cue.frequency) || 220);
    const endFrequency = Math.max(20, Number(cue.endFrequency) || startFrequency);
    const gain = Math.max(0, Number(cue.gain) || 0);
    const [leftPan, rightPan] = panGains(cue.pan);
    let phase = 0;

    for (let offset = 0; offset < count; offset += 1) {
        const target = startSample + offset;
        if (target < 0 || target >= left.length) continue;
        const time = offset / sampleRate;
        const ratio = duration > 0 ? time / duration : 0;
        const frequency = startFrequency * Math.pow(endFrequency / startFrequency, ratio);
        phase += Math.PI * 2 * frequency / sampleRate;
        const sample = waveform(cue.waveform, phase) * gain * envelope(time, duration, cue.attack, cue.release);
        left[target] += sample * leftPan;
        right[target] += sample * rightPan;
    }
}

function renderNoise(left, right, startSample, cue, sampleRate, seed) {
    const duration = Math.max(0.005, Number(cue.duration) || 0.05);
    const count = Math.max(1, Math.ceil(duration * sampleRate));
    const gain = Math.max(0, Number(cue.gain) || 0);
    const [leftPan, rightPan] = panGains(cue.pan);
    let state = hash32(seed) || 1;
    let previous = 0;

    for (let offset = 0; offset < count; offset += 1) {
        const target = startSample + offset;
        if (target < 0 || target >= left.length) continue;
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const white = ((state >>> 0) / 4294967296) * 2 - 1;
        let value = white;
        if (cue.color === 'low') {
            previous = previous * 0.94 + white * 0.06;
            value = previous * 2.4;
        } else if (cue.color === 'high') {
            value = (white - previous) * 0.62;
            previous = white;
        }
        const time = offset / sampleRate;
        const sample = value * gain * envelope(time, duration, cue.attack, cue.release);
        left[target] += sample * leftPan;
        right[target] += sample * rightPan;
    }
}

function writeAscii(buffer, offset, value) {
    buffer.write(value, offset, value.length, 'ascii');
}

function optionalFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveEventTimeSeconds(event, {
    timingMode,
    eventFrameRate,
    outputFps
}) {
    const simulationFrame = optionalFiniteNumber(event?.frame) ?? 0;
    const recordedFrame = optionalFiniteNumber(event?.recordingFrameIndex);
    const recordedTime = optionalFiniteNumber(event?.recordingTimeSeconds);
    const simulationFps = Math.max(1, Number(eventFrameRate) || 60);
    const videoFps = Math.max(1, Number(outputFps) || simulationFps);

    switch (timingMode) {
        case 'simulation':
            // Authoritative replay audio must be derived only from the fixed-step
            // simulation timeline. Do not inspect recordingTimeSeconds here: replay
            // events deliberately store null for presentation timing, and Number(null)
            // would incorrectly collapse every sound to t=0.
            return Math.max(0, simulationFrame) / simulationFps;

        case 'frame-index':
            return recordedFrame !== null
                ? Math.max(0, recordedFrame) / videoFps
                : Math.max(0, simulationFrame) / simulationFps;

        case 'presentation':
            return recordedTime !== null
                ? Math.max(0, recordedTime)
                : Math.max(0, simulationFrame) / simulationFps;

        default:
            throw new Error(`Unknown offline audio timing mode "${timingMode}".`);
    }
}

export async function renderEventsToWav({
    events,
    audioTheme,
    eventFrameRate,
    targetFps,
    outputFps = targetFps,
    timingMode = 'presentation',
    syncOffsetMs = 0,
    sampleRate = 48000,
    durationSeconds,
    outputPath,
    masterVolume = 0.7
}) {
    if (!audioTheme || typeof audioTheme.mapEvent !== 'function') {
        throw new Error('Offline audio rendering requires an audio theme with mapEvent(event).');
    }
    if (!Array.isArray(events)) throw new Error('Offline audio events must be an array.');

    const framesPerSecond = Number(eventFrameRate) || Number(targetFps) || 60;
    const sampleCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
    const left = new Float64Array(sampleCount);
    const right = new Float64Array(sampleCount);
    const syncOffsetSeconds = (Number(syncOffsetMs) || 0) / 1000;

    let cueCount = 0;
    let audibleEventCount = 0;
    let firstCueSeconds = Infinity;
    let lastCueSeconds = -Infinity;
    let earliestEventFrame = Infinity;
    let latestEventFrame = -Infinity;

    for (const event of events) {
        const frame = optionalFiniteNumber(event?.frame);
        if (frame !== null) {
            earliestEventFrame = Math.min(earliestEventFrame, frame);
            latestEventFrame = Math.max(latestEventFrame, frame);
        }

        const cues = audioTheme.mapEvent(event) || [];
        if (!Array.isArray(cues) || cues.length === 0) continue;
        audibleEventCount += 1;

        const eventTime = resolveEventTimeSeconds(event, {
            timingMode,
            eventFrameRate: framesPerSecond,
            outputFps
        }) + syncOffsetSeconds;

        for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
            const cue = cues[cueIndex];
            if (!cue || typeof cue !== 'object') continue;
            const cueStart = Math.max(0, Number(cue.start) || 0);
            const cueDuration = Math.max(0.005, Number(cue.duration) || 0.05);
            const cueTime = eventTime + cueStart;
            const startSample = Math.round(cueTime * sampleRate);
            cueCount += 1;
            firstCueSeconds = Math.min(firstCueSeconds, cueTime);
            lastCueSeconds = Math.max(lastCueSeconds, cueTime + cueDuration);

            if (cue.type === 'noise') {
                renderNoise(left, right, startSample, cue, sampleRate, `${event.sequence}:${cue.seedOffset || cueIndex}`);
            } else {
                renderTone(left, right, startSample, cue, sampleRate);
            }
        }
    }

    let peak = 0;
    let squareSum = 0;
    let nonSilentSampleCount = 0;
    for (let index = 0; index < sampleCount; index += 1) {
        left[index] *= masterVolume;
        right[index] *= masterVolume;
        const absoluteLeft = Math.abs(left[index]);
        const absoluteRight = Math.abs(right[index]);
        peak = Math.max(peak, absoluteLeft, absoluteRight);
        squareSum += left[index] * left[index] + right[index] * right[index];
        if (absoluteLeft > 1e-5 || absoluteRight > 1e-5) nonSilentSampleCount += 1;
    }
    const normalise = peak > 0.97 ? 0.97 / peak : 1;
    const rms = Math.sqrt(squareSum / Math.max(1, sampleCount * 2));

    const dataBytes = sampleCount * 2 * 2;
    const buffer = Buffer.allocUnsafe(44 + dataBytes);
    writeAscii(buffer, 0, 'RIFF');
    buffer.writeUInt32LE(36 + dataBytes, 4);
    writeAscii(buffer, 8, 'WAVE');
    writeAscii(buffer, 12, 'fmt ');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(2, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 4, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(16, 34);
    writeAscii(buffer, 36, 'data');
    buffer.writeUInt32LE(dataBytes, 40);

    let writeOffset = 44;
    for (let index = 0; index < sampleCount; index += 1) {
        const leftSample = Math.round(clamp(Math.tanh(left[index] * normalise), -1, 1) * 32767);
        const rightSample = Math.round(clamp(Math.tanh(right[index] * normalise), -1, 1) * 32767);
        buffer.writeInt16LE(leftSample, writeOffset);
        buffer.writeInt16LE(rightSample, writeOffset + 2);
        writeOffset += 4;
    }

    await fs.writeFile(outputPath, buffer);
    return Object.freeze({
        sampleRate,
        sampleCount,
        durationSeconds,
        eventCount: events.length,
        audibleEventCount,
        cueCount,
        peak,
        rms,
        nonSilentSampleCount,
        firstCueSeconds: Number.isFinite(firstCueSeconds) ? firstCueSeconds : null,
        lastCueSeconds: Number.isFinite(lastCueSeconds) ? lastCueSeconds : null,
        earliestEventFrame: Number.isFinite(earliestEventFrame) ? earliestEventFrame : null,
        latestEventFrame: Number.isFinite(latestEventFrame) ? latestEventFrame : null,
        timingMode
    });
}
