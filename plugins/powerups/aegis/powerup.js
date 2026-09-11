export const definition = Object.freeze({
    id: 'AEGIS',
    label: 'Shield',
    description: 'Blocks projectile damage while active.',
    strength: 90,
    spawnWeight: 1,
    durationFrames: 600,
    aiTags: Object.freeze(['defense', 'survival']),
    getModifiers() {
        return { defense: { projectileImmunity: true } };
    }
});
