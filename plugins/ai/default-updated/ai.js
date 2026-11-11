export const metadata = Object.freeze({
    id: 'swarm-tactician',
    name: 'Swarm Tactician',
    apiVersion: 1
});

function sortNearest(items) {
    return [...items].sort((a, b) => a.distanceSq - b.distanceSq);
}

/**
 * AI plugin API.
 *
 * Input is a read-only perception/context object supplied by Bot.js.
 * Output contains only decisions: movement, fire requests, and optional world-force requests.
 * Core physics, cooldown enforcement, damage, collision, and collection remain authoritative.
 */
export function createController({ config, random = () => 0.5 }) {
    let wanderAngle = random() * Math.PI * 2;

    return {
        id: metadata.id,

        decide(context) {
            const { self, allies, enemies, foods, powerups, arena, canFire, isTopBot, hasPowerup } = context;
            const isAggressive = hasPowerup || isTopBot;
            const predators = [];
            const prey = [];
            const peers = [];

            for (const visible of enemies) {
                const other = visible.entity;
                const iAmStronger =
                    (self.power > other.power * 1.25 || self.overchargeTimer > 0) &&
                    other.overchargeTimer <= 0;
                const theyAreStronger =
                    (other.power > self.power * 1.15 || other.overchargeTimer > 0) &&
                    self.overchargeTimer <= 0;

                if (theyAreStronger) predators.push(visible);
                else if (iAmStronger) prey.push(visible);
                else peers.push(visible);
            }

            let forceX = 0;
            let forceY = 0;
            let isFleeing = false;
            let attackTarget = null;
            const itemForces = [];

            // Team cohesion and collision avoidance.
            if (allies.length > 0) {
                let averageX = 0;
                let averageY = 0;
                for (const ally of allies) {
                    averageX += ally.entity.x;
                    averageY += ally.entity.y;
                }
                averageX /= allies.length;
                averageY /= allies.length;

                const dx = averageX - self.x;
                const dy = averageY - self.y;
                const distance = Math.hypot(dx, dy) || 1;
                const underThreat = predators.length > 0 || peers.length > 0;
                const desiredDistance = underThreat ? 40 : 120;

                if (distance > desiredDistance) {
                    const weight = underThreat ? 2.5 : 0.8;
                    forceX += (dx / distance) * weight;
                    forceY += (dy / distance) * weight;
                } else {
                    forceX -= (dx / distance) * 1.5;
                    forceY -= (dy / distance) * 1.5;
                }
            }

            // Survival. A numerically inferior bot flees unless its current state is aggressive.
            if (predators.length > 0 && !isAggressive && allies.length < predators.length) {
                isFleeing = true;
                for (const predator of predators) {
                    const distance = Math.sqrt(predator.distanceSq) || 1;
                    forceX -= ((predator.entity.x - self.x) / distance) * 6.0;
                    forceY -= ((predator.entity.y - self.y) / distance) * 6.0;
                }
            }

            // Powerups outrank normal resource gathering when the bot is not fleeing.
            if (powerups.length > 0 && !isFleeing) {
                const target = sortNearest(powerups)[0];
                const distance = Math.sqrt(target.distanceSq) || 1;
                forceX += ((target.entity.x - self.x) / distance) * 4.0;
                forceY += ((target.entity.y - self.y) / distance) * 4.0;
            }

            // Pursuit and local numerical swarming.
            if (!isFleeing) {
                if (prey.length > 0) {
                    attackTarget = sortNearest(prey)[0];
                } else {
                    const threats = sortNearest([...peers, ...predators]);
                    if (threats.length > 0 && allies.length >= threats.length) {
                        attackTarget = threats[0];
                    }
                }
            }

            if (attackTarget) {
                const distance = Math.sqrt(attackTarget.distanceSq) || 1;
                const weight = isAggressive ? 3.0 : 2.0;
                forceX += ((attackTarget.entity.x - self.x) / distance) * weight;
                forceY += ((attackTarget.entity.y - self.y) / distance) * weight;
            }

            // Food collection and the original weak attraction effect on nearby food.
            if (foods.length > 0 && !isFleeing && !attackTarget) {
                const target = sortNearest(foods)[0];
                const distance = Math.sqrt(target.distanceSq) || 1;
                itemForces.push({
                    entity: target.entity,
                    x: ((self.x - target.entity.x) / distance) * 0.1,
                    y: ((self.y - target.entity.y) / distance) * 0.1
                });
                forceX += ((target.entity.x - self.x) / distance) * 1.2;
                forceY += ((target.entity.y - self.y) / distance) * 1.2;
            }

            // Re-enter the active zone.
            if (!arena.contains(self.x, self.y, self.radius)) {
                forceX += (arena.centerX - self.x) * 0.05;
                forceY += (arena.centerY - self.y) * 0.05;
            }

            // Organic wander belongs to the AI, not the physics engine.
            wanderAngle += (random() - 0.5) * 0.5;
            forceX += Math.cos(wanderAngle) * 0.3;
            forceY += Math.sin(wanderAngle) * 0.3;

            const fire = [];
            if (canFire) {
                const potentialTargets = sortNearest([...prey, ...peers, ...predators]);
                const nearest = potentialTargets[0];
                if (nearest && nearest.distanceSq < 350 * 350) {
                    const target = nearest.entity;
                    const targetX = target.x + target.vx * 10;
                    const targetY = target.y + target.vy * 10;
                    const spread = self.power > 60 || self.overchargeTimer > 0 ? [-0.1, 0, 0.1] : [0];
                    for (const angleOffset of spread) {
                        fire.push({ targetX, targetY, angleOffset });
                    }
                }
            }

            return {
                movement: { x: forceX, y: forceY },
                fire,
                itemForces,
                state: { isAggressive, isFleeing, attackTargetId: attackTarget?.entity.id ?? null }
            };
        }
    };
}
