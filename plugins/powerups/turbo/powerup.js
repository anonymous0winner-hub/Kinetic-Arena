export const definition = Object.freeze({
    id: 'TURBO',
    label: 'Speed',
    description: 'Multiplies thrust for rapid movement.',
    strength: 70,
    spawnWeight: 1,
    durationFrames: 600,
    aiTags: Object.freeze(['movement', 'escape', 'chase']),
    getModifiers() {
        return { movement: { thrustMultiplier: 2.5 } };
    }
});
