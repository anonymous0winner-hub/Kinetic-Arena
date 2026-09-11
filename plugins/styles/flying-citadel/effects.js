function createParticles(count, data, game, token, speed, variant, lifeRange = [16, 34]) {
    const output = [];
    const random = () => game?.randomValue?.('effects') ?? 0.5;
    for (let index = 0; index < count; index += 1) {
        const angle = random() * Math.PI * 2;
        const magnitude = speed * (0.28 + random() * 0.72);
        output.push({
            x: data.x,
            y: data.y,
            vx: Math.cos(angle) * magnitude,
            vy: Math.sin(angle) * magnitude,
            colorToken: token,
            life: lifeRange[0] + random() * (lifeRange[1] - lifeRange[0]),
            radius: 1.5 + random() * 3.8,
            variant,
            rotation: angle,
            spin: (random() - 0.5) * 0.26
        });
    }
    return output;
}

export function createFlyingCitadelParticles(effectName, data, game) {
    if (effectName === 'bot-death') {
        return [
            ...createParticles(18, data, game, `team:${data.teamId}`, 8.6, 'shard', [22, 44]),
            ...createParticles(9, data, game, 'ember', 5.4, 'spark', [16, 30])
        ];
    }
    if (effectName === 'bot-hit') {
        return [
            ...createParticles(5, data, game, `team:${data.bot?.team?.id}`, 4.7, 'spark', [12, 24]),
            ...createParticles(3, data, game, 'ember', 3.8, 'spark', [10, 20])
        ];
    }
    if (effectName === 'shield-hit') return createParticles(10, data, game, 'shield', 4.2, 'arc', [18, 32]);
    if (effectName === 'zone-damage') return createParticles(8, data, game, 'danger', 4.8, 'spark', [14, 28]);
    if (effectName === 'powerup-collect') return createParticles(13, data, game, `powerup:${data.powerupId}`, 5.7, 'glyph', [20, 38]);
    if (effectName === 'projectile-wall') {
        return [
            ...createParticles(5, data, game, 'ember', 4.8, 'spark', [10, 23]),
            ...createParticles(3, data, game, `team:${data.projectile?.team?.id}`, 3.1, 'shard', [12, 26])
        ];
    }
    return [];
}
