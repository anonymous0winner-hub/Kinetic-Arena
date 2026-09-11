import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderEventsToWav } from '../tools/lib/offline-audio.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kinetic-audio-test-'));
const outputPath = path.join(directory, 'timing.wav');
try {
    const theme = {
        id: 'test-theme',
        mapEvent(event) {
            return [{
                type: 'tone',
                duration: 0.05,
                frequency: event.type === 'late' ? 880 : 440,
                gain: 0.25,
                attack: 0.001,
                release: 0.02
            }];
        }
    };

    const stats = await renderEventsToWav({
        events: [
            { sequence: 0, frame: 0, type: 'start', recordingTimeSeconds: null, recordingFrameIndex: null, payload: {} },
            { sequence: 1, frame: 120, type: 'late', recordingTimeSeconds: null, recordingFrameIndex: null, payload: {} }
        ],
        audioTheme: theme,
        eventFrameRate: 60,
        outputFps: 30,
        timingMode: 'simulation',
        sampleRate: 8000,
        durationSeconds: 2.2,
        outputPath,
        masterVolume: 1
    });

    assert.equal(stats.eventCount, 2);
    assert.equal(stats.audibleEventCount, 2);
    assert.equal(stats.cueCount, 2);
    assert.ok(stats.firstCueSeconds <= 0.001, `first cue=${stats.firstCueSeconds}`);
    assert.ok(stats.lastCueSeconds >= 2.04, `last cue=${stats.lastCueSeconds}`);
    assert.ok(stats.nonSilentSampleCount > 100);
    assert.ok(stats.peak > 0.01);

    const file = await fs.readFile(outputPath);
    assert.equal(file.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(file.subarray(8, 12).toString('ascii'), 'WAVE');

    console.log('Offline authoritative audio timing test passed.');
} finally {
    await fs.rm(directory, { recursive: true, force: true });
}
