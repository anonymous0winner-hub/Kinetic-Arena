import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

class ClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach(name => this.values.add(name)); }
    remove(...names) { names.forEach(name => this.values.delete(name)); }
    toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
        if (enabled) this.values.add(name);
        else this.values.delete(name);
        return enabled;
    }
}

const elementsById = new Map();
const styleLinks = [];

class ElementMock {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.className = '';
        this.classList = new ClassList();
        this.style = {
            setProperty(name, value) { this[name] = value; }
        };
        this.hidden = false;
        this.textContent = '';
        this.listeners = new Map();
        this._id = '';
    }

    set id(value) {
        this._id = value;
        if (value) elementsById.set(value, this);
    }

    get id() { return this._id; }

    append(...children) { this.children.push(...children); }
    appendChild(child) {
        this.children.push(child);
        if (child.tagName === 'LINK') {
            styleLinks.push(child);
            queueMicrotask(() => child.listeners.get('load')?.());
        }
        return child;
    }
    replaceChildren(...children) { this.children = [...children]; }
    remove() {
        const index = styleLinks.indexOf(this);
        if (index >= 0) styleLinks.splice(index, 1);
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
}

function createContext() {
    const gradient = { addColorStop() {} };
    const methods = [
        'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
        'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'setLineDash', 'clip',
        'roundRect', 'fillText', 'rect', 'quadraticCurveTo', 'scale', 'drawImage'
    ];
    const context = {
        createRadialGradient() { return gradient; },
        createLinearGradient() { return gradient; }
    };
    for (const method of methods) context[method] = () => {};
    return context;
}

const canvas = new ElementMock('canvas');
canvas.id = 'gameCanvas';
canvas.width = 0;
canvas.height = 0;
canvas.getContext = () => createContext();

for (const id of ['arena-viewport', 'loading-status', 'status-text', 'zone-status', 'score-grid']) {
    const element = id === 'arena-viewport' ? new ElementMock('main') : new ElementMock('div');
    element.id = id;
}

globalThis.document = {
    documentElement: new ElementMock('html'),
    head: new ElementMock('head'),
    createElement(tagName) {
        const element = new ElementMock(tagName);
        if (String(tagName).toLowerCase() === 'canvas') {
            element.width = 0;
            element.height = 0;
            element.getContext = () => createContext();
        }
        return element;
    },
    getElementById(id) { return elementsById.get(id) || null; },
    querySelectorAll(selector) {
        return selector === 'link[data-kinetic-style]' ? [...styleLinks] : [];
    }
};

globalThis.window = {
    innerWidth: 540,
    innerHeight: 960,
    addEventListener() {}
};

let animationFrames = 0;
let mockTimestamp = 0;
globalThis.requestAnimationFrame = callback => {
    animationFrames += 1;
    mockTimestamp += 1000 / 60;
    if (animationFrames <= 12) setImmediate(() => callback(mockTimestamp));
    return animationFrames;
};

globalThis.fetch = async url => {
    const parsed = url instanceof URL ? url : new URL(url);
    if (parsed.protocol !== 'file:') throw new Error(`Unexpected fetch protocol: ${parsed.protocol}`);
    try {
        const text = await fs.readFile(fileURLToPath(parsed), 'utf8');
        return {
            ok: true,
            status: 200,
            async json() { return JSON.parse(text); }
        };
    } catch {
        return { ok: false, status: 404, async json() { throw new Error('Not found'); } };
    }
};

const runtimeConfig = JSON.parse(await fs.readFile(new URL('../game-config.json', import.meta.url), 'utf8'));

await import('../js/main.js');

for (let attempt = 0; attempt < 100 && !window.KineticArena; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
}

assert.ok(window.KineticArena, 'main.js did not finish bootstrap');
assert.equal(window.KineticArena.bots.length, 16);
assert.equal(window.KineticArena.seed, String(runtimeConfig.seed));
assert.equal(window.KineticArena.timeScale, 1);
assert.equal(window.KineticArena.audio.id, 'quiet-mechanism');
assert.equal(window.KineticArena.recording.settings.width, 1080);
assert.equal(window.KineticArena.recording.settings.height, 1920);
assert.deepEqual(window.KineticArena.seedFinder.listEvaluators(), ['engaging-v2', 'demo-health-winner']);
assert.equal(window.KineticArena.manifests.audio.schemaVersion, 1);
assert.equal(window.KineticArena.getEvents()[0].type, 'match-start');
assert.equal(window.KineticArena.match.maxFrames, 3540);
assert.deepEqual(window.KineticArena.viewport, {
    mode: 'fixed',
    width: 1080,
    height: 1920,
    fit: 'contain'
});
assert.equal(elementsById.get('loading-status').hidden, true);
assert.ok(window.KineticArena.frameCount > 0);
assert.equal(elementsById.get('score-grid').children.length, 4);

const replayFirst = window.KineticArena.recording.runAuthoritative({
    seed: 'runtime-replay-seed',
    holdFrames: 0,
    maxFrames: 12
});
const replaySecond = window.KineticArena.recording.runAuthoritative({
    seed: 'runtime-replay-seed',
    holdFrames: 0,
    maxFrames: 12
});
assert.equal(replayFirst.stopSimulationFrame, 12);
assert.equal(replayFirst.checksum, replaySecond.checksum);
assert.equal(replayFirst.snapshot.winnerTeamId, replaySecond.snapshot.winnerTeamId);
assert.ok(Array.isArray(replayFirst.events));

console.log('Kinetic Arena browserless runtime smoke test passed.');
