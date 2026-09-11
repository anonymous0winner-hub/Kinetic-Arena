export const definition = Object.freeze({
    id: 'FOCUS',
    label: 'Focus',
    description: 'Faster firing cadence and projectile travel speed.',
    strength: 75,
    spawnWeight: 0.8,
    durationFrames: 420,
    aiTags: Object.freeze(['weapon', 'precision', 'tempo']),
    getModifiers() {
        return {
            weapon: {
                cooldownMultiplier: 0.8,
                speedMultiplier: 1.15,
                projectileVariant: 'focused'
            }
        };
    }
});
