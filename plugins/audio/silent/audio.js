export function createAudioTheme() {
    return Object.freeze({
        id: 'silent',
        name: 'Silent',
        mapEvent() { return []; }
    });
}
