import { POWERUP_VISUALS } from './palette.js';

export function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export function alphaColor(color, alpha) {
    if (!color) return `rgba(255, 255, 255, ${alpha})`;
    if (color.startsWith('rgba(')) return color;
    if (color.startsWith('rgb(')) {
        const values = color.match(/[\d.]+/g) || [255, 255, 255];
        return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
    }
    const clean = color.replace('#', '');
    const expanded = clean.length === 3 ? clean.split('').map(character => character + character).join('') : clean;
    const value = Number.parseInt(expanded, 16);
    if (!Number.isFinite(value)) return `rgba(255, 255, 255, ${alpha})`;
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, r);
        return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

export function stableHash(text) {
    let hash = 2166136261;
    const value = String(text ?? '');
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function deterministicUnit(index, salt = 0) {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453123;
    return value - Math.floor(value);
}

export function formatHealth(value) {
    const health = Math.max(0, Math.round(Number(value) || 0));
    if (health < 100000) return String(health);
    const tiers = [
        [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']
    ];
    for (const [divisor, suffix] of tiers) {
        if (health >= divisor) {
            const scaled = health / divisor;
            const decimals = scaled >= 100 ? 0 : (scaled >= 10 ? 1 : 2);
            return `${scaled.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9])0+$/g, '')}${suffix}`;
        }
    }
    return health.toExponential(2).replace('+', '');
}

export function drawPowerupIcon(ctx, type, x, y, size, color) {
    const visual = POWERUP_VISUALS[type] || { icon: 'target' };
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, size * 0.105);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (visual.icon === 'bolt') {
        ctx.beginPath();
        ctx.moveTo(size * 0.10, -size * 0.58);
        ctx.lineTo(-size * 0.34, size * 0.02);
        ctx.lineTo(-size * 0.02, size * 0.02);
        ctx.lineTo(-size * 0.13, size * 0.58);
        ctx.lineTo(size * 0.39, -size * 0.12);
        ctx.lineTo(size * 0.07, -size * 0.12);
        ctx.closePath();
        ctx.fill();
    } else if (visual.icon === 'shield') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.56);
        ctx.lineTo(size * 0.47, -size * 0.30);
        ctx.lineTo(size * 0.36, size * 0.24);
        ctx.quadraticCurveTo(size * 0.20, size * 0.47, 0, size * 0.60);
        ctx.quadraticCurveTo(-size * 0.20, size * 0.47, -size * 0.36, size * 0.24);
        ctx.lineTo(-size * 0.47, -size * 0.30);
        ctx.closePath();
        ctx.stroke();
    } else if (visual.icon === 'turbo') {
        for (const offset of [-size * 0.14, size * 0.18]) {
            ctx.beginPath();
            ctx.moveTo(-size * 0.43 + offset, -size * 0.42);
            ctx.lineTo(size * 0.04 + offset, 0);
            ctx.lineTo(-size * 0.43 + offset, size * 0.42);
            ctx.stroke();
        }
    } else if (visual.icon === 'plus') {
        roundedRectPath(ctx, -size * 0.115, -size * 0.50, size * 0.23, size, size * 0.06);
        ctx.fill();
        roundedRectPath(ctx, -size * 0.50, -size * 0.115, size, size * 0.23, size * 0.06);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.13, 0, Math.PI * 2);
        ctx.fill();
        for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * size * 0.50, Math.sin(angle) * size * 0.50);
            ctx.lineTo(Math.cos(angle) * size * 0.68, Math.sin(angle) * size * 0.68);
            ctx.stroke();
        }
    }
    ctx.restore();
}

export function drawPanelLine(ctx, x1, y1, x2, y2, alpha = 0.24) {
    ctx.strokeStyle = `rgba(208, 229, 238, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}
