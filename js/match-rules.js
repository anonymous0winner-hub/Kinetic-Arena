export function resolveMatchFrameLimit(globalMatch, mapRules, targetFps) {
    const configuredLimit = Math.max(1, Math.round(globalMatch.maxFrames));
    const mapLimit = Number.isFinite(mapRules?.maxFrames)
        ? Math.round(mapRules.maxFrames)
        : (Number.isFinite(mapRules?.maxDurationSeconds)
            ? Math.round(mapRules.maxDurationSeconds * targetFps)
            : configuredLimit);
    return Math.max(1, Math.min(configuredLimit, mapLimit));
}

export function resolveTimeoutWinner(activeTeams, bots, rule = 'alive-then-power') {
    const standings = activeTeams.map((team, order) => {
        const members = bots.filter(bot => bot.team.id === team.id);
        return {
            team,
            order,
            alive: members.filter(bot => bot.alive).length,
            power: members.reduce((sum, bot) => sum + (bot.alive ? bot.power : 0), 0)
        };
    });

    standings.sort((first, second) => {
        if (rule === 'alive-then-power' && first.alive !== second.alive) {
            return second.alive - first.alive;
        }
        if (first.power !== second.power) return second.power - first.power;
        return first.order - second.order;
    });

    if (standings.length < 2) return standings[0]?.team || null;
    const first = standings[0];
    const second = standings[1];
    const tied = (rule !== 'alive-then-power' || first.alive === second.alive) &&
        Math.abs(first.power - second.power) < 0.0001;
    return tied ? null : first.team;
}
