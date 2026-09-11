import { PowerupSystem } from './powerup-system.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function resolveFromManifest(manifestUrl, relativePath) {
    return new URL(relativePath, manifestUrl).href;
}

async function fetchManifest(urlValue, type) {
    assert(typeof urlValue === 'string' && urlValue.length > 0, `Missing ${type} manifest URL.`);
    const manifestUrl = new URL(urlValue);
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Unable to load plugin manifest ${manifestUrl.pathname}: HTTP ${response.status}`);
    }

    const manifest = await response.json();
    assert(manifest && Array.isArray(manifest.plugins), `${manifestUrl.pathname} must contain a plugins array.`);

    const byId = new Map();
    for (const entry of manifest.plugins) {
        assert(entry && typeof entry.id === 'string' && entry.id.length > 0, `${manifestUrl.pathname} contains a plugin without an id.`);
        assert(typeof entry.module === 'string' && entry.module.length > 0, `Plugin "${entry.id}" has no module path.`);
        assert(!byId.has(entry.id), `Duplicate plugin id "${entry.id}" in ${manifestUrl.pathname}.`);
        byId.set(entry.id, Object.freeze({ ...entry }));
    }

    return Object.freeze({ url: manifestUrl, raw: manifest, byId });
}

async function importEntry(manifest, id, expectedType) {
    const entry = manifest.byId.get(id);
    assert(entry, `Unknown ${expectedType} plugin "${id}". Add it to ${manifest.url.pathname}.`);
    const moduleUrl = resolveFromManifest(manifest.url, entry.module);
    const imported = await import(moduleUrl);
    return { entry, imported, moduleUrl };
}

function loadStylesheets(manifest, entry) {
    if (typeof document === 'undefined') return Promise.resolve([]);
    const cssFiles = Array.isArray(entry.css) ? entry.css : [];
    const desiredHrefs = new Set(cssFiles.map(relativePath => resolveFromManifest(manifest.url, relativePath)));

    for (const existing of document.querySelectorAll('link[data-kinetic-style]')) {
        if (!desiredHrefs.has(existing.dataset.kineticStyle)) existing.remove();
    }

    const links = cssFiles.map(relativePath => {
        const href = resolveFromManifest(manifest.url, relativePath);
        let link = [...document.querySelectorAll('link[data-kinetic-style]')]
            .find(candidate => candidate.dataset.kineticStyle === href);
        if (link) return Promise.resolve(link);

        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.kineticStyle = href;
        document.head.appendChild(link);
        return new Promise((resolve, reject) => {
            link.addEventListener('load', () => resolve(link), { once: true });
            link.addEventListener('error', () => reject(new Error(`Unable to load style CSS ${href}`)), { once: true });
        });
    });
    return Promise.all(links);
}

function validateStyle(style, id) {
    const required = [
        'drawBackground', 'drawZone', 'drawWall', 'drawFood', 'drawPowerup',
        'drawProjectile', 'drawParticle', 'drawBot', 'drawClimaxRing',
        'getTeamVisual', 'getPowerupVisual', 'styleTeamElement', 'getGeometry',
        'createEffectParticles'
    ];
    for (const method of required) {
        assert(typeof style?.[method] === 'function', `Style plugin "${id}" must implement ${method}().`);
    }
}

function validateMapModule(module, id) {
    assert(typeof module.createMap === 'function', `Map plugin "${id}" must export createMap(context).`);
}

function validateAIController(controller, id) {
    assert(controller && typeof controller.decide === 'function', `AI plugin "${id}" must create a controller with decide(context).`);
}

function validatePowerupDefinition(definition, id) {
    assert(definition && definition.id === id, `Powerup plugin "${id}" must export definition with matching id.`);
    assert(typeof definition.label === 'string' && definition.label.length > 0, `Powerup "${id}" requires a label.`);
    assert(Number.isFinite(definition.strength), `Powerup "${id}" requires numeric strength.`);
}

function applyPowerupOverride(definition, override = {}) {
    const allowed = new Set(['strength', 'spawnWeight', 'durationFrames', 'maxStacks']);
    for (const key of Object.keys(override)) {
        assert(allowed.has(key), `Unsupported powerup override "${definition.id}.${key}" in game-config.json.`);
        assert(Number.isFinite(override[key]), `Powerup override "${definition.id}.${key}" must be numeric.`);
    }
    return Object.freeze({ ...definition, ...override });
}

export async function loadPluginRuntime(selection, dependencies) {
    const urls = selection.manifestUrls || {};
    const [styleManifest, aiManifest, mapManifest, powerupManifest, audioManifest] = await Promise.all([
        fetchManifest(urls.styles, 'styles'),
        fetchManifest(urls.ai, 'AI'),
        fetchManifest(urls.maps, 'maps'),
        fetchManifest(urls.powerups, 'powerups'),
        fetchManifest(urls.audio, 'audio')
    ]);

    const requestedPowerupIds = Array.isArray(selection.powerupIds) && selection.powerupIds.length > 0
        ? selection.powerupIds
        : [...powerupManifest.byId.keys()];
    const powerupDefinitions = [];
    for (const powerupId of requestedPowerupIds) {
        const { imported } = await importEntry(powerupManifest, powerupId, 'powerup');
        validatePowerupDefinition(imported.definition, powerupId);
        powerupDefinitions.push(applyPowerupOverride(imported.definition, selection.powerupOverrides?.[powerupId]));
    }
    const powerups = new PowerupSystem(powerupDefinitions, { random: dependencies.random || (() => 0.5) });

    const { entry: styleEntry, imported: styleModule } = await importEntry(styleManifest, selection.styleId, 'style');
    if (!dependencies.logicOnly) await loadStylesheets(styleManifest, styleEntry);
    assert(typeof styleModule.createStyle === 'function', `Style plugin "${selection.styleId}" must export createStyle(context).`);
    const style = styleModule.createStyle({
        ...dependencies,
        options: selection.pluginOptions?.style || {},
        powerupDefinitions: powerups.listDefinitions()
    });
    validateStyle(style, selection.styleId);

    const { imported: mapModule } = await importEntry(mapManifest, selection.mapId, 'map');
    validateMapModule(mapModule, selection.mapId);

    const { imported: audioModule } = await importEntry(audioManifest, selection.audioId, 'audio');
    assert(typeof audioModule.createAudioTheme === 'function', `Audio plugin "${selection.audioId}" must export createAudioTheme(context).`);
    const audioTheme = audioModule.createAudioTheme({
        ...dependencies,
        options: selection.pluginOptions?.audio || {}
    });
    assert(audioTheme && typeof audioTheme.mapEvent === 'function', `Audio plugin "${selection.audioId}" must create a theme with mapEvent(event).`);

    const requestedAIIds = new Set([
        selection.defaultAIId,
        ...(selection.enabledAIIds || []),
        ...Object.values(selection.botAI || {})
    ]);
    const aiModules = new Map();
    for (const aiId of requestedAIIds) {
        const { imported } = await importEntry(aiManifest, aiId, 'AI');
        assert(typeof imported.createController === 'function', `AI plugin "${aiId}" must export createController(api).`);
        aiModules.set(aiId, imported);
    }

    return Object.freeze({
        style,
        styleEntry,
        mapModule,
        mapOptions: Object.freeze({ ...(selection.pluginOptions?.map || {}) }),
        powerups,
        audioTheme,
        manifests: Object.freeze({
            styles: styleManifest.raw,
            ai: aiManifest.raw,
            maps: mapManifest.raw,
            powerups: powerupManifest.raw,
            audio: audioManifest.raw
        }),
        createAIController(aiId, api) {
            const module = aiModules.get(aiId);
            assert(module, `AI plugin "${aiId}" was not loaded.`);
            const controller = module.createController({
                ...api,
                options: Object.freeze({ ...(selection.pluginOptions?.ai?.[aiId] || {}) }),
                powerupDefinitions: powerups.listDefinitions()
            });
            validateAIController(controller, aiId);
            return controller;
        }
    });
}
