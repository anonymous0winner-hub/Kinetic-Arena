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

function createNoiseBuffer(context, duration, color, seed) {
    const length = Math.max(1, Math.ceil(duration * context.sampleRate));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = hash32(seed) || 1;
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const white = ((state >>> 0) / 4294967296) * 2 - 1;
        if (color === 'low') {
            previous = previous * 0.94 + white * 0.06;
            data[index] = previous * 2.4;
        } else if (color === 'high') {
            const high = white - previous;
            previous = white;
            data[index] = high * 0.62;
        } else {
            data[index] = white;
        }
    }
    return buffer;
}

function scheduleEnvelope(gainNode, startTime, cue, timeStretch = 1) {
    const stretch = clamp(Number(timeStretch) || 1, 0.125, 8);
    const duration = Math.max(0.005, (Number(cue.duration) || 0.05) * stretch);
    const attack = clamp((Number(cue.attack) || 0.002) * stretch, 0.0005, duration * 0.8);
    const release = clamp((Number(cue.release) || (Number(cue.duration) || 0.05) * 0.5) * stretch, 0.002, duration);
    const peak = Math.max(0, Number(cue.gain) || 0);
    const releaseStart = Math.max(startTime + attack, startTime + duration - release);
    gainNode.gain.cancelScheduledValues(startTime);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), startTime + attack);
    gainNode.gain.setValueAtTime(Math.max(0.0001, peak), releaseStart);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
}

function scheduleCue(context, destination, cue, event, timeStretch = 1) {
    const stretch = clamp(Number(timeStretch) || 1, 0.125, 8);
    const startTime = context.currentTime + Math.max(0, Number(cue.start) || 0) * stretch;
    const duration = Math.max(0.005, (Number(cue.duration) || 0.05) * stretch);
    const gain = context.createGain();
    const panNode = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
    if (panNode) {
        panNode.pan.setValueAtTime(clamp(Number(cue.pan) || 0, -1, 1), startTime);
        gain.connect(panNode).connect(destination);
    } else {
        gain.connect(destination);
    }
    scheduleEnvelope(gain, startTime, cue, stretch);

    if (cue.type === 'noise') {
        const source = context.createBufferSource();
        source.buffer = createNoiseBuffer(context, duration, cue.color, `${event.sequence}:${cue.seedOffset || 0}`);
        source.connect(gain);
        source.start(startTime);
        source.stop(startTime + duration + 0.01);
        return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = ['sine', 'square', 'triangle', 'sawtooth'].includes(cue.waveform) ? cue.waveform : 'sine';
    const frequency = Math.max(20, Number(cue.frequency) || 220);
    const endFrequency = Math.max(20, Number(cue.endFrequency) || frequency);
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration);
    oscillator.connect(gain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.01);
}

export class AudioManager {
    constructor(theme, { enabled = true, masterVolume = 0.7 } = {}) {
        this.theme = theme;
        this.enabled = enabled !== false;
        this.liveEnabled = this.enabled;
        this.masterVolume = clamp(Number(masterVolume) || 0.7, 0, 1);
        this.context = null;
        this.master = null;
        this.compressor = null;
        this.monitor = null;
        this.monitorEnabled = true;
        this.unlockInstalled = false;
        this.cueTimeStretch = 1;
        this.recordingDestinations = new Set();
    }

    installUnlock(target = document) {
        if (!this.enabled || this.unlockInstalled || !target?.addEventListener) return;
        this.unlockInstalled = true;
        const unlock = () => {
            this.unlock().catch(() => {});
            target.removeEventListener?.('pointerdown', unlock);
            target.removeEventListener?.('keydown', unlock);
        };
        target.addEventListener('pointerdown', unlock, { passive: true });
        target.addEventListener('keydown', unlock, { passive: true });
    }

    async unlock() {
        if (!this.enabled || typeof window === 'undefined') return false;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        if (!this.context) {
            this.context = new AudioContextClass({ latencyHint: 'interactive' });
            this.master = this.context.createGain();
            this.compressor = this.context.createDynamicsCompressor();
            this.monitor = this.context.createGain();
            this.master.gain.value = this.masterVolume;
            this.compressor.threshold.value = -12;
            this.compressor.knee.value = 18;
            this.compressor.ratio.value = 6;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.16;
            this.monitor.gain.value = this.monitorEnabled ? 1 : 0;
            this.master.connect(this.compressor);
            this.compressor.connect(this.monitor).connect(this.context.destination);
        }
        if (this.context.state === 'suspended') await this.context.resume();
        return this.context.state === 'running';
    }

    handleEvent(event) {
        if (!this.liveEnabled || !this.enabled || !this.context || this.context.state !== 'running') return;
        const cues = this.theme.mapEvent(event) || [];
        for (const cue of cues) scheduleCue(this.context, this.master, cue, event, this.cueTimeStretch);
    }

    setLiveEnabled(value) {
        this.liveEnabled = this.enabled && Boolean(value);
    }


    setMonitorEnabled(value) {
        this.monitorEnabled = Boolean(value);
        if (this.monitor && this.context) {
            this.monitor.gain.setTargetAtTime(this.monitorEnabled ? 1 : 0, this.context.currentTime, 0.01);
        }
    }

    setCueTimeStretch(value) {
        this.cueTimeStretch = clamp(Number(value) || 1, 0.125, 8);
        if (this.compressor && this.context) {
            this.compressor.attack.setValueAtTime(0.003 * this.cueTimeStretch, this.context.currentTime);
            this.compressor.release.setValueAtTime(0.16 * this.cueTimeStretch, this.context.currentTime);
        }
    }

    async createRecordingDestination() {
        const running = await this.unlock();
        if (!running || !this.context?.createMediaStreamDestination || !this.compressor) return null;
        const destination = this.context.createMediaStreamDestination();
        this.compressor.connect(destination);
        this.recordingDestinations.add(destination);
        return destination;
    }

    disconnectRecordingDestination(destination) {
        if (!destination || !this.recordingDestinations.has(destination)) return;
        try { this.compressor?.disconnect(destination); } catch {}
        this.recordingDestinations.delete(destination);
    }

    setMasterVolume(value) {
        this.masterVolume = clamp(Number(value) || 0, 0, 1);
        if (this.master) this.master.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, 0.015);
    }

    getState() {
        return Object.freeze({
            id: this.theme.id,
            enabled: this.enabled,
            liveEnabled: this.liveEnabled,
            monitorEnabled: this.monitorEnabled,
            unlocked: this.context?.state === 'running',
            masterVolume: this.masterVolume,
            cueTimeStretch: this.cueTimeStretch,
            recordingDestinations: this.recordingDestinations.size
        });
    }
}
