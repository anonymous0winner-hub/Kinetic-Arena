export const metadata = Object.freeze({
    id: 'sentinel-vector',
    name: 'Sentinel Vector',
    apiVersion: 3
});

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function addNormalised(vector, dx, dy, weight) {
    const length = Math.hypot(dx, dy) || 1;
    vector.x += dx / length * weight;
    vector.y += dy / length * weight;
}

function nearest(items) {
    let best = null;
    for (const item of items) {
        if (!best || item.distanceSq < best.distanceSq) best = item;
    }
    return best;
}

function centroid(records) {
    if (records.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const record of records) {
        x += record.entity.x;
        y += record.entity.y;
    }
    return { x: x / records.length, y: y / records.length };
}

function predictedIntercept(self, target, projectileSpeed) {
    const rx = target.x - self.x;
    const ry = target.y - self.y;
    const vx = target.vx || 0;
    const vy = target.vy || 0;
    const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
    const b = 2 * (rx * vx + ry * vy);
    const c = rx * rx + ry * ry;
    let time = 0;

    if (Math.abs(a) < 1e-6) {
        if (Math.abs(b) > 1e-6) time = Math.max(0, -c / b);
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const first = (-b - root) / (2 * a);
            const second = (-b + root) / (2 * a);
            const candidates = [first, second].filter(value => value > 0);
            if (candidates.length > 0) time = Math.min(...candidates);
        }
    }

    time = clamp(time, 0, 28);
    return { x: target.x + vx * time, y: target.y + vy * time, time };
}

function memberRole(memberNumber) {
    const roles = ['hunter', 'guardian', 'collector', 'skirmisher'];
    return roles[(Math.max(1, memberNumber) - 1) % roles.length];
}

export function createController({ config, random = () => 0.5, botId = '', memberNumber = 1, options = {} }) {
    const role = memberRole(memberNumber || Number(botId.split('-').pop()) || 1);
    const aggression = Number(options.aggression) || 1;
    const teamCohesion = Number(options.teamCohesion) || 1;
    const powerupInterest = Number(options.powerupInterest) || 1;
    let wanderAngle = random() * Math.PI * 2;
    let strafeSign = random() < 0.5 ? -1 : 1;
    let decisionCounter = 0;

    return {
        id: metadata.id,

        decide(context) {
            const {
                self,
                selfStatus,
                allies,
                enemies,
                foods,
                powerups,
                ownedPowerups,
                walls,
                projectiles,
                arena,
                canFire,
                matchRemainingFrames
            } = context;

            decisionCounter += 1;
            if (decisionCounter % 150 === 0 && random() < 0.35) strafeSign *= -1;

            const movement = { x: 0, y: 0 };
            const fire = [];
            const itemForces = [];
            const healthRatio = selfStatus.health / Math.max(1, config.STARTING_POWER);
            const lowHealth = healthRatio < 0.7;
            const criticalHealth = healthRatio < 0.38;
            const incomingThreats = projectiles
                .filter(projectile => projectile.hostile && projectile.isStraightLineThreat)
                .sort((a, b) => a.timeToClosest - b.timeToClosest);

            // 1. Immediate projectile survival. Earlier impacts receive stronger lateral motion.
            for (const threat of incomingThreats.slice(0, 3)) {
                const velocityLength = Math.hypot(threat.velocity.x, threat.velocity.y) || 1;
                const left = { x: -threat.velocity.y / velocityLength, y: threat.velocity.x / velocityLength };
                const right = { x: -left.x, y: -left.y };
                const centerX = arena.centerX - self.x;
                const centerY = arena.centerY - self.y;
                const leftCenterScore = left.x * centerX + left.y * centerY;
                const dodge = leftCenterScore * strafeSign >= 0 ? left : right;
                const urgency = clamp(10 - threat.timeToClosest * 0.22, 4, 10);
                movement.x += dodge.x * urgency;
                movement.y += dodge.y * urgency;
                addNormalised(movement, self.x - threat.position.x, self.y - threat.position.y, 1.6);
            }

            // 2. Stay inside the safe rectangle before damage begins, not only after crossing it.
            const leftMargin = self.x - (arena.centerX - arena.safeHalfWidth);
            const rightMargin = (arena.centerX + arena.safeHalfWidth) - self.x;
            const topMargin = self.y - (arena.centerY - arena.safeHalfHeight);
            const bottomMargin = (arena.centerY + arena.safeHalfHeight) - self.y;
            const desiredMargin = selfStatus.radius + (arena.damageActive ? 88 : 55);
            if (leftMargin < desiredMargin) movement.x += (desiredMargin - leftMargin) * 0.12;
            if (rightMargin < desiredMargin) movement.x -= (desiredMargin - rightMargin) * 0.12;
            if (topMargin < desiredMargin) movement.y += (desiredMargin - topMargin) * 0.12;
            if (bottomMargin < desiredMargin) movement.y -= (desiredMargin - bottomMargin) * 0.12;

            // 3. Predict wall contact using current velocity and moving-wall velocity.
            for (const wall of walls) {
                if (wall.collision.entities === false) continue;
                const relativeVx = self.vx - wall.velocity.x;
                const relativeVy = self.vy - wall.velocity.y;
                const predictedX = self.x + relativeVx * 12;
                const predictedY = self.y + relativeVy * 12;
                const awayX = predictedX - wall.nearestPoint.x;
                const awayY = predictedY - wall.nearestPoint.y;
                const clearance = selfStatus.radius + (wall.motion ? 70 : 50);
                if (wall.distance < clearance) {
                    const weight = (1 - wall.distance / clearance) * (wall.motion ? 8 : 5.5);
                    addNormalised(movement, awayX, awayY, weight);
                    // Slide along the surface instead of repeatedly pushing straight into it.
                    const tangentX = -awayY;
                    const tangentY = awayX;
                    const tangentTowardCenter = tangentX * (arena.centerX - self.x) + tangentY * (arena.centerY - self.y);
                    addNormalised(movement, tangentTowardCenter >= 0 ? tangentX : -tangentX, tangentTowardCenter >= 0 ? tangentY : -tangentY, 1.8);
                }
            }

            // 4. Team formation: guardians stay near allies, hunters spread slightly, everyone avoids overlap.
            const teamCenter = centroid(allies);
            const closestAlly = nearest(allies);
            if (teamCenter) {
                const distanceToTeam = Math.hypot(teamCenter.x - self.x, teamCenter.y - self.y);
                const desiredTeamDistance = role === 'guardian' ? 105 : (role === 'hunter' ? 165 : 135);
                if (distanceToTeam > desiredTeamDistance) {
                    const cohesionWeight = (criticalHealth ? 4.6 : role === 'guardian' ? 2.5 : 1.25) * teamCohesion;
                    addNormalised(movement, teamCenter.x - self.x, teamCenter.y - self.y, cohesionWeight);
                }
            }
            if (closestAlly && closestAlly.distance < selfStatus.radius * 2.7) {
                addNormalised(movement, self.x - closestAlly.entity.x, self.y - closestAlly.entity.y, 4.2);
            }

            // 5. Powerups are ranked by declared strength, need, distance, and remaining match time.
            let selectedPowerup = null;
            let selectedPowerupUtility = -Infinity;
            for (const candidate of powerups) {
                const tags = candidate.aiTags;
                let need = 1;
                if (tags.includes('healing')) need *= criticalHealth ? 5.2 : (lowHealth ? 3.1 : 0.75);
                if (tags.includes('defense')) need *= incomingThreats.length > 0 ? 3.4 : (enemies.length > allies.length ? 2 : 1.1);
                if (tags.includes('weapon')) need *= role === 'hunter' || role === 'skirmisher' ? 2.1 : 1.35;
                if (tags.includes('movement')) need *= arena.damageActive ? 2.2 : 1.25;
                if (ownedPowerups.some(effect => effect.id === candidate.id)) need *= 0.35;
                if (matchRemainingFrames < 600 && tags.includes('healing')) need *= 0.65;
                const utility = candidate.strength * need * powerupInterest / Math.pow(Math.max(45, candidate.distance), 0.82);
                if (utility > selectedPowerupUtility) {
                    selectedPowerupUtility = utility;
                    selectedPowerup = candidate;
                }
            }

            // 6. Select a combat target with team focus, weakness, isolation, and distance scoring.
            let target = null;
            let targetScore = -Infinity;
            const allyTargetCounts = new Map();
            for (const ally of allies) {
                const targetId = ally.entity.aiState?.targetId;
                if (targetId) allyTargetCounts.set(targetId, (allyTargetCounts.get(targetId) || 0) + 1);
            }

            for (const enemy of enemies) {
                const powerRatio = selfStatus.health / Math.max(1, enemy.health);
                const nearbyEnemySupport = enemies.filter(other => other !== enemy &&
                    Math.hypot(other.entity.x - enemy.entity.x, other.entity.y - enemy.entity.y) < 150).length;
                const focusCount = allyTargetCounts.get(enemy.entity.id) || 0;
                let score = 520 / Math.max(60, enemy.distance);
                score += clamp(powerRatio, 0.2, 3) * 2.8;
                score += focusCount * 2.5;
                score -= nearbyEnemySupport * 1.2;
                if (enemy.health < selfStatus.health * 0.8) score += 3.5;
                if (enemy.health > selfStatus.health * 1.35 && allies.length < 2) score -= 5.5;
                if (role === 'hunter') score += 1.3;
                if (score > targetScore) {
                    targetScore = score;
                    target = enemy;
                }
            }

            const outnumbered = enemies.length > allies.length + 1;
            const strongerThreats = enemies.filter(enemy => enemy.health > selfStatus.health * 1.2);
            const shouldRetreat = criticalHealth || (lowHealth && strongerThreats.length > 0) || (outnumbered && role !== 'guardian');

            if (selectedPowerup && (!shouldRetreat || selectedPowerup.aiTags.includes('healing') || selectedPowerup.aiTags.includes('defense'))) {
                const weight = selectedPowerup.aiTags.includes('healing') && lowHealth ? 7.5 : 4.8;
                addNormalised(movement, selectedPowerup.position.x - self.x, selectedPowerup.position.y - self.y, weight);
            }

            if (target) {
                const targetEntity = target.entity;
                const dx = targetEntity.x - self.x;
                const dy = targetEntity.y - self.y;
                const distance = target.distance;
                const desiredDistance = role === 'guardian' ? 170 : (role === 'hunter' ? 235 : 205);

                if (shouldRetreat) {
                    addNormalised(movement, -dx, -dy, criticalHealth ? 8.8 : 6.2);
                    if (teamCenter) addNormalised(movement, teamCenter.x - self.x, teamCenter.y - self.y, 2.7);
                } else {
                    if (distance > desiredDistance + 55) {
                        addNormalised(movement, dx, dy, (role === 'hunter' ? 4.2 : 3.1) * aggression);
                    } else if (distance < desiredDistance - 65) {
                        addNormalised(movement, -dx, -dy, 3.8);
                    }
                    // Orbiting makes fire lines readable and prevents head-on deadlocks.
                    addNormalised(movement, -dy * strafeSign, dx * strafeSign, role === 'skirmisher' ? 2.8 : 1.55);
                }
            }

            // 7. Collect food when it is useful and no urgent tactical objective exists.
            if ((!selectedPowerup || selectedPowerup.distance > 250) && (!target || target.distance > 330) && foods.length > 0) {
                const food = nearest(foods);
                const foodWeight = role === 'collector' ? 2.5 : (lowHealth ? 1.9 : 0.9);
                addNormalised(movement, food.entity.x - self.x, food.entity.y - self.y, foodWeight);
                itemForces.push({
                    entity: food.entity,
                    x: (self.x - food.entity.x) / Math.max(1, food.distance) * 0.055,
                    y: (self.y - food.entity.y) / Math.max(1, food.distance) * 0.055
                });
            }

            // 8. Small deterministic wander only when the tactical vector is weak.
            if (Math.hypot(movement.x, movement.y) < 1.2) {
                wanderAngle += (random() - 0.5) * 0.18;
                movement.x += Math.cos(wanderAngle) * 0.42;
                movement.y += Math.sin(wanderAngle) * 0.42;
            }

            // 9. Predictive firing. Strong weapon effects may request a narrow three-shot burst.
            if (canFire && target && target.distance < 590 && !criticalHealth) {
                const projectileSpeed = config.WEAPON_SPEED_BASE *
                    (ownedPowerups.some(effect => effect.id === 'FOCUS') ? 1.35 : 1);
                const aim = predictedIntercept(self, target.entity, projectileSpeed);
                const hasWeaponBoost = ownedPowerups.some(effect => effect.aiTags.includes('weapon'));
                const spread = hasWeaponBoost && target.distance < 320 ? [-0.045, 0, 0.045] : [0];
                for (const angleOffset of spread) {
                    fire.push({ targetX: aim.x, targetY: aim.y, angleOffset });
                }
            }

            const mode = shouldRetreat
                ? 'retreat'
                : (selectedPowerup && selectedPowerup.distance < 320 ? 'powerup' : (target ? 'combat' : 'search'));

            return {
                movement,
                fire,
                itemForces,
                state: {
                    role,
                    mode,
                    health: selfStatus.health,
                    healthRatio,
                    targetId: target?.entity.id || null,
                    incomingThreatCount: incomingThreats.length,
                    selectedPowerupId: selectedPowerup?.id || null,
                    selectedPowerupStrength: selectedPowerup?.strength || null,
                    outnumbered
                }
            };
        }
    };
}
