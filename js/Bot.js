import { CONFIG } from './config.js';
import { checkLOS, distSq } from './math.js';
import {
    closestPointOnWall,
    collidersIntersect,
    createCollider,
    geometryBoundingRadius,
    resolveEntityAgainstWalls,
    wallVertices
} from './collision.js';
import { Projectile, createBaseWeaponProfile } from './entities.js';

function finiteOrZero(value) {
    return Number.isFinite(value) ? value : 0;
}

function freezeView(value) {
    return Object.freeze(value);
}

function sharedWallView(game, wall) {
    let cache = game._wallAiViewCache;
    if (!cache || cache.frame !== game.frameCount) {
        cache = { frame: game.frameCount, byWall: new Map() };
        game._wallAiViewCache = cache;
    }
    const existing = cache.byWall.get(wall);
    if (existing) return existing;
    const value = Object.freeze({
        id: wall.id,
        entity: wall,
        shape: wall.shape,
        center: Object.freeze({ x: wall.x, y: wall.y }),
        size: Object.freeze({ width: wall.w, height: wall.h }),
        angle: wall.angle || 0,
        velocity: Object.freeze({ x: wall.velocityX || 0, y: wall.velocityY || 0 }),
        collision: Object.freeze({ ...wall.collision }),
        styleVariant: wall.styleVariant,
        motion: wall.motion ? Object.freeze({ ...wall.motion }) : null,
        vertices: wallVertices(wall, game)
    });
    cache.byWall.set(wall, value);
    return value;
}

export class Bot {
    constructor({ id, team, x, y, aiId, aiController, geometryProvider, powerupSystem, random = () => 0.5, initialCooldownFrames = 60 }) {
        this.kind = 'bot';
        this.id = id;
        this.team = team;
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.power = CONFIG.STARTING_POWER;
        this.alive = true;
        this.random = random;
        this.weaponCooldown = random() * Math.max(0, initialCooldownFrames);
        this.effectStates = new Map();
        this.aiId = aiId;
        this.aiController = aiController;
        this.aiState = null;
        this.aiErrorReported = false;
        this.geometryProvider = geometryProvider;
        this.powerupSystem = powerupSystem;
        this.lastModifiers = null;
    }

    get health() {
        return this.power;
    }

    set health(value) {
        this.power = Math.max(0, Number(value) || 0);
    }

    getGeometry(game) {
        return this.geometryProvider('bot', this, game);
    }

    get radius() {
        if (this._cachedRadiusPower !== this.power || !Number.isFinite(this._cachedRadius)) {
            this._cachedRadiusPower = this.power;
            this._cachedRadius = geometryBoundingRadius(this.getGeometry(null), 16);
        }
        return this._cachedRadius;
    }

    getCollider(game) {
        return createCollider(this.x, this.y, this.getGeometry(game), 16);
    }

    get visionRangeSq() {
        return Math.pow(350 + this.radius * 1.5, 2);
    }

    get activePowerups() {
        return this.powerupSystem.getActiveViews(this);
    }

    get hasPowerup() {
        return this.effectStates.size > 0;
    }

    // Compatibility fields preserve the original AI and original renderer unchanged in behavior.
    get overchargeTimer() { return this.powerupSystem.getCompatibilityTimer(this, 'OVERCHARGE'); }
    set overchargeTimer(value) { this.powerupSystem.setCompatibilityTimer(this, 'OVERCHARGE', value); }
    get shieldTimer() { return this.powerupSystem.getCompatibilityTimer(this, 'AEGIS'); }
    set shieldTimer(value) { this.powerupSystem.setCompatibilityTimer(this, 'AEGIS', value); }
    get turboTimer() { return this.powerupSystem.getCompatibilityTimer(this, 'TURBO'); }
    set turboTimer(value) { this.powerupSystem.setCompatibilityTimer(this, 'TURBO', value); }
    get regenTimer() { return this.powerupSystem.getCompatibilityTimer(this, 'REGEN'); }
    set regenTimer(value) { this.powerupSystem.setCompatibilityTimer(this, 'REGEN', value); }

    update(game) {
        if (!this.alive) return;

        this._updateAuthoritativeState(game);
        if (!this.alive) return;

        this._collectContactPowerups(game);
        const perception = this._buildPerception(game);
        const decision = this._requestDecision(perception);
        this._applyDecisionSideEffects(decision);
        const movement = this._normaliseMovement(decision?.movement);
        this._executeFire(decision?.fire, game);
        this._applyPhysics(movement.x, movement.y, game);
        this._consumeFood(game);
    }

    _updateAuthoritativeState(game) {
        if (!game.arena.contains(this.x, this.y, this.radius) && game.arena.damageActive) {
            const damage = game.arena.getZoneDamage();
            const intervalFrames = Math.max(1, Number(damage.intervalFrames) || 30);
            if (game.frameCount % intervalFrames === 0) {
                const amount = Math.ceil(this.power * (Number(damage.percent) || 0)) + (Number(damage.base) || 0);
                this.power = Math.max(1, this.power - amount);
                game.emitEffect('zone-damage', { bot: this, x: this.x, y: this.y, amount });
                game.emitGameEvent?.('zone-damage', {
                    botId: this.id, teamId: this.team.id, x: this.x, y: this.y,
                    amount, health: this.power, worldWidth: game.width, worldHeight: game.height
                });
                if (this.power <= 1) game.triggerKill(this);
            }
        }

        this.powerupSystem.updateBot(this, game);
        this.lastModifiers = this.powerupSystem.getModifiers(this, game);
        if (this.weaponCooldown > 0) this.weaponCooldown -= 1;
    }

    _collectContactPowerups(game) {
        const selfRadius = this.radius;
        const selfCollider = this.getCollider(game);
        for (const powerup of game.powerups) {
            if (!powerup.active) continue;
            const contactRadius = selfRadius + powerup.radius;
            if (distSq(this.x, this.y, powerup.x, powerup.y) > contactRadius * contactRadius) continue;
            if (collidersIntersect(selfCollider, powerup.getCollider(game))) {
                this.powerupSystem.collect(powerup, this, game);
            }
        }
    }

    _buildPerception(game) {
        const freeze = game.control?.logicOnly ? value => value : freezeView;
        const selfRadius = this.radius;
        const visionRangeSq = Math.pow(350 + selfRadius * 1.5, 2);
        const allies = [];
        const enemies = [];
        const foods = [];
        const powerups = [];
        const walls = [];
        const projectiles = [];
        const ownedPowerups = this.powerupSystem.getActiveViews(this);

        for (const other of game.bots) {
            if (!other.alive || other === this) continue;
            const distanceSq = distSq(this.x, this.y, other.x, other.y);
            if (distanceSq > visionRangeSq) continue;
            if (!checkLOS(this.x, this.y, other.x, other.y, game.arena.walls)) continue;
            const record = freeze({
                entity: other,
                distanceSq,
                distance: Math.sqrt(distanceSq),
                health: other.power,
                power: other.power,
                radius: other.radius,
                velocity: freeze({ x: other.vx, y: other.vy }),
                activePowerups: freeze(this.powerupSystem.getActiveViews(other))
            });
            if (other.team.id === this.team.id) allies.push(record);
            else enemies.push(record);
        }

        for (const powerup of game.powerups) {
            if (!powerup.active) continue;
            const distanceSq = distSq(this.x, this.y, powerup.x, powerup.y);
            if (distanceSq <= visionRangeSq && checkLOS(this.x, this.y, powerup.x, powerup.y, game.arena.walls)) {
                powerups.push(freeze({
                    entity: powerup,
                    id: powerup.type,
                    label: powerup.label,
                    strength: powerup.strength,
                    distanceSq,
                    distance: Math.sqrt(distanceSq),
                    position: freeze({ x: powerup.x, y: powerup.y }),
                    aiTags: freeze([...(powerup.definition.aiTags || [])])
                }));
            }
        }

        for (const food of game.foods) {
            if (!food.active) continue;
            const distanceSq = distSq(this.x, this.y, food.x, food.y);
            if (distanceSq <= visionRangeSq && checkLOS(this.x, this.y, food.x, food.y, game.arena.walls)) {
                foods.push(freeze({ entity: food, distanceSq, distance: Math.sqrt(distanceSq) }));
            }
        }

        for (const wall of game.arena.walls) {
            const nearest = closestPointOnWall(this.x, this.y, wall, game);
            if (nearest.distanceSq > visionRangeSq) continue;
            const shared = sharedWallView(game, wall);
            walls.push(freeze({
                ...shared,
                nearestPoint: freeze({ x: nearest.x, y: nearest.y }),
                distanceSq: nearest.distanceSq,
                distance: Math.sqrt(nearest.distanceSq)
            }));
        }

        for (const projectile of game.projectiles) {
            if (!projectile.active || projectile.shooter === this) continue;
            const distanceSq = distSq(this.x, this.y, projectile.x, projectile.y);
            if (distanceSq > visionRangeSq) continue;
            if (!checkLOS(this.x, this.y, projectile.x, projectile.y, game.arena.walls)) continue;

            const relativeX = projectile.x - this.x;
            const relativeY = projectile.y - this.y;
            const relativeVx = projectile.vx - this.vx;
            const relativeVy = projectile.vy - this.vy;
            const speedSq = relativeVx * relativeVx + relativeVy * relativeVy;
            const timeToClosest = speedSq > 1e-9
                ? Math.max(0, Math.min(120, -(relativeX * relativeVx + relativeY * relativeVy) / speedSq))
                : Infinity;
            const closestX = relativeX + relativeVx * timeToClosest;
            const closestY = relativeY + relativeVy * timeToClosest;
            const closestDistance = Math.hypot(closestX, closestY);
            const hostile = projectile.team.id !== this.team.id;
            const threatRadius = selfRadius + projectile.radius + 12;

            projectiles.push(freeze({
                entity: projectile,
                hostile,
                teamId: projectile.team.id,
                distanceSq,
                distance: Math.sqrt(distanceSq),
                position: freeze({ x: projectile.x, y: projectile.y }),
                velocity: freeze({ x: projectile.vx, y: projectile.vy }),
                radius: projectile.radius,
                damageBase: projectile.damageBase,
                damagePercent: projectile.damagePercent,
                timeToClosest,
                predictedClosestDistance: closestDistance,
                isStraightLineThreat: hostile && timeToClosest <= 45 && closestDistance <= threatRadius
            }));
        }

        const selfStatus = freeze({
            id: this.id,
            teamId: this.team.id,
            health: this.power,
            power: this.power,
            alive: this.alive,
            radius: selfRadius,
            position: freeze({ x: this.x, y: this.y }),
            velocity: freeze({ x: this.vx, y: this.vy }),
            weaponCooldown: Math.max(0, this.weaponCooldown),
            canFire: this.weaponCooldown <= 0,
            activePowerups: freeze(ownedPowerups)
        });

        return freeze({
            self: this,
            selfStatus,
            health: this.power,
            frameCount: game.frameCount,
            timeScale: game.gameConfig.timeScale,
            seed: game.currentSeed,
            matchRemainingFrames: Math.max(0, game.match.maxFrames - game.frameCount),
            allies: freeze(allies),
            teammates: freeze(allies),
            enemies: freeze(enemies),
            foods: freeze(foods),
            powerups: freeze(powerups),
            ownedPowerups: freeze(ownedPowerups),
            walls: freeze(walls),
            projectiles: freeze(projectiles),
            canFire: this.weaponCooldown <= 0,
            hasPowerup: this.hasPowerup,
            isTopBot: game.topBot === this,
            arena: freeze({
                centerX: game.arena.centerX,
                centerY: game.arena.centerY,
                safeSize: game.arena.safeSize,
                safeHalfWidth: game.arena.safeHalfWidth,
                safeHalfHeight: game.arena.safeHalfHeight,
                damageActive: game.arena.damageActive,
                currentStageId: game.arena.currentStage?.id || null,
                matchRemainingFrames: Math.max(0, game.match.maxFrames - game.frameCount),
                contains: (x, y, radius = 0) => game.arena.contains(x, y, radius)
            })
        });
    }

    _requestDecision(perception) {
        try {
            const decision = this.aiController.decide(perception) || {};
            this.aiState = decision.state ?? this.aiState;
            this.aiErrorReported = false;
            return decision;
        } catch (error) {
            if (!this.aiErrorReported) {
                console.error(`AI plugin "${this.aiId}" failed for bot "${this.id}". The bot will coast until the controller recovers.`, error);
                this.aiErrorReported = true;
            }
            return { movement: { x: 0, y: 0 }, fire: [], itemForces: [] };
        }
    }

    _applyDecisionSideEffects(decision) {
        const itemForces = Array.isArray(decision?.itemForces) ? decision.itemForces : [];
        for (const force of itemForces.slice(0, 4)) {
            const entity = force?.entity;
            if (!entity?.active || !Number.isFinite(entity.vx) || !Number.isFinite(entity.vy)) continue;
            entity.vx += finiteOrZero(force.x);
            entity.vy += finiteOrZero(force.y);
        }
    }

    _normaliseMovement(movement) {
        let x = finiteOrZero(movement?.x);
        let y = finiteOrZero(movement?.y);
        const magnitude = Math.hypot(x, y);
        if (magnitude > 0) {
            x /= magnitude;
            y /= magnitude;
        }
        return { x, y };
    }

    _executeFire(fireRequests, game) {
        if (this.weaponCooldown > 0 || !Array.isArray(fireRequests) || fireRequests.length === 0) return;

        const modifiers = this.powerupSystem.getModifiers(this, game);
        const weaponProfile = createBaseWeaponProfile(modifiers);
        let fired = 0;
        for (const request of fireRequests.slice(0, CONFIG.MAX_SHOTS_PER_DECISION)) {
            if (!Number.isFinite(request?.targetX) || !Number.isFinite(request?.targetY)) continue;
            const projectile = new Projectile(
                this,
                request.targetX,
                request.targetY,
                weaponProfile,
                this.geometryProvider,
                finiteOrZero(request.angleOffset),
                () => game.randomValue(`projectile:${this.id}`)
            );
            game.projectiles.push(projectile);
            game.emitGameEvent?.('shoot', {
                botId: this.id,
                teamId: this.team.id,
                x: this.x,
                y: this.y,
                angle: projectile.angle,
                variant: projectile.visualVariant,
                worldWidth: game.width,
                worldHeight: game.height
            });
            fired += 1;
        }

        if (fired > 0) this.weaponCooldown = Math.max(1, weaponProfile.cooldown);
    }

    _applyPhysics(forceX, forceY, game) {
        const speedModifier = this.power < 35 ? 1.3 : (this.power > 150 ? 0.85 : 1.0);
        const modifiers = this.powerupSystem.getModifiers(this, game);
        const thrustMultiplier = modifiers.movement.thrustMultiplier;

        this.vx += CONFIG.THRUST_FORCE * forceX * thrustMultiplier * speedModifier;
        this.vy += CONFIG.THRUST_FORCE * forceY * thrustMultiplier * speedModifier;
        this.vx *= CONFIG.FRICTION;
        this.vy *= CONFIG.FRICTION;
        this.x += this.vx;
        this.y += this.vy;

        resolveEntityAgainstWalls(this, game, 'entities');

        const radius = this.radius;
        if (this.x < radius) {
            this.x = radius;
            this.vx *= -CONFIG.BOUNCE;
        }
        if (this.x > game.width - radius) {
            this.x = game.width - radius;
            this.vx *= -CONFIG.BOUNCE;
        }
        if (this.y < radius) {
            this.y = radius;
            this.vy *= -CONFIG.BOUNCE;
        }
        if (this.y > game.height - radius) {
            this.y = game.height - radius;
            this.vy *= -CONFIG.BOUNCE;
        }
    }

    _consumeFood(game) {
        const selfRadius = this.radius;
        const selfCollider = this.getCollider(game);
        for (let index = game.foods.length - 1; index >= 0; index -= 1) {
            const food = game.foods[index];
            if (!food.active) continue;
            const contactRadius = selfRadius + food.radius;
            if (distSq(this.x, this.y, food.x, food.y) > contactRadius * contactRadius) continue;
            if (collidersIntersect(selfCollider, food.getCollider(game))) {
                this.power += 1;
                food.active = false;
                game.emitGameEvent?.('food-collect', {
                    botId: this.id, teamId: this.team.id, x: this.x, y: this.y,
                    health: this.power, worldWidth: game.width, worldHeight: game.height
                });
            }
        }
    }
}
