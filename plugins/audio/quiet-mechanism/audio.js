function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function panFromEvent(event) {
    const width = Number(event.payload?.worldWidth) || 1080;
    const x = Number(event.payload?.x);
    if (!Number.isFinite(x) || width <= 0) return 0;
    return clamp((x / width) * 2 - 1, -0.78, 0.78);
}

function teamPitch(teamId) {
    return ({ cyan: 0, magenta: 2, gold: -2, lime: 4 })[teamId] ?? 0;
}

function tone({
    start = 0,
    duration,
    frequency,
    endFrequency = frequency,
    gain,
    waveform = 'sine',
    pan = 0,
    attack = 0.001,
    release = 0.025
}) {
    return {
        type: 'tone', start, duration, frequency, endFrequency,
        gain, waveform, pan, attack, release
    };
}

function noise({
    start = 0,
    duration,
    gain,
    pan = 0,
    attack = 0.0005,
    release = 0.018,
    color = 'high',
    seedOffset = 0
}) {
    return {
        type: 'noise', start, duration, gain, pan,
        attack, release, color, seedOffset
    };
}

function hashUnit(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
}

/**
 * Restrained synthetic sound set for dense arena matches.
 * Frequent events are deliberately dry and short; infrequent state changes
 * receive the longer tonal cues so the mix remains readable instead of noisy.
 */
export function createAudioTheme({ options = {} } = {}) {
    const intensity = clamp(Number(options.intensity) || 1, 0, 2);
    const shootGain = clamp(Number(options.shootGain) || 0.075, 0, 1) * intensity;
    const impactGain = clamp(Number(options.impactGain) || 0.16, 0, 1) * intensity;
    const deathGain = clamp(Number(options.deathGain) || 0.23, 0, 1) * intensity;
    const uiGain = clamp(Number(options.uiGain) || 0.16, 0, 1) * intensity;
    const shotDensity = clamp(Number(options.shotDensity) || 0.82, 0.1, 1);
    const zoneDamageDensity = clamp(Number(options.zoneDamageDensity) || 0.42, 0.05, 1);

    return Object.freeze({
        id: 'quiet-mechanism',
        name: 'Quiet Mechanism',

        mapEvent(event) {
            const payload = event.payload || {};
            const pan = panFromEvent(event);
            const pitch = teamPitch(payload.teamId);
            const pitchRatio = Math.pow(2, pitch / 24);
            const sequence = Number(event.sequence) || 0;

            switch (event.type) {
                case 'match-start':
                    return [
                        tone({ duration: 0.12, frequency: 146, endFrequency: 146, gain: uiGain * 0.42, waveform: 'sine', release: 0.08 }),
                        tone({ start: 0.085, duration: 0.14, frequency: 219, endFrequency: 219, gain: uiGain * 0.30, waveform: 'triangle', release: 0.09 })
                    ];

                case 'shoot': {
                    const variant = payload.variant || 'standard';
                    const alwaysAudible = variant === 'overcharged' || variant === 'focused';
                    const densityValue = hashUnit(`${sequence}:${payload.botId || ''}:${variant}`);
                    if (!alwaysAudible && densityValue > shotDensity) return [];

                    if (variant === 'overcharged') {
                        return [
                            noise({ duration: 0.016, gain: shootGain * 0.70, pan, release: 0.012, seedOffset: 101 }),
                            tone({ duration: 0.034, frequency: 620 * pitchRatio, endFrequency: 470 * pitchRatio, gain: shootGain * 0.72, waveform: 'triangle', pan, release: 0.024 }),
                            noise({ start: 0.030, duration: 0.012, gain: shootGain * 0.46, pan, release: 0.009, seedOffset: 103 }),
                            tone({ start: 0.030, duration: 0.022, frequency: 900 * pitchRatio, endFrequency: 690 * pitchRatio, gain: shootGain * 0.34, waveform: 'sine', pan, release: 0.016 })
                        ];
                    }

                    if (variant === 'focused') {
                        return [
                            noise({ duration: 0.010, gain: shootGain * 0.46, pan, release: 0.008, seedOffset: 107 }),
                            tone({ duration: 0.026, frequency: 1120 * pitchRatio, endFrequency: 820 * pitchRatio, gain: shootGain * 0.50, waveform: 'sine', pan, release: 0.019 })
                        ];
                    }

                    // A single dial-detent-like active tick. It is intentionally much
                    // shorter and quieter than every other important arena sound.
                    return [
                        noise({ duration: 0.009, gain: shootGain * 0.42, pan, release: 0.007, seedOffset: 109 }),
                        tone({ duration: 0.020, frequency: 980 * pitchRatio, endFrequency: 690 * pitchRatio, gain: shootGain * 0.38, waveform: 'triangle', pan, release: 0.014 })
                    ];
                }

                case 'projectile-hit':
                    return [
                        noise({ duration: 0.025, gain: impactGain * 0.30, pan, release: 0.018, color: 'high', seedOffset: 127 }),
                        tone({ duration: 0.055, frequency: 170, endFrequency: 132, gain: impactGain * 0.38, waveform: 'triangle', pan, release: 0.042 })
                    ];

                case 'melee-hit':
                    return [
                        noise({ duration: 0.045, gain: impactGain * 0.24, pan, release: 0.033, color: 'low', seedOffset: 131 }),
                        tone({ duration: 0.075, frequency: 112, endFrequency: 84, gain: impactGain * 0.45, waveform: 'sine', pan, release: 0.055 })
                    ];

                case 'shield-hit':
                    return [
                        tone({ duration: 0.10, frequency: 740, endFrequency: 690, gain: impactGain * 0.35, waveform: 'sine', pan, release: 0.075 }),
                        tone({ start: 0.012, duration: 0.075, frequency: 1110, endFrequency: 1020, gain: impactGain * 0.18, waveform: 'sine', pan, release: 0.055 })
                    ];

                case 'projectile-wall':
                    return [
                        noise({ duration: 0.014, gain: impactGain * 0.13, pan, release: 0.010, color: 'high', seedOffset: 137 }),
                        tone({ duration: 0.028, frequency: 430, endFrequency: 330, gain: impactGain * 0.12, waveform: 'triangle', pan, release: 0.020 })
                    ];

                case 'food-collect':
                    return [
                        tone({ duration: 0.045, frequency: 510, endFrequency: 590, gain: uiGain * 0.16, waveform: 'sine', pan, release: 0.032 })
                    ];

                case 'powerup-collect': {
                    const strength = clamp(Number(payload.strength) || 50, 0, 120);
                    const root = 260 + strength * 0.78;
                    return [
                        tone({ duration: 0.11, frequency: root, endFrequency: root, gain: uiGain * 0.40, waveform: 'sine', pan, release: 0.075 }),
                        tone({ start: 0.075, duration: 0.14, frequency: root * 1.25, endFrequency: root * 1.25, gain: uiGain * 0.34, waveform: 'sine', pan, release: 0.095 }),
                        tone({ start: 0.145, duration: 0.16, frequency: root * 1.5, endFrequency: root * 1.5, gain: uiGain * 0.25, waveform: 'triangle', pan, release: 0.11 })
                    ];
                }

                case 'zone-stage':
                    return [
                        tone({ duration: 0.22, frequency: 118, endFrequency: 105, gain: uiGain * 0.44, waveform: 'sine', release: 0.16 }),
                        tone({ start: 0.12, duration: 0.24, frequency: 177, endFrequency: 158, gain: uiGain * 0.27, waveform: 'triangle', release: 0.18 })
                    ];

                case 'zone-damage':
                    if (hashUnit(`${sequence}:${payload.botId || ''}:zone`) > zoneDamageDensity) return [];
                    return [
                        tone({ duration: 0.052, frequency: 92, endFrequency: 78, gain: impactGain * 0.18, waveform: 'sine', pan, release: 0.039 })
                    ];

                case 'bot-death': {
                    const root = 148 * pitchRatio;
                    return [
                        noise({ duration: 0.20, gain: deathGain * 0.24, pan, release: 0.16, color: 'low', seedOffset: 149 }),
                        tone({ duration: 0.38, frequency: root, endFrequency: root * 0.69, gain: deathGain * 0.56, waveform: 'triangle', pan, attack: 0.004, release: 0.26 }),
                        tone({ start: 0.025, duration: 0.42, frequency: root * 0.50, endFrequency: root * 0.43, gain: deathGain * 0.38, waveform: 'sine', pan, attack: 0.006, release: 0.30 }),
                        tone({ start: 0.10, duration: 0.25, frequency: root * 1.48, endFrequency: root * 1.23, gain: deathGain * 0.13, waveform: 'sine', pan, release: 0.19 })
                    ];
                }

                case 'match-end': {
                    if (!payload.teamId) {
                        return [
                            tone({ duration: 0.46, frequency: 146, endFrequency: 131, gain: uiGain * 0.42, waveform: 'sine', release: 0.33 }),
                            tone({ start: 0.12, duration: 0.54, frequency: 174, endFrequency: 156, gain: uiGain * 0.27, waveform: 'triangle', release: 0.40 })
                        ];
                    }
                    const root = 174 * pitchRatio;
                    return [
                        tone({ duration: 0.58, frequency: root, endFrequency: root, gain: uiGain * 0.40, waveform: 'sine', release: 0.38 }),
                        tone({ start: 0.14, duration: 0.62, frequency: root * 1.25, endFrequency: root * 1.25, gain: uiGain * 0.34, waveform: 'sine', release: 0.42 }),
                        tone({ start: 0.28, duration: 0.72, frequency: root * 1.50, endFrequency: root * 1.50, gain: uiGain * 0.36, waveform: 'triangle', release: 0.48 })
                    ];
                }

                default:
                    return [];
            }
        }
    });
}
