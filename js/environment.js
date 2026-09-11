import { clamp } from './math.js';

function cloneWall(wall) {
    return {
        ...wall,
        angle: Number(wall.angle) || 0,
        originX: wall.x,
        originY: wall.y,
        velocityX: 0,
        velocityY: 0,
        collision: { entities: true, projectiles: true, vision: true, ...(wall.collision || {}) },
        motion: wall.motion ? { ...wall.motion } : null
    };
}

function zoneDimensions(zone) {
    const fallback = Number(zone.initialHalfSize) || 1000;
    return {
        halfWidth: Number(zone.initialHalfWidth) || fallback,
        halfHeight: Number(zone.initialHalfHeight) || fallback
    };
}

function stageDimensions(stage, currentWidth, currentHeight) {
    const fallback = Number(stage.targetHalfSize);
    return {
        halfWidth: Number(stage.targetHalfWidth) || fallback || currentWidth,
        halfHeight: Number(stage.targetHalfHeight) || fallback || currentHeight
    };
}

function approach(current, target, mode, speed) {
    if (mode === 'instant') return target;
    if (mode === 'ease') {
        const easing = clamp(speed, 0.001, 1);
        const next = current + (target - current) * easing;
        return Math.abs(next - target) < 0.05 ? target : next;
    }
    const difference = target - current;
    return Math.abs(difference) <= speed ? target : current + Math.sign(difference) * speed;
}

export class ArenaManager {
    constructor(mapModule, { options = {}, random = () => 0.5 } = {}) {
        this.mapModule = mapModule;
        this.options = options;
        this.random = random;
        this.definition = null;
        this.walls = [];
        this.safeHalfWidth = 1000;
        this.safeHalfHeight = 1000;
        this.targetSafeHalfWidth = 1000;
        this.targetSafeHalfHeight = 1000;
        this.stageIndex = -1;
        this.currentStage = null;
        this.damageActive = false;
        this.shrinkMode = 'linear';
        this.shrinkSpeed = 0.6;
        this.width = 0;
        this.height = 0;
    }

    get safeSize() {
        return Math.min(this.safeHalfWidth, this.safeHalfHeight);
    }

    get targetSafeSize() {
        return Math.min(this.targetSafeHalfWidth, this.targetSafeHalfHeight);
    }

    reset(width, height) {
        this.width = width;
        this.height = height;
        this.definition = this.mapModule.createMap({ width, height, options: this.options, random: this.random });
        if (!this.definition || !Array.isArray(this.definition.walls) || !this.definition.zone) {
            throw new Error('Map plugin createMap() must return walls[] and zone.');
        }

        this.walls = this.definition.walls.map(cloneWall);
        this.definition.zone.stages = [...(this.definition.zone.stages || [])].sort((a, b) => a.atFrame - b.atFrame);
        const initial = zoneDimensions(this.definition.zone);
        this.safeHalfWidth = initial.halfWidth;
        this.safeHalfHeight = initial.halfHeight;
        this.targetSafeHalfWidth = initial.halfWidth;
        this.targetSafeHalfHeight = initial.halfHeight;
        this.stageIndex = -1;
        this.currentStage = null;
        this.damageActive = false;
        this.shrinkMode = 'linear';
        this.shrinkSpeed = 0.6;
    }

    resize(width, height, frameCount = 0) {
        const widthProgress = this.safeHalfWidth / Math.max(this.width, 1);
        const heightProgress = this.safeHalfHeight / Math.max(this.height, 1);
        this.width = width;
        this.height = height;
        const newDefinition = this.mapModule.createMap({ width, height, options: this.options, random: this.random });
        this.definition = newDefinition;
        this.walls = newDefinition.walls.map(cloneWall);
        this.definition.zone.stages = [...(this.definition.zone.stages || [])].sort((a, b) => a.atFrame - b.atFrame);
        const initial = zoneDimensions(this.definition.zone);
        this.safeHalfWidth = Math.max(1, width * widthProgress);
        this.safeHalfHeight = Math.max(1, height * heightProgress);
        this.stageIndex = -1;
        this.currentStage = null;
        this.damageActive = false;
        this.targetSafeHalfWidth = initial.halfWidth;
        this.targetSafeHalfHeight = initial.halfHeight;
        this._activateDueStages(frameCount, false);
        this.safeHalfWidth = Math.max(this.targetSafeHalfWidth, Math.min(this.safeHalfWidth, initial.halfWidth));
        this.safeHalfHeight = Math.max(this.targetSafeHalfHeight, Math.min(this.safeHalfHeight, initial.halfHeight));
    }

    update(frameCount) {
        const events = this._activateDueStages(frameCount, true);
        this._updateZone();
        this._updateWalls(frameCount);
        return events;
    }

    _activateDueStages(frameCount, emitEvents) {
        const events = [];
        const stages = this.definition.zone.stages;
        while (this.stageIndex + 1 < stages.length && frameCount >= stages[this.stageIndex + 1].atFrame) {
            this.stageIndex += 1;
            const stage = stages[this.stageIndex];
            this.currentStage = stage;
            const target = stageDimensions(stage, this.targetSafeHalfWidth, this.targetSafeHalfHeight);
            this.targetSafeHalfWidth = target.halfWidth;
            this.targetSafeHalfHeight = target.halfHeight;
            this.shrinkMode = stage.mode || 'linear';
            this.shrinkSpeed = Number(stage.shrinkSpeed) || 0.6;
            this.damageActive = Boolean(stage.damageActive);
            if (this.shrinkMode === 'instant') {
                this.safeHalfWidth = this.targetSafeHalfWidth;
                this.safeHalfHeight = this.targetSafeHalfHeight;
            }
            if (emitEvents) events.push({ type: 'stage', stage });
        }
        return events;
    }

    _updateZone() {
        this.safeHalfWidth = approach(this.safeHalfWidth, this.targetSafeHalfWidth, this.shrinkMode, this.shrinkSpeed);
        this.safeHalfHeight = approach(this.safeHalfHeight, this.targetSafeHalfHeight, this.shrinkMode, this.shrinkSpeed);
    }

    _updateWalls(frameCount) {
        for (const wall of this.walls) {
            const previousX = wall.x;
            const previousY = wall.y;
            const motion = wall.motion;
            if (!motion) {
                wall.velocityX = 0;
                wall.velocityY = 0;
                continue;
            }

            if (motion.type === 'rotation') {
                wall.angle += Number(motion.angularSpeed) || 0;
            } else if (motion.type === 'oscillate') {
                const period = Math.max(1, Number(motion.periodFrames) || 240);
                const phase = Number(motion.phase) || 0;
                const displacement = Math.sin((frameCount / period) * Math.PI * 2 + phase) * (Number(motion.amplitude) || 0);
                if (motion.axis === 'y') wall.y = wall.originY + displacement;
                else wall.x = wall.originX + displacement;
            } else if (motion.type === 'linear') {
                wall.x += Number(motion.velocityX) || 0;
                wall.y += Number(motion.velocityY) || 0;
            }

            wall.velocityX = wall.x - previousX;
            wall.velocityY = wall.y - previousY;
        }
    }

    contains(x, y, radius = 0) {
        return (
            x >= this.centerX - this.safeHalfWidth + radius &&
            x <= this.centerX + this.safeHalfWidth - radius &&
            y >= this.centerY - this.safeHalfHeight + radius &&
            y <= this.centerY + this.safeHalfHeight - radius
        );
    }

    getBounds() {
        return {
            left: this.centerX - this.safeHalfWidth,
            right: this.centerX + this.safeHalfWidth,
            top: this.centerY - this.safeHalfHeight,
            bottom: this.centerY + this.safeHalfHeight,
            width: this.safeHalfWidth * 2,
            height: this.safeHalfHeight * 2
        };
    }

    get centerX() { return this.width / 2; }
    get centerY() { return this.height / 2; }

    getSpawnZone(teamId) {
        return this.definition.spawnZones?.[teamId] || {
            shape: 'circle',
            x: this.centerX,
            y: this.centerY,
            radius: Math.min(this.width, this.height) * 0.1
        };
    }

    getStageRewardPoints() {
        return (this.definition.stageRewardSpawns || []).map(point => ({
            x: point.normalized === false ? point.x : point.x * this.width,
            y: point.normalized === false ? point.y : point.y * this.height
        }));
    }

    getZoneDamage() {
        return this.definition.zone.damage || { intervalFrames: 30, percent: 0, base: 0 };
    }

    getMatchRules() {
        return this.definition?.match || {};
    }
}
