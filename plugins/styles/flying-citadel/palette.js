export const FONT_STACK = '"Rajdhani", "Orbitron", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const TEAM_VISUALS = Object.freeze({
    cyan: Object.freeze({
        main: '#24d9ef', light: '#d7fbff', mid: '#138ba0', dark: '#062f39',
        armor: '#1f5f68', border: 'rgba(36, 217, 239, 0.56)', symbol: '◆'
    }),
    magenta: Object.freeze({
        main: '#ff5368', light: '#ffe2e7', mid: '#b5293f', dark: '#4a101a',
        armor: '#6b2832', border: 'rgba(255, 83, 104, 0.58)', symbol: '◆'
    }),
    gold: Object.freeze({
        main: '#f6c94b', light: '#fff3bf', mid: '#b78318', dark: '#49350a',
        armor: '#6f5721', border: 'rgba(246, 201, 75, 0.58)', symbol: '◆'
    }),
    lime: Object.freeze({
        main: '#a66bff', light: '#eee2ff', mid: '#7040bd', dark: '#2c1552',
        armor: '#513371', border: 'rgba(166, 107, 255, 0.58)', symbol: '◆'
    })
});

export const POWERUP_VISUALS = Object.freeze({
    OVERCHARGE: Object.freeze({ color: '#ff8b3d', light: '#fff0cf', label: 'POWER', icon: 'bolt' }),
    AEGIS: Object.freeze({ color: '#25cfff', light: '#d8f8ff', label: 'SHIELD', icon: 'shield' }),
    TURBO: Object.freeze({ color: '#b56dff', light: '#f1e3ff', label: 'SPEED', icon: 'turbo' }),
    REGEN: Object.freeze({ color: '#5be36f', light: '#dcffe1', label: 'HEAL', icon: 'plus' }),
    FOCUS: Object.freeze({ color: '#ffd34f', light: '#fff5c8', label: 'AIM', icon: 'target' })
});

export const FALLBACK_TEAM = Object.freeze({
    main: '#dbe7ef', light: '#ffffff', mid: '#7e909d', dark: '#1b2832',
    armor: '#354550', border: 'rgba(219, 231, 239, 0.42)', symbol: '◆'
});

export const FALLBACK_POWERUP = Object.freeze({
    color: '#dbe7ef', light: '#ffffff', label: 'POWER', icon: 'target'
});
