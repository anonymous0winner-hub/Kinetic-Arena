import { CONFIG } from './config.js';
import { createCollider, geometryBoundingRadius, resolveEntityAgainstWalls } from './collision.js';

export class Food {
    constructor(x, y, geometryProvider) {
        this.kind = 'food';
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.active = true;
        this.geometryProvider = geometryProvider;
        this._staticRadius = geometryBoundingRadius(this.geometryProvider('food', this, null), 2.5);
    }

    getGeometry(game) {
        return this.geometryProvider('food', this, game);
    }

    get radius() {
        return this._staticRadius;
    }

    getCollider(game) {
        return createCollider(this.x, this.y, this.getGeometry(game), 2.5);
    }

    update(game) {
        const attractionRange = Math.max(0, Number(CONFIG.FOOD_ATTRACTION_RANGE) || 0);
        const attractionStrength = Math.max(0, Number(CONFIG.FOOD_ATTRACTION_STRENGTH) || 0);

        if (attractionRange > 0 && attractionStrength > 0) {
            const rangeSq = attractionRange * attractionRange;
            let target = null;
            let nearestSq = rangeSq;

            // Stable iteration order keeps attraction deterministic for seeded matches.
            for (const bot of game.bots) {
                if (!bot.alive) continue;
                const dx = bot.x - this.x;
                const dy = bot.y - this.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq >= nearestSq) continue;
                nearestSq = distanceSq;
                target = bot;
            }

            if (target && nearestSq > 1e-8) {
                const distance = Math.sqrt(nearestSq);
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const falloff = Math.max(0, 1 - distance / attractionRange);
                const acceleration = attractionStrength * (0.25 + falloff * 0.75);
                this.vx += dx / distance * acceleration;
                this.vy += dy / distance * acceleration;

                // A force-derived terminal speed prevents tunnelling and keeps the
                // two config values intuitive without adding another required knob.
                const maximumSpeed = Math.max(0.75, attractionStrength * 4.5);
                const speed = Math.hypot(this.vx, this.vy);
                if (speed > maximumSpeed) {
                    this.vx = this.vx / speed * maximumSpeed;
                    this.vy = this.vy / speed * maximumSpeed;
                }
            }
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.60;
        this.vy *= 0.60;
        resolveEntityAgainstWalls(this, game, 'entities');

        if (!game.arena.contains(this.x, this.y, this.radius) ||
            this.x < 0 || this.x > game.width || this.y < 0 || this.y > game.height) {
            this.active = false;
        }
    }
}

export class Powerup {
    constructor(x, y, definition, geometryProvider) {
        this.kind = 'powerup';
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.active = true;
        this.rotation = 0;
        this.definition = definition;
        this.type = definition.id;
        this.label = definition.label;
        this.strength = definition.strength;
        this.geometryProvider = geometryProvider;
        this._staticRadius = geometryBoundingRadius(this.geometryProvider('powerup', this, null), 14);
    }

    getGeometry(game) {
        return this.geometryProvider('powerup', this, game);
    }

    get radius() {
        return this._staticRadius;
    }

    getCollider(game) {
        return createCollider(this.x, this.y, this.getGeometry(game), 14);
    }

    update(game) {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.60;
        this.vy *= 0.60;
        this.rotation += 0.05;
        resolveEntityAgainstWalls(this, game, 'entities');
        if (!game.arena.contains(this.x, this.y, this.radius)) this.active = false;
    }
}

export class Projectile {
    constructor(shooter, targetX, targetY, weaponProfile, geometryProvider, angleOffset = 0, random = () => 0.5) {
        this.kind = 'projectile';
        this.shooter = shooter;
        this.x = shooter.x;
        this.y = shooter.y;
        this.previousX = this.x;
        this.previousY = this.y;
        this.team = shooter.team;
        this.visualVariant = weaponProfile.projectileVariant || 'standard';
        this.isOvercharged = this.visualVariant === 'overcharged';
        this.damageBase = weaponProfile.damageBase;
        this.damagePercent = weaponProfile.damagePercent;
        this.geometryProvider = geometryProvider;

        let angle = Math.atan2(targetY - shooter.y, targetX - shooter.x) + angleOffset;
        angle += (random() - 0.5) * 0.05;
        this.angle = angle;
        this.vx = Math.cos(angle) * weaponProfile.speed;
        this.vy = Math.sin(angle) * weaponProfile.speed;
        this.active = true;
        this.life = Number.isFinite(weaponProfile.lifeFrames) ? weaponProfile.lifeFrames : 120;
        this._staticRadius = geometryBoundingRadius(
            this.geometryProvider('projectile', this, null),
            this.isOvercharged ? 4.5 : 3
        );
    }

    getGeometry(game) {
        return this.geometryProvider('projectile', this, game);
    }

    get radius() {
        return this._staticRadius;
    }

    getCollider(game) {
        return createCollider(this.x, this.y, this.getGeometry(game), this.radius);
    }

    update(game) {
        this.previousX = this.x;
        this.previousY = this.y;
        this.x += this.vx;
        this.y += this.vy;
        this.angle = Math.atan2(this.vy, this.vx);
        this.life -= 1;
        if (this.life <= 0 || this.x < 0 || this.x > game.width || this.y < 0 || this.y > game.height) {
            this.active = false;
        }
    }
}

export class Particle {
    constructor({ x, y, vx = 0, vy = 0, colorToken = '#ffffff', life = 24, radius = 2, variant = 'dot', rotation = 0, spin = 0 }) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.colorToken = colorToken;
        this.life = life;
        this.maxLife = life;
        this.radius = radius;
        this.variant = variant;
        this.rotation = rotation;
        this.spin = spin;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.92;
        this.vy *= 0.92;
        this.rotation += this.spin;
        this.life -= 1;
    }
}

export function createBaseWeaponProfile(modifiers) {
    const weapon = modifiers.weapon;
    return {
        cooldown: Number.isFinite(weapon.cooldownOverride)
            ? weapon.cooldownOverride
            : CONFIG.WEAPON_COOLDOWN_BASE * weapon.cooldownMultiplier,
        speed: Number.isFinite(weapon.speedOverride)
            ? weapon.speedOverride
            : CONFIG.WEAPON_SPEED_BASE * weapon.speedMultiplier,
        damageBase: Number.isFinite(weapon.damageBaseOverride)
            ? weapon.damageBaseOverride
            : CONFIG.WEAPON_DAMAGE_BASE * weapon.damageMultiplier,
        damagePercent: CONFIG.WEAPON_DAMAGE_PCT * weapon.damagePercentMultiplier,
        projectileVariant: weapon.projectileVariant || 'standard',
        lifeFrames: 120
    };
}
