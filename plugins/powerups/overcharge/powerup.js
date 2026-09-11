export const definition = Object.freeze({
    id: 'OVERCHARGE',
    label: 'Weapon',
    description: 'High-rate, high-damage weapon mode.',
    strength: 100,
    spawnWeight: 1,
    durationFrames: 480,
    aiTags: Object.freeze(['weapon', 'offense', 'high-value']),
    getModifiers() {
        return {
            weapon: {
                speedOverride: 15,
                damageBaseOverride: 8,
                projectileVariant: 'overcharged'
            }
        };
    }
});
