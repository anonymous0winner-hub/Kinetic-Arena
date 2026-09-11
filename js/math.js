const WALL_TRIG_CACHE = new WeakMap();

export function distSq(x1, y1, x2, y2) {
    return (x2 - x1) ** 2 + (y2 - y1) ** 2;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function lineIntersectsLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denominator = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denominator) < 1e-9) return false;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function wallTrig(wall) {
    const angle = wall.angle || 0;
    const cached = WALL_TRIG_CACHE.get(wall);
    if (cached?.angle === angle) return cached;
    const value = { angle, cosine: Math.cos(angle), sine: Math.sin(angle) };
    WALL_TRIG_CACHE.set(wall, value);
    return value;
}

function toWallLocal(x, y, wall) {
    const dx = x - wall.x;
    const dy = y - wall.y;
    const { cosine, sine } = wallTrig(wall);
    return {
        x: dx * cosine + dy * sine,
        y: -dx * sine + dy * cosine
    };
}

function toWorldVector(x, y, wall) {
    const { cosine, sine } = wallTrig(wall);
    return {
        x: x * cosine - y * sine,
        y: x * sine + y * cosine
    };
}

function lineIntersectsCenteredRect(x1, y1, x2, y2, halfWidth, halfHeight) {
    if (Math.abs(x1) <= halfWidth && Math.abs(y1) <= halfHeight) return true;
    if (Math.abs(x2) <= halfWidth && Math.abs(y2) <= halfHeight) return true;

    return (
        lineIntersectsLine(x1, y1, x2, y2, -halfWidth, -halfHeight, halfWidth, -halfHeight) ||
        lineIntersectsLine(x1, y1, x2, y2, -halfWidth, halfHeight, halfWidth, halfHeight) ||
        lineIntersectsLine(x1, y1, x2, y2, -halfWidth, -halfHeight, -halfWidth, halfHeight) ||
        lineIntersectsLine(x1, y1, x2, y2, halfWidth, -halfHeight, halfWidth, halfHeight)
    );
}

export function lineIntersectsWall(x1, y1, x2, y2, wall) {
    if (wall.shape !== 'rect') return false;
    const localStart = toWallLocal(x1, y1, wall);
    const localEnd = toWallLocal(x2, y2, wall);
    return lineIntersectsCenteredRect(localStart.x, localStart.y, localEnd.x, localEnd.y, wall.w / 2, wall.h / 2);
}

export function checkLOS(x1, y1, x2, y2, walls) {
    const segmentMinX = Math.min(x1, x2);
    const segmentMaxX = Math.max(x1, x2);
    const segmentMinY = Math.min(y1, y2);
    const segmentMaxY = Math.max(y1, y2);
    for (const wall of walls) {
        if (wall.collision?.vision === false || wall.shape !== 'rect') continue;
        const bound = Math.hypot(wall.w, wall.h) / 2;
        if (segmentMaxX < wall.x - bound || segmentMinX > wall.x + bound ||
            segmentMaxY < wall.y - bound || segmentMinY > wall.y + bound) continue;
        if (lineIntersectsWall(x1, y1, x2, y2, wall)) return false;
    }
    return true;
}

export function circleIntersectsWall(x, y, radius, wall) {
    if (wall.shape !== 'rect') return false;
    const local = toWallLocal(x, y, wall);
    const halfWidth = wall.w / 2;
    const halfHeight = wall.h / 2;
    const closestX = clamp(local.x, -halfWidth, halfWidth);
    const closestY = clamp(local.y, -halfHeight, halfHeight);
    return distSq(local.x, local.y, closestX, closestY) <= radius ** 2;
}

function collisionNormalAndPenetration(entity, wall) {
    const local = toWallLocal(entity.x, entity.y, wall);
    const halfWidth = wall.w / 2;
    const halfHeight = wall.h / 2;
    const closestX = clamp(local.x, -halfWidth, halfWidth);
    const closestY = clamp(local.y, -halfHeight, halfHeight);
    const dx = local.x - closestX;
    const dy = local.y - closestY;
    const distanceSquared = dx * dx + dy * dy;

    let normalX;
    let normalY;
    let penetration;

    if (distanceSquared > 1e-10) {
        const distance = Math.sqrt(distanceSquared);
        normalX = dx / distance;
        normalY = dy / distance;
        penetration = entity.radius - distance;
    } else {
        // The center is inside the rectangle. Push through the nearest face.
        const distances = [
            { distance: halfWidth - local.x, x: 1, y: 0 },
            { distance: halfWidth + local.x, x: -1, y: 0 },
            { distance: halfHeight - local.y, x: 0, y: 1 },
            { distance: halfHeight + local.y, x: 0, y: -1 }
        ].sort((a, b) => a.distance - b.distance);
        normalX = distances[0].x;
        normalY = distances[0].y;
        penetration = entity.radius + distances[0].distance;
    }

    if (penetration <= 0) return null;
    const worldNormal = toWorldVector(normalX, normalY, wall);
    return { normalX: worldNormal.x, normalY: worldNormal.y, penetration };
}

export function resolveCircleAgainstWalls(entity, walls, collisionChannel = 'entities') {
    for (const wall of walls) {
        if (wall.collision?.[collisionChannel] === false) continue;
        if (!circleIntersectsWall(entity.x, entity.y, entity.radius, wall)) continue;

        const collision = collisionNormalAndPenetration(entity, wall);
        if (!collision) continue;

        entity.x += collision.normalX * collision.penetration;
        entity.y += collision.normalY * collision.penetration;

        if (Number.isFinite(entity.vx) && Number.isFinite(entity.vy)) {
            const relativeVx = entity.vx - (wall.velocityX || 0);
            const relativeVy = entity.vy - (wall.velocityY || 0);
            const normalVelocity = relativeVx * collision.normalX + relativeVy * collision.normalY;
            if (normalVelocity < 0) {
                const restitution = 0.5;
                entity.vx -= (1 + restitution) * normalVelocity * collision.normalX;
                entity.vy -= (1 + restitution) * normalVelocity * collision.normalY;
            }
        }
    }
}

export function isValidSpawn(x, y, radius, game) {
    if (!game.arena.contains(x, y, radius)) return false;
    if (x < radius || x > game.width - radius || y < radius || y > game.height - radius) return false;

    for (const wall of game.arena.walls) {
        if (wall.collision?.entities === false) continue;
        if (circleIntersectsWall(x, y, radius, wall)) return false;
    }
    return true;
}
