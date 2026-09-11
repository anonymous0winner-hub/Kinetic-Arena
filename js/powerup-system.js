function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function mergeModifiers(target, source, strength) {
    if (!source || typeof source !== 'object') return;

    if (source.movement) {
        target.movement.thrustMultiplier *= finite(source.movement.thrustMultiplier, 1);
    }

    if (source.weapon) {
        target.weapon.cooldownMultiplier *= finite(source.weapon.cooldownMultiplier, 1);
        target.weapon.speedMultiplier *= finite(source.weapon.speedMultiplier, 1);
        target.weapon.damageMultiplier *= finite(source.weapon.damageMultiplier, 1);
        target.weapon.damagePercentMultiplier *= finite(source.weapon.damagePercentMultiplier, 1);
        if (Number.isFinite(source.weapon.cooldownOverride) && strength >= target.weapon.cooldownOverrideStrength) {
            target.weapon.cooldownOverride = source.weapon.cooldownOverride;
            target.weapon.cooldownOverrideStrength = strength;
        }
        if (Number.isFinite(source.weapon.speedOverride) && strength >= target.weapon.speedOverrideStrength) {
            target.weapon.speedOverride = source.weapon.speedOverride;
            target.weapon.speedOverrideStrength = strength;
        }
        if (Number.isFinite(source.weapon.damageBaseOverride) && strength >= target.weapon.damageOverrideStrength) {
            target.weapon.damageBaseOverride = source.weapon.damageBaseOverride;
            target.weapon.damageOverrideStrength = strength;
        }
        if (typeof source.weapon.projectileVariant === 'string' && strength >= target.weapon.variantStrength) {
            target.weapon.projectileVariant = source.weapon.projectileVariant;
            target.weapon.variantStrength = strength;
        }
    }

    if (source.defense) {
        target.defense.projectileImmunity ||= Boolean(source.defense.projectileImmunity);
        target.defense.damageMultiplier *= finite(source.defense.damageMultiplier, 1);
    }
}

export class PowerupSystem {
    constructor(definitions, { random = () => 0.5 } = {}) {
        this.random = random;
        this.definitions = new Map();

        for (const definition of definitions) {
            assert(definition && typeof definition.id === 'string' && definition.id.length > 0, 'Powerup definition requires an id.');
            assert(!this.definitions.has(definition.id), `Duplicate powerup definition "${definition.id}".`);
            assert(Number.isFinite(definition.strength), `Powerup "${definition.id}" requires numeric strength.`);
            this.definitions.set(definition.id, Object.freeze({
                label: definition.id,
                spawnWeight: 1,
                durationFrames: 0,
                ...definition
            }));
        }

        assert(this.definitions.size > 0, 'At least one powerup plugin must be enabled.');
    }

    setRandom(random) {
        assert(typeof random === 'function', 'PowerupSystem.setRandom(random) requires a function.');
        this.random = random;
    }

    getDefinition(id) {
        return this.definitions.get(id) || null;
    }

    listDefinitions() {
        return [...this.definitions.values()];
    }

    pickDefinition(random = this.random) {
        const candidates = this.listDefinitions().filter(definition => finite(definition.spawnWeight, 0) > 0);
        assert(candidates.length > 0, 'No enabled powerup has a positive spawnWeight.');
        const totalWeight = candidates.reduce((sum, definition) => sum + finite(definition.spawnWeight, 0), 0);
        let cursor = random() * totalWeight;
        for (const definition of candidates) {
            cursor -= finite(definition.spawnWeight, 0);
            if (cursor <= 0) return definition;
        }
        return candidates[candidates.length - 1];
    }

    collect(instance, bot, game) {
        const definition = instance.definition || this.getDefinition(instance.type);
        if (!definition) return false;

        instance.active = false;
        const duration = Math.max(0, Math.round(finite(definition.durationFrames, 0)));
        let effect = null;
        if (duration > 0) {
            const previous = bot.effectStates.get(definition.id);
            effect = {
                id: definition.id,
                label: definition.label,
                strength: definition.strength,
                duration,
                remaining: duration,
                elapsed: 0,
                stacks: Math.min((previous?.stacks || 0) + 1, Math.max(1, definition.maxStacks || 1)),
                data: previous?.data ? { ...previous.data } : {}
            };
            bot.effectStates.set(definition.id, effect);
        }

        const api = this._createEffectApi(bot, game);
        definition.onCollect?.({ bot, game, instance, effect, definition, api });
        game.emitGameEvent?.('powerup-collect', {
            botId: bot.id, teamId: bot.team?.id, powerupId: definition.id,
            x: bot.x, y: bot.y, strength: definition.strength,
            worldWidth: game.width, worldHeight: game.height
        });
        game.emitEffect('powerup-collect', {
            bot,
            powerup: instance,
            powerupId: definition.id,
            x: bot.x,
            y: bot.y,
            strength: definition.strength
        });
        return true;
    }

    updateBot(bot, game) {
        for (const [id, effect] of [...bot.effectStates]) {
            const definition = this.getDefinition(id);
            if (!definition) {
                bot.effectStates.delete(id);
                continue;
            }

            const api = this._createEffectApi(bot, game);
            definition.onTick?.({ bot, game, effect, definition, api });
            effect.elapsed += 1;
            effect.remaining -= 1;

            if (effect.remaining <= 0) {
                definition.onExpire?.({ bot, game, effect, definition, api });
                bot.effectStates.delete(id);
            }
        }
    }

    getModifiers(bot, game) {
        const result = {
            movement: { thrustMultiplier: 1 },
            weapon: {
                cooldownMultiplier: 1,
                speedMultiplier: 1,
                damageMultiplier: 1,
                damagePercentMultiplier: 1,
                cooldownOverride: null,
                speedOverride: null,
                damageBaseOverride: null,
                projectileVariant: 'standard',
                cooldownOverrideStrength: -Infinity,
                speedOverrideStrength: -Infinity,
                damageOverrideStrength: -Infinity,
                variantStrength: -Infinity
            },
            defense: { projectileImmunity: false, damageMultiplier: 1 }
        };

        for (const effect of bot.effectStates.values()) {
            const definition = this.getDefinition(effect.id);
            if (!definition?.getModifiers) continue;
            const modifiers = definition.getModifiers({ bot, game, effect, definition }) || {};
            mergeModifiers(result, modifiers, definition.strength);
        }
        return result;
    }

    getActiveViews(bot) {
        return [...bot.effectStates.values()]
            .map(effect => {
                const definition = this.getDefinition(effect.id);
                return Object.freeze({
                    id: effect.id,
                    label: effect.label,
                    strength: effect.strength,
                    remainingFrames: effect.remaining,
                    durationFrames: effect.duration,
                    remainingRatio: effect.duration > 0 ? effect.remaining / effect.duration : 0,
                    stacks: effect.stacks,
                    aiTags: Object.freeze([...(definition?.aiTags || [])])
                });
            })
            .sort((first, second) => second.strength - first.strength);
    }

    getCompatibilityTimer(bot, id) {
        return bot.effectStates.get(id)?.remaining || 0;
    }

    setCompatibilityTimer(bot, id, value) {
        const definition = this.getDefinition(id);
        if (!definition) return;
        const duration = Math.max(0, Math.round(finite(value, 0)));
        if (duration <= 0) {
            bot.effectStates.delete(id);
            return;
        }
        bot.effectStates.set(id, {
            id,
            label: definition.label,
            strength: definition.strength,
            duration,
            remaining: duration,
            elapsed: 0,
            stacks: 1,
            data: {}
        });
    }

    _createEffectApi(bot, game) {
        return Object.freeze({
            addPower(amount) {
                bot.power = Math.max(0, bot.power + finite(amount, 0));
            },
            setPower(value) {
                bot.power = Math.max(0, finite(value, bot.power));
            },
            emitEffect(name, data = {}) {
                game.emitEffect(name, { bot, x: bot.x, y: bot.y, ...data });
            },
            refreshEffect(id, durationFrames) {
                const effect = bot.effectStates.get(id);
                if (!effect) return;
                effect.duration = Math.max(effect.duration, Math.round(finite(durationFrames, effect.duration)));
                effect.remaining = effect.duration;
            }
        });
    }
}
