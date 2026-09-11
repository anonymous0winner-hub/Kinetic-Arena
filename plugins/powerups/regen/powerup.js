export const definition = Object.freeze({
    id: 'REGEN',
    label: 'Repair',
    description: 'Restores one health point every 60 frames.',
    strength: 60,
    spawnWeight: 1,
    durationFrames: 720,
    aiTags: Object.freeze(['healing', 'survival']),
    onTick({ effect, api }) {
        if ((effect.elapsed + 1) % 50 === 0) api.addPower(1);
    }
});
