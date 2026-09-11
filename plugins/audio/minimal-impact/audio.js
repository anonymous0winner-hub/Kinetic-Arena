function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function panFromEvent(event) {
    const width = Number(event.payload?.worldWidth) || 1080;
    const x = Number(event.payload?.x);
    if (!Number.isFinite(x) || width <= 0) return 0;
    return clamp((x / width) * 2 - 1, -0.85, 0.85);
}

function teamPitch(teamId) {
    return ({ cyan: 0, magenta: 3, gold: 7, lime: 10 })[teamId] ?? 5;
}

function tone({ start = 0, duration, frequency, endFrequency = frequency, gain, waveform = 'sine', pan = 0, attack = 0.003, release = 0.05 }) {
    return { type: 'tone', start, duration, frequency, endFrequency, gain, waveform, pan, attack, release };
}

function noise({ start = 0, duration, gain, pan = 0, attack = 0.001, release = 0.05, color = 'white', seedOffset = 0 }) {
    return { type: 'noise', start, duration, gain, pan, attack, release, color, seedOffset };
}

export function createAudioTheme({ options = {} } = {}) {
    const intensity = clamp(Number(options.intensity) || 1, 0, 2);
    const shootGain = clamp(Number(options.shootGain) || 0.16, 0, 1) * intensity;
    const impactGain = clamp(Number(options.impactGain) || 0.22, 0, 1) * intensity;
    const uiGain = clamp(Number(options.uiGain) || 0.24, 0, 1) * intensity;

    return Object.freeze({
        id: 'minimal-impact',
        name: 'Minimal Impact',

        mapEvent(event) {
            const payload = event.payload || {};
            const pan = panFromEvent(event);
            const pitch = teamPitch(payload.teamId);

            switch (event.type) {
                case 'match-start':
                    return [
                        tone({ duration: 0.09, frequency: 180, endFrequency: 230, gain: uiGain * 0.55, waveform: 'sine', release: 0.06 }),
                        tone({ start: 0.07, duration: 0.11, frequency: 270, endFrequency: 340, gain: uiGain * 0.45, waveform: 'triangle', release: 0.07 })
                    ];

                case 'shoot': {
                    const overcharged = payload.variant === 'overcharged';
                    const base = (overcharged ? 520 : 670) * Math.pow(2, pitch / 48);
                    return [
                        tone({ duration: overcharged ? 0.085 : 0.055, frequency: base, endFrequency: base * 0.72, gain: shootGain * (overcharged ? 1.3 : 1), waveform: 'square', pan, release: 0.035 }),
                        noise({ duration: 0.035, gain: shootGain * 0.22, pan, release: 0.025, color: 'high', seedOffset: 11 })
                    ];
                }

                case 'projectile-hit':
                case 'melee-hit':
                    return [
                        tone({ duration: 0.075, frequency: event.type === 'melee-hit' ? 135 : 205, endFrequency: 92, gain: impactGain * 0.55, waveform: 'triangle', pan, release: 0.055 }),
                        noise({ duration: 0.07, gain: impactGain * 0.28, pan, release: 0.05, color: 'low', seedOffset: 23 })
                    ];

                case 'shield-hit':
                    return [
                        tone({ duration: 0.15, frequency: 780, endFrequency: 1120, gain: impactGain * 0.55, waveform: 'sine', pan, release: 0.11 }),
                        tone({ duration: 0.12, frequency: 390, endFrequency: 560, gain: impactGain * 0.22, waveform: 'triangle', pan, release: 0.09 })
                    ];

                case 'projectile-wall':
                    return [noise({ duration: 0.045, gain: impactGain * 0.16, pan, release: 0.035, color: 'high', seedOffset: 31 })];

                case 'powerup-collect': {
                    const strength = clamp(Number(payload.strength) || 50, 0, 120);
                    const root = 330 + strength * 1.5;
                    return [
                        tone({ duration: 0.13, frequency: root, endFrequency: root * 1.16, gain: uiGain * 0.52, waveform: 'sine', pan, release: 0.08 }),
                        tone({ start: 0.09, duration: 0.15, frequency: root * 1.25, endFrequency: root * 1.55, gain: uiGain * 0.44, waveform: 'triangle', pan, release: 0.1 })
                    ];
                }

                case 'zone-stage':
                    return [
                        tone({ duration: 0.2, frequency: 170, endFrequency: 128, gain: uiGain * 0.52, waveform: 'sawtooth', release: 0.14 }),
                        tone({ start: 0.16, duration: 0.18, frequency: 145, endFrequency: 108, gain: uiGain * 0.38, waveform: 'triangle', release: 0.13 })
                    ];

                case 'zone-damage':
                    return [tone({ duration: 0.07, frequency: 115, endFrequency: 82, gain: impactGain * 0.18, waveform: 'square', pan, release: 0.05 })];

                case 'bot-death': {
                    const root = 235 * Math.pow(2, pitch / 36);
                    return [
                        tone({ duration: 0.34, frequency: root, endFrequency: root * 0.35, gain: impactGain * 0.95, waveform: 'sawtooth', pan, release: 0.2 }),
                        noise({ duration: 0.3, gain: impactGain * 0.58, pan, release: 0.22, color: 'low', seedOffset: 47 })
                    ];
                }

                case 'match-end': {
                    const root = payload.teamId ? 220 * Math.pow(2, pitch / 24) : 185;
                    return payload.teamId
                        ? [
                            tone({ duration: 0.4, frequency: root, endFrequency: root, gain: uiGain * 0.66, waveform: 'sine', release: 0.22 }),
                            tone({ start: 0.18, duration: 0.45, frequency: root * 1.25, endFrequency: root * 1.25, gain: uiGain * 0.6, waveform: 'sine', release: 0.24 }),
                            tone({ start: 0.36, duration: 0.72, frequency: root * 1.5, endFrequency: root * 1.5, gain: uiGain * 0.72, waveform: 'triangle', release: 0.42 })
                        ]
                        : [
                            tone({ duration: 0.55, frequency: root, endFrequency: root * 0.62, gain: uiGain * 0.62, waveform: 'triangle', release: 0.34 }),
                            noise({ duration: 0.32, gain: uiGain * 0.18, release: 0.24, color: 'low', seedOffset: 59 })
                        ];
                }

                default:
                    return [];
            }
        }
    });
}
