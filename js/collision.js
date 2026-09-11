import { clamp, distSq } from './math.js';

const EPSILON = 1e-9;

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

export function normaliseGeometry(raw, fallbackRadius = 1) {
    const geometry = raw && typeof raw === 'object' ? raw : {};
    const shape = geometry.shape || 'circle';

    if (shape === 'rect') {
        const width = Math.max(0.1, finite(geometry.width, fallbackRadius * 2));
        const height = Math.max(0.1, finite(geometry.height, fallbackRadius * 2));
        return {
            shape: 'rect',
            width,
            height,
            rotation: finite(geometry.rotation),
            boundingRadius: Math.hypot(width, height) / 2
        };
    }

    if (shape === 'regularPolygon') {
        const radius = Math.max(0.1, finite(geometry.radius, fallbackRadius));
        const sides = clamp(Math.round(finite(geometry.sides, 6)), 3, 24);
        return {
            shape: 'regularPolygon',
            radius,
            sides,
            rotation: finite(geometry.rotation),
            boundingRadius: radius
        };
    }

    const radius = Math.max(0.1, finite(geometry.radius, fallbackRadius));
    return { shape: 'circle', radius, boundingRadius: radius };
}

export function geometryBoundingRadius(raw, fallbackRadius = 1) {
    return normaliseGeometry(raw, fallbackRadius).boundingRadius;
}

function rotatePoint(x, y, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function rectPoints(x, y, width, height, rotation) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight]
    ].map(([localX, localY]) => {
        const rotated = rotatePoint(localX, localY, rotation);
        return { x: x + rotated.x, y: y + rotated.y };
    });
}

function regularPolygonPoints(x, y, radius, sides, rotation) {
    const points = [];
    for (let index = 0; index < sides; index += 1) {
        const angle = rotation + index * Math.PI * 2 / sides;
        points.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
    }
    return points;
}

export function createCollider(x, y, rawGeometry, fallbackRadius = 1) {
    const geometry = normaliseGeometry(rawGeometry, fallbackRadius);
    if (geometry.shape === 'circle') {
        return { shape: 'circle', x, y, radius: geometry.radius, boundingRadius: geometry.radius };
    }

    const points = geometry.shape === 'rect'
        ? rectPoints(x, y, geometry.width, geometry.height, geometry.rotation)
        : regularPolygonPoints(x, y, geometry.radius, geometry.sides, geometry.rotation);

    return {
        shape: 'polygon',
        sourceShape: geometry.shape,
        x,
        y,
        points,
        boundingRadius: geometry.boundingRadius
    };
}

export function createWallCollider(wall, expansion = 0, game = null) {
    const numericExpansion = Number.isFinite(expansion) ? expansion : 0;
    let expansionCache = null;
    if (game && Number.isFinite(game.frameCount)) {
        let cache = game._wallColliderCache;
        if (!cache || cache.frame !== game.frameCount) {
            cache = { frame: game.frameCount, byWall: new Map() };
            game._wallColliderCache = cache;
        }
        expansionCache = cache.byWall.get(wall);
        if (!expansionCache) {
            expansionCache = new Map();
            cache.byWall.set(wall, expansionCache);
        } else if (expansionCache.has(numericExpansion)) {
            return expansionCache.get(numericExpansion);
        }
    }

    const fallback = {
        shape: 'rect',
        width: wall.w,
        height: wall.h,
        rotation: wall.angle || 0
    };
    const supplied = game?.style?.getGeometry?.('wall', wall, game) || fallback;
    let expanded = supplied;
    if (supplied.shape === 'rect') {
        expanded = {
            ...supplied,
            width: Math.max(0.1, finite(supplied.width, wall.w) + numericExpansion * 2),
            height: Math.max(0.1, finite(supplied.height, wall.h) + numericExpansion * 2),
            rotation: finite(supplied.rotation, wall.angle || 0)
        };
    } else {
        expanded = {
            ...supplied,
            radius: Math.max(0.1, finite(supplied.radius, Math.hypot(wall.w, wall.h) / 2) + numericExpansion)
        };
    }
    const collider = createCollider(wall.x, wall.y, expanded, Math.hypot(wall.w, wall.h) / 2);
    expansionCache?.set(numericExpansion, collider);
    return collider;
}

function dot(point, axis) {
    return point.x * axis.x + point.y * axis.y;
}

function normaliseAxis(x, y) {
    const length = Math.hypot(x, y);
    if (length < EPSILON) return null;
    return { x: x / length, y: y / length };
}

function polygonAxes(points) {
    const axes = [];
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const axis = normaliseAxis(-(next.y - current.y), next.x - current.x);
        if (axis) axes.push(axis);
    }
    return axes;
}

function projectPolygon(points, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
        const projection = dot(point, axis);
        min = Math.min(min, projection);
        max = Math.max(max, projection);
    }
    return { min, max };
}

function projectCircle(circle, axis) {
    const center = circle.x * axis.x + circle.y * axis.y;
    return { min: center - circle.radius, max: center + circle.radius };
}

function closestPolygonVertex(points, x, y) {
    let closest = points[0];
    let minimumDistance = Infinity;
    for (const point of points) {
        const distance = distSq(point.x, point.y, x, y);
        if (distance < minimumDistance) {
            minimumDistance = distance;
            closest = point;
        }
    }
    return closest;
}

function intervalOverlap(first, second) {
    return Math.min(first.max, second.max) - Math.max(first.min, second.min);
}

function orientAxis(axis, first, second) {
    const centerDeltaX = second.x - first.x;
    const centerDeltaY = second.y - first.y;
    return centerDeltaX * axis.x + centerDeltaY * axis.y < 0
        ? { x: -axis.x, y: -axis.y }
        : axis;
}

function satManifold(first, second, axes) {
    let minimumOverlap = Infinity;
    let minimumAxis = null;

    for (const rawAxis of axes) {
        const axis = normaliseAxis(rawAxis.x, rawAxis.y);
        if (!axis) continue;
        const firstProjection = first.shape === 'circle'
            ? projectCircle(first, axis)
            : projectPolygon(first.points, axis);
        const secondProjection = second.shape === 'circle'
            ? projectCircle(second, axis)
            : projectPolygon(second.points, axis);
        const overlap = intervalOverlap(firstProjection, secondProjection);
        if (overlap <= 0) return null;
        if (overlap < minimumOverlap) {
            minimumOverlap = overlap;
            minimumAxis = axis;
        }
    }

    if (!minimumAxis) return null;
    const normal = orientAxis(minimumAxis, first, second);
    return { normalX: normal.x, normalY: normal.y, penetration: minimumOverlap };
}

export function getCollisionManifold(first, second) {
    const maximumDistance = first.boundingRadius + second.boundingRadius;
    if (distSq(first.x, first.y, second.x, second.y) > maximumDistance * maximumDistance) return null;

    if (first.shape === 'circle' && second.shape === 'circle') {
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.hypot(dx, dy);
        const penetration = first.radius + second.radius - distance;
        if (penetration <= 0) return null;
        if (distance < EPSILON) return { normalX: 1, normalY: 0, penetration };
        return { normalX: dx / distance, normalY: dy / distance, penetration };
    }

    const axes = [];
    if (first.shape === 'polygon') axes.push(...polygonAxes(first.points));
    if (second.shape === 'polygon') axes.push(...polygonAxes(second.points));

    if (first.shape === 'circle' && second.shape === 'polygon') {
        const vertex = closestPolygonVertex(second.points, first.x, first.y);
        const axis = normaliseAxis(vertex.x - first.x, vertex.y - first.y);
        if (axis) axes.push(axis);
    } else if (first.shape === 'polygon' && second.shape === 'circle') {
        const vertex = closestPolygonVertex(first.points, second.x, second.y);
        const axis = normaliseAxis(second.x - vertex.x, second.y - vertex.y);
        if (axis) axes.push(axis);
    }

    return satManifold(first, second, axes);
}

export function collidersIntersect(first, second) {
    return Boolean(getCollisionManifold(first, second));
}

export function resolveEntityAgainstWalls(entity, game, collisionChannel = 'entities') {
    const entityRadius = entity.radius;
    for (const wall of game.arena.walls) {
        if (wall.collision?.[collisionChannel] === false) continue;
        const wallRadius = Math.hypot(wall.w, wall.h) / 2;
        const broadRadius = entityRadius + wallRadius;
        if (distSq(entity.x, entity.y, wall.x, wall.y) > broadRadius * broadRadius) continue;
        const manifold = getCollisionManifold(entity.getCollider(game), createWallCollider(wall, 0, game));
        if (!manifold) continue;

        entity.x -= manifold.normalX * manifold.penetration;
        entity.y -= manifold.normalY * manifold.penetration;

        if (Number.isFinite(entity.vx) && Number.isFinite(entity.vy)) {
            const relativeVx = entity.vx - (wall.velocityX || 0);
            const relativeVy = entity.vy - (wall.velocityY || 0);
            const velocityTowardWall = relativeVx * manifold.normalX + relativeVy * manifold.normalY;
            if (velocityTowardWall > 0) {
                const restitution = 0.5;
                entity.vx -= (1 + restitution) * velocityTowardWall * manifold.normalX;
                entity.vy -= (1 + restitution) * velocityTowardWall * manifold.normalY;
            }
        }
    }
}

function closestPointOnSegment(pointX, pointY, first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > EPSILON
        ? clamp(((pointX - first.x) * dx + (pointY - first.y) * dy) / lengthSq, 0, 1)
        : 0;
    return { x: first.x + dx * t, y: first.y + dy * t };
}

export function wallVertices(wall, game = null) {
    if (game && Number.isFinite(game.frameCount)) {
        let cache = game._wallVerticesCache;
        if (!cache || cache.frame !== game.frameCount) {
            cache = { frame: game.frameCount, byWall: new Map() };
            game._wallVerticesCache = cache;
        }
        const cached = cache.byWall.get(wall);
        if (cached) return cached;
        const vertices = buildWallVertices(wall, game);
        cache.byWall.set(wall, vertices);
        return vertices;
    }
    return buildWallVertices(wall, game);
}

function buildWallVertices(wall, game) {
    const collider = createWallCollider(wall, 0, game);
    if (collider.shape === 'polygon') {
        return Object.freeze(collider.points.map(point => Object.freeze({ x: point.x, y: point.y })));
    }
    const points = [];
    for (let index = 0; index < 16; index += 1) {
        const angle = index * Math.PI * 2 / 16;
        points.push(Object.freeze({
            x: collider.x + Math.cos(angle) * collider.radius,
            y: collider.y + Math.sin(angle) * collider.radius
        }));
    }
    return Object.freeze(points);
}

export function closestPointOnWall(x, y, wall, game = null) {
    const collider = createWallCollider(wall, 0, game);
    if (collider.shape === 'circle') {
        const dx = x - collider.x;
        const dy = y - collider.y;
        const distance = Math.hypot(dx, dy);
        const normalX = distance > EPSILON ? dx / distance : 1;
        const normalY = distance > EPSILON ? dy / distance : 0;
        const nearestX = collider.x + normalX * collider.radius;
        const nearestY = collider.y + normalY * collider.radius;
        return { x: nearestX, y: nearestY, distanceSq: distSq(x, y, nearestX, nearestY) };
    }

    let nearest = collider.points[0];
    let minimumDistance = Infinity;
    for (let index = 0; index < collider.points.length; index += 1) {
        const candidate = closestPointOnSegment(
            x,
            y,
            collider.points[index],
            collider.points[(index + 1) % collider.points.length]
        );
        const distance = distSq(x, y, candidate.x, candidate.y);
        if (distance < minimumDistance) {
            minimumDistance = distance;
            nearest = candidate;
        }
    }
    return { x: nearest.x, y: nearest.y, distanceSq: minimumDistance };
}

function pointInsidePolygon(x, y, points) {
    let inside = false;
    for (let firstIndex = 0, secondIndex = points.length - 1; firstIndex < points.length; secondIndex = firstIndex++) {
        const first = points[firstIndex];
        const second = points[secondIndex];
        const intersects = ((first.y > y) !== (second.y > y)) &&
            x < (second.x - first.x) * (y - first.y) / ((second.y - first.y) || EPSILON) + first.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

function segmentIntersectsSegment(aX, aY, bX, bY, cX, cY, dX, dY) {
    const denominator = (dY - cY) * (bX - aX) - (dX - cX) * (bY - aY);
    if (Math.abs(denominator) < EPSILON) return false;
    const first = ((dX - cX) * (aY - cY) - (dY - cY) * (aX - cX)) / denominator;
    const second = ((bX - aX) * (aY - cY) - (bY - aY) * (aX - cX)) / denominator;
    return first >= 0 && first <= 1 && second >= 0 && second <= 1;
}

export function segmentIntersectsCollider(x1, y1, x2, y2, collider) {
    if (collider.shape === 'circle') {
        const closest = closestPointOnSegment(collider.x, collider.y, { x: x1, y: y1 }, { x: x2, y: y2 });
        return distSq(collider.x, collider.y, closest.x, closest.y) <= collider.radius ** 2;
    }
    if (pointInsidePolygon(x1, y1, collider.points) || pointInsidePolygon(x2, y2, collider.points)) return true;
    for (let index = 0; index < collider.points.length; index += 1) {
        const first = collider.points[index];
        const second = collider.points[(index + 1) % collider.points.length];
        if (segmentIntersectsSegment(x1, y1, x2, y2, first.x, first.y, second.x, second.y)) return true;
    }
    return false;
}

export function isValidEntitySpawn(x, y, radius, game) {
    if (!game.arena.contains(x, y, radius)) return false;
    if (x < radius || x > game.width - radius || y < radius || y > game.height - radius) return false;
    const collider = createCollider(x, y, { shape: 'circle', radius });
    for (const wall of game.arena.walls) {
        if (wall.collision?.entities === false) continue;
        if (getCollisionManifold(collider, createWallCollider(wall, 0, game))) return false;
    }
    return true;
}
