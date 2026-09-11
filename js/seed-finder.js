const DEFAULT_EVALUATOR_ID = 'engaging-v2';
const LEGACY_EVALUATOR_ID = 'demo-health-winner';
const TIER_ORDER = Object.freeze({ S: 5, A: 4, B: 3, C: 2, D: 1 });

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
    const scale = 10 ** digits;
    return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function tierForScore(score) {
    if (score >= 300) return 'S';
    if (score >= 190) return 'A';
    if (score >= 130) return 'B';
    if (score >= 75) return 'C';
    return 'D';
}

function tierAtLeast(tier, minimumTier) {
    return (TIER_ORDER[tier] || 0) >= (TIER_ORDER[minimumTier] || 0);
}

function teamById(snapshot) {
    return new Map(snapshot.teams.map(team => [team.id, team]));
}

function teamHealthRatio(sample, teamId, initialHealth) {
    const team = sample.teams.find(candidate => candidate.id === teamId);
    return Math.max(0, finite(team?.health)) / Math.max(1, finite(initialHealth.get(teamId), 1));
}

function activeTeamEntries(sample, initialHealth) {
    return sample.teams
        .filter(team => team.alive > 0 && team.health > 0)
        .map(team => ({
            id: team.id,
            alive: team.alive,
            health: finite(team.health),
            effectiveStrength: finite(team.effectiveStrength, team.health),
            powerupStrength: finite(team.powerupStrength),
            ratio: Math.max(0, finite(team.effectiveStrength, team.health)) / Math.max(1, finite(initialHealth.get(team.id), 1))
        }))
        .sort((first, second) => second.ratio - first.ratio || second.health - first.health || first.id.localeCompare(second.id));
}

function candidateLeader(sample, initialHealth, minimumGap = 0.05) {
    const entries = activeTeamEntries(sample, initialHealth);
    if (!entries.length) return null;
    if (entries.length === 1) return entries[0].id;
    return entries[0].ratio - entries[1].ratio >= minimumGap ? entries[0].id : null;
}

function robustLeadTimeline(samples, initialHealth, framesPerSecond) {
    const confirmationFrames = Math.max(1, Math.round(framesPerSecond * 0.75));
    let leader = null;
    let pendingLeader = null;
    let pendingSince = 0;
    const changes = [];
    const leaders = [];

    for (const sample of samples) {
        const candidate = candidateLeader(sample, initialHealth);
        if (!candidate || candidate === leader) {
            pendingLeader = null;
            pendingSince = sample.frameCount;
        } else if (candidate !== pendingLeader) {
            pendingLeader = candidate;
            pendingSince = sample.frameCount;
        } else if (sample.frameCount - pendingSince >= confirmationFrames || leader === null) {
            if (leader && leader !== candidate) {
                changes.push(Object.freeze({
                    frame: sample.frameCount,
                    from: leader,
                    to: candidate
                }));
            }
            leader = candidate;
            pendingLeader = null;
        }
        leaders.push(Object.freeze({ frame: sample.frameCount, leader }));
    }

    return Object.freeze({
        changes: Object.freeze(changes),
        leaders: Object.freeze(leaders),
        finalLeader: leader
    });
}

function competitionUncertainty(sample, initialHealth) {
    const entries = activeTeamEntries(sample, initialHealth);
    if (entries.length < 2) return 0;
    const total = entries.reduce((sum, entry) => sum + entry.ratio, 0);
    if (total <= 0) return 0;

    let entropy = 0;
    for (const entry of entries) {
        const probability = entry.ratio / total;
        if (probability > 0) entropy -= probability * Math.log(probability);
    }
    entropy /= Math.log(entries.length);
    const closeness = 1 - clamp((entries[0].ratio - entries[1].ratio) / Math.max(0.0001, entries[0].ratio), 0, 1);
    return clamp(entropy * 0.6 + closeness * 0.4, 0, 1);
}

function scoreThreshold(value, bands) {
    for (const [threshold, score] of bands) {
        if (value <= threshold) return score;
    }
    return 0;
}

function longestEventGap(events, durationFrames, interestingTypes) {
    const frames = events
        .filter(event => interestingTypes.has(event.type))
        .map(event => finite(event.frame))
        .sort((a, b) => a - b);
    if (!frames.length) return durationFrames;
    let longest = frames[0];
    for (let index = 1; index < frames.length; index += 1) {
        longest = Math.max(longest, frames[index] - frames[index - 1]);
    }
    return Math.max(longest, durationFrames - frames[frames.length - 1]);
}

function analyseWinnerTrajectory(samples, winnerTeamId, initialHealth, durationFrames) {
    let minimumHealthRatio = Infinity;
    let minimumHealthFrame = 0;
    let minimumAlive = Infinity;
    let worstDeficitFactor = 1;
    let worstDeficitFrame = 0;
    let lastPlaceFrames = 0;
    let weakestRank = 1;
    let weakestActiveTeams = 1;
    let nearExtinctionWhileLast = false;

    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        const nextFrame = samples[index + 1]?.frameCount ?? durationFrames;
        const interval = Math.max(0, nextFrame - sample.frameCount);
        const entries = activeTeamEntries(sample, initialHealth);
        const winner = entries.find(entry => entry.id === winnerTeamId);
        if (!winner) continue;

        if (winner.ratio < minimumHealthRatio) {
            minimumHealthRatio = winner.ratio;
            minimumHealthFrame = sample.frameCount;
        }
        minimumAlive = Math.min(minimumAlive, winner.alive);

        const leader = entries[0];
        const winnerRank = entries.findIndex(entry => entry.id === winnerTeamId) + 1;
        if (winnerRank > 0) {
            weakestRank = Math.max(weakestRank, winnerRank);
            weakestActiveTeams = Math.max(weakestActiveTeams, entries.length);
            if (winnerRank === entries.length && entries.length >= 2) {
                lastPlaceFrames += interval;
                if (winner.ratio <= 0.25) nearExtinctionWhileLast = true;
            }
        }

        if (leader && leader.id !== winnerTeamId && sample.frameCount >= durationFrames * 0.15) {
            const deficit = leader.ratio / Math.max(0.0001, winner.ratio);
            if (deficit > worstDeficitFactor) {
                worstDeficitFactor = deficit;
                worstDeficitFrame = sample.frameCount;
            }
        }
    }

    return Object.freeze({
        minimumHealthRatio: Number.isFinite(minimumHealthRatio) ? minimumHealthRatio : 0,
        minimumHealthFrame,
        minimumAlive: Number.isFinite(minimumAlive) ? minimumAlive : 0,
        worstDeficitFactor,
        worstDeficitFrame,
        lastPlaceFrames,
        weakestRank,
        weakestActiveTeams,
        nearExtinctionWhileLast
    });
}

function analyseDominantLoser(samples, winnerTeamId, initialHealth) {
    const states = new Map();
    let best = null;

    for (let index = 0; index < samples.length - 1; index += 1) {
        const sample = samples[index];
        const nextFrame = samples[index + 1].frameCount;
        const interval = Math.max(0, nextFrame - sample.frameCount);
        const entries = activeTeamEntries(sample, initialHealth);
        if (entries.length < 2) continue;

        const leader = entries[0];
        const runnerUp = entries[1];
        const ratio = leader.ratio / Math.max(0.0001, runnerUp.ratio);

        for (const [teamId, state] of states) {
            if (teamId !== leader.id || ratio < 2) state.currentFrames = 0;
        }

        if (leader.id === winnerTeamId || ratio < 2) continue;
        const state = states.get(leader.id) || {
            teamId: leader.id,
            currentFrames: 0,
            longestFrames: 0,
            maxRatio: 1,
            peakFrame: 0,
            latestDominantFrame: 0
        };
        state.currentFrames += interval;
        state.longestFrames = Math.max(state.longestFrames, state.currentFrames);
        if (ratio > state.maxRatio) {
            state.maxRatio = ratio;
            state.peakFrame = sample.frameCount;
        }
        state.latestDominantFrame = sample.frameCount;
        states.set(leader.id, state);
    }

    for (const state of states.values()) {
        if (!best || state.maxRatio > best.maxRatio ||
            (state.maxRatio === best.maxRatio && state.longestFrames > best.longestFrames)) {
            best = state;
        }
    }
    return best ? Object.freeze({ ...best }) : null;
}

function analyseClutch(samples, winnerTeamId, durationFrames, framesPerSecond) {
    const windowStart = Math.max(0, durationFrames - framesPerSecond * 10);
    let best = null;

    for (const sample of samples) {
        if (sample.frameCount < windowStart || sample.frameCount > durationFrames) continue;
        const winner = sample.teams.find(team => team.id === winnerTeamId);
        if (!winner || winner.alive !== 1) continue;
        const opponents = sample.teams.filter(team => team.id !== winnerTeamId && team.alive > 0);
        const opponentBots = opponents.reduce((sum, team) => sum + team.alive, 0);
        if (opponentBots < 2) continue;
        const opposingHealth = opponents.reduce((sum, team) => sum + finite(team.health), 0);
        const healthDisadvantage = opposingHealth / Math.max(0.0001, finite(winner.health));
        const candidate = {
            frame: sample.frameCount,
            secondsBeforeEnd: (durationFrames - sample.frameCount) / framesPerSecond,
            opponentBots,
            opponentTeams: opponents.length,
            winnerHealth: finite(winner.health),
            opposingHealth,
            healthDisadvantage
        };
        if (!best || candidate.opponentBots > best.opponentBots ||
            (candidate.opponentBots === best.opponentBots && candidate.healthDisadvantage > best.healthDisadvantage)) {
            best = candidate;
        }
    }
    return best ? Object.freeze(best) : null;
}

function analyseLateLeader(samples, winnerTeamId, initialHealth, durationFrames, framesPerSecond, secondsBeforeEnd) {
    const target = durationFrames - framesPerSecond * secondsBeforeEnd;
    let selected = null;
    for (const sample of samples) {
        if (sample.frameCount > target) break;
        if (activeTeamEntries(sample, initialHealth).length >= 2) selected = sample;
    }
    if (!selected) return null;
    const entries = activeTeamEntries(selected, initialHealth);
    const leader = entries[0];
    const winner = entries.find(entry => entry.id === winnerTeamId);
    return Object.freeze({
        frame: selected.frameCount,
        leaderTeamId: leader?.id || null,
        winnerRank: winner ? entries.findIndex(entry => entry.id === winnerTeamId) + 1 : entries.length + 1,
        leaderToWinnerRatio: winner ? leader.ratio / Math.max(0.0001, winner.ratio) : Infinity
    });
}

function createReasons(metrics) {
    const reasons = [];
    if (metrics.clutch?.opponentBots >= 3) {
        reasons.push(`1-vs-${metrics.clutch.opponentBots} clutch in the final 10 seconds`);
    } else if (metrics.clutch?.opponentBots === 2) {
        reasons.push('1-vs-2 clutch in the final 10 seconds');
    }
    if (metrics.finalWinnerHealthPercent <= 10) {
        reasons.push(`winner finished on only ${round(metrics.finalWinnerHealthPercent, 1)}% team health`);
    } else if (metrics.minimumWinnerHealthPercent <= 15) {
        reasons.push(`winning team survived after falling to ${round(metrics.minimumWinnerHealthPercent, 1)}% health`);
    }
    if (metrics.dominantLoser?.maxRatio >= 2) {
        reasons.push(`${metrics.dominantLoser.teamId} reached a ${round(metrics.dominantLoser.maxRatio, 1)}× lead and still lost`);
    }
    if (metrics.worstWinnerDeficitFactor >= 2) {
        reasons.push(`winner recovered from a ${round(metrics.worstWinnerDeficitFactor, 1)}× health deficit`);
    }
    if (metrics.lateLeader10?.leaderTeamId && metrics.lateLeader10.leaderTeamId !== metrics.winnerTeamId) {
        reasons.push(`${metrics.lateLeader10.leaderTeamId} led with 10 seconds remaining`);
    }
    if (metrics.leadChanges >= 3) reasons.push(`${metrics.leadChanges} confirmed lead changes`);
    if (metrics.lateUncertainty >= 0.72) reasons.push('outcome remained highly uncertain late in the match');
    if (metrics.lateDeathRatio >= 0.45) reasons.push('most eliminations happened during the final pressure phase');
    if (!reasons.length && metrics.winnerTeamId) reasons.push('resolved match with sustained combat');
    return Object.freeze(reasons.slice(0, 6));
}


function categoryScore(name, value, scoring) {
    const settings = scoring?.categories?.[name] || {};
    const multiplier = Number.isFinite(Number(settings.multiplier)) ? Number(settings.multiplier) : 1;
    const constant = Number.isFinite(Number(settings.constant)) ? Number(settings.constant) : 0;
    const bonusScale = Number.isFinite(Number(settings.bonusScale)) ? Number(settings.bonusScale) : 1;
    const bonus = value > 0 ? constant + Math.max(0, Math.sqrt(Math.abs(value)) - 1) * bonusScale : 0;
    return value * multiplier + bonus;
}

function analyseDominanceSwings(samples, initialHealth, scoring = {}) {
    const minimumDifference = Math.max(0, finite(scoring.dominanceSwingMinimumDifference, 100));
    const minimumRatio = Math.max(1, finite(scoring.dominanceSwingMinimumRatio, 1.35));
    const dominantStates = [];
    let last = null;
    for (const sample of samples) {
        const entries = activeTeamEntries(sample, initialHealth);
        if (entries.length < 2) continue;
        const first = entries[0];
        const second = entries[1];
        const difference = first.effectiveStrength - second.effectiveStrength;
        const ratio = first.effectiveStrength / Math.max(1, second.effectiveStrength);
        if (difference < minimumDifference || ratio < minimumRatio) continue;
        if (!last || last.teamId !== first.id) {
            last = { teamId: first.id, frame: sample.frameCount, difference, ratio };
            dominantStates.push(last);
        } else {
            last.difference = Math.max(last.difference, difference);
            last.ratio = Math.max(last.ratio, ratio);
        }
    }
    const swings = [];
    for (let index = 1; index < dominantStates.length; index += 1) {
        const from = dominantStates[index - 1];
        const to = dominantStates[index];
        if (from.teamId !== to.teamId) swings.push(Object.freeze({ from, to }));
    }
    return Object.freeze({ states: Object.freeze(dominantStates), swings: Object.freeze(swings) });
}

export function engagingEntertainmentEvaluator(run, options = {}) {
    const samples = run.samples || [];
    const initial = samples[0];
    const final = run.final || samples[samples.length - 1];
    if (!initial || !final) {
        return { score: 0, tier: 'D', components: {}, summary: { reasons: ['missing simulation samples'] } };
    }

    const framesPerSecond = Math.max(1, finite(options.framesPerSecond, 60));
    const scoring = options.scoring || {};
    const durationFrames = Math.max(1, finite(final.matchEndFrame ?? final.frameCount, final.frameCount));
    const durationSeconds = durationFrames / framesPerSecond;
    const winnerTeamId = final.winnerTeamId || null;
    const initialHealth = new Map(initial.teams.map(team => [team.id, Math.max(1, finite(team.health, 1))]));
    const initialTotalHealth = [...initialHealth.values()].reduce((sum, value) => sum + value, 0) || 1;
    const totalBots = Math.max(1, initial.bots.length);
    const finalTeams = teamById(final);
    const winnerFinal = winnerTeamId ? finalTeams.get(winnerTeamId) : null;
    const finalWinnerHealthRatio = winnerTeamId
        ? finite(winnerFinal?.health) / Math.max(1, finite(initialHealth.get(winnerTeamId), 1))
        : 0;

    const leadTimeline = robustLeadTimeline(samples, initialHealth, framesPerSecond);
    const dominanceSwings = analyseDominanceSwings(samples, initialHealth, scoring);
    const lateLeadChanges = leadTimeline.changes.filter(change => change.frame >= durationFrames - framesPerSecond * 20).length;
    const finalTenLeadChanges = leadTimeline.changes.filter(change => change.frame >= durationFrames - framesPerSecond * 10).length;
    const weightedLeadChanges = leadTimeline.changes.length + lateLeadChanges * 0.65 + finalTenLeadChanges * 0.85;

    const winnerTrajectory = winnerTeamId
        ? analyseWinnerTrajectory(samples, winnerTeamId, initialHealth, durationFrames)
        : null;
    const dominantLoser = winnerTeamId
        ? analyseDominantLoser(samples, winnerTeamId, initialHealth)
        : null;
    const clutch = winnerTeamId
        ? analyseClutch(samples, winnerTeamId, durationFrames, framesPerSecond)
        : null;
    const lateLeader10 = winnerTeamId
        ? analyseLateLeader(samples, winnerTeamId, initialHealth, durationFrames, framesPerSecond, 10)
        : null;
    const lateLeader5 = winnerTeamId
        ? analyseLateLeader(samples, winnerTeamId, initialHealth, durationFrames, framesPerSecond, 5)
        : null;

    const lateSamples = samples.filter(sample =>
        sample.frameCount >= Math.max(0, durationFrames - framesPerSecond * 20) &&
        sample.frameCount < durationFrames &&
        activeTeamEntries(sample, initialHealth).length >= 2
    );
    const finalTenSamples = lateSamples.filter(sample => sample.frameCount >= durationFrames - framesPerSecond * 10);
    const lateUncertainty = average(lateSamples.map(sample => competitionUncertainty(sample, initialHealth)));
    const finalTenUncertainty = average(finalTenSamples.map(sample => competitionUncertainty(sample, initialHealth)));

    const deaths = run.events.filter(event => event.type === 'bot-death');
    const powerupCollections = run.events.filter(event => event.type === 'powerup-collect').length;
    const damageEvents = run.events.filter(event => ['projectile-hit', 'melee-hit', 'zone-damage', 'shield-hit'].includes(event.type)).length;
    const lateDeaths = deaths.filter(event => event.frame >= durationFrames - framesPerSecond * 15).length;
    const lateDeathRatio = deaths.length ? lateDeaths / deaths.length : 0;
    const longestQuietFrames = longestEventGap(
        run.events,
        durationFrames,
        new Set(['projectile-hit', 'melee-hit', 'bot-death', 'powerup-collect', 'shield-hit'])
    );
    const longestQuietSeconds = longestQuietFrames / framesPerSecond;

    let winnerLeaderSamples = 0;
    let meaningfulLeaderSamples = 0;
    let winnerMarginTotal = 0;
    let winnerMarginSamples = 0;
    let healthMotion = 0;
    let movement = 0;
    let movementObservations = 0;

    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        const leader = leadTimeline.leaders[index]?.leader;
        if (leader) {
            meaningfulLeaderSamples += 1;
            if (leader === winnerTeamId) winnerLeaderSamples += 1;
        }
        const entries = activeTeamEntries(sample, initialHealth);
        if (winnerTeamId && entries.length >= 2 && entries[0].id === winnerTeamId) {
            winnerMarginTotal += (entries[0].ratio - entries[1].ratio) / Math.max(0.0001, entries[0].ratio);
            winnerMarginSamples += 1;
        }

        if (index === 0) continue;
        const previous = samples[index - 1];
        const beforeTeams = teamById(previous);
        for (const team of sample.teams) {
            healthMotion += Math.abs(finite(team.health) - finite(beforeTeams.get(team.id)?.health));
        }
        const priorBots = new Map(previous.bots.map(bot => [bot.id, bot]));
        for (const bot of sample.bots) {
            const before = priorBots.get(bot.id);
            if (!before || !bot.alive || !before.alive) continue;
            movement += Math.hypot(bot.x - before.x, bot.y - before.y);
            movementObservations += 1;
        }
    }

    const winnerLeaderShare = meaningfulLeaderSamples ? winnerLeaderSamples / meaningfulLeaderSamples : 0;
    const averageWinnerMargin = winnerMarginSamples ? winnerMarginTotal / winnerMarginSamples : 0;
    const healthVolatility = clamp(healthMotion / Math.max(1, initialTotalHealth * 3.5), 0, 1);
    const averageMovement = movementObservations ? movement / movementObservations : 0;

    const minimumWinnerHealthRatio = winnerTrajectory?.minimumHealthRatio ?? 0;
    const minimumWinnerHealthPercent = minimumWinnerHealthRatio * 100;
    const finalWinnerHealthPercent = finalWinnerHealthRatio * 100;

    const nearDeathFinish = winnerTeamId ? scoreThreshold(finalWinnerHealthPercent, [
        [5, 62], [10, 48], [20, 28], [35, 12]
    ]) : 0;
    const nearExtinctionSurvival = winnerTeamId ? scoreThreshold(minimumWinnerHealthPercent, [
        [5, 78], [10, 62], [20, 42], [30, 24], [45, 10]
    ]) : 0;
    const collectiveNearDeath = clamp(
        nearDeathFinish + nearExtinctionSurvival + (winnerTrajectory?.nearExtinctionWhileLast ? 18 : 0),
        0,
        125
    );

    let underdogComeback = 0;
    const worstDeficit = winnerTrajectory?.worstDeficitFactor || 1;
    if (worstDeficit >= 4) underdogComeback += 72;
    else if (worstDeficit >= 3) underdogComeback += 58;
    else if (worstDeficit >= 2) underdogComeback += 40;
    else if (worstDeficit >= 1.5) underdogComeback += 20;
    underdogComeback += clamp((winnerTrajectory?.lastPlaceFrames || 0) / (framesPerSecond * 12), 0, 1) * 24;
    if (winnerTrajectory?.nearExtinctionWhileLast) underdogComeback += 18;
    underdogComeback = clamp(underdogComeback, 0, 105);

    let dominantFavoriteUpset = 0;
    if (dominantLoser) {
        if (dominantLoser.maxRatio >= 3.5) dominantFavoriteUpset += 82;
        else if (dominantLoser.maxRatio >= 3) dominantFavoriteUpset += 68;
        else if (dominantLoser.maxRatio >= 2.5) dominantFavoriteUpset += 54;
        else dominantFavoriteUpset += 38;
        dominantFavoriteUpset += clamp(dominantLoser.longestFrames / (framesPerSecond * 8), 0, 1) * 18;
        dominantFavoriteUpset += clamp(dominantLoser.latestDominantFrame / durationFrames, 0, 1) * 20;
        dominantFavoriteUpset = clamp(dominantFavoriteUpset, 0, 120);
    }

    let clutchScore = 0;
    if (clutch) {
        if (clutch.opponentBots >= 4) clutchScore += 125;
        else if (clutch.opponentBots === 3) clutchScore += 105;
        else if (clutch.opponentBots === 2) clutchScore += 62;
        clutchScore += clamp((clutch.healthDisadvantage - 1) / 3, 0, 1) * 24;
        clutchScore += clamp((10 - clutch.secondsBeforeEnd) / 10, 0, 1) * 10;
        clutchScore = clamp(clutchScore, 0, 155);
    }

    const leadVolatility = clamp(weightedLeadChanges * 9, 0, 62);
    const uncertaintyScore = clamp(lateUncertainty * 42 + finalTenUncertainty * 28, 0, 68);

    let lateReversal = 0;
    if (winnerTeamId && lateLeader10?.leaderTeamId && lateLeader10.leaderTeamId !== winnerTeamId) {
        lateReversal += 34;
        lateReversal += clamp((lateLeader10.leaderToWinnerRatio - 1) / 2, 0, 1) * 24;
    }
    if (winnerTeamId && lateLeader5?.leaderTeamId && lateLeader5.leaderTeamId !== winnerTeamId) lateReversal += 28;
    lateReversal = clamp(lateReversal, 0, 78);

    const eliminationRatio = clamp(deaths.length / totalBots, 0, 1);
    const idealLateDeathRatio = clamp(1 - Math.abs(lateDeathRatio - 0.52) / 0.52, 0, 1);
    let actionArc = eliminationRatio * 16;
    actionArc += clamp(damageEvents / Math.max(18, totalBots * 4), 0, 1) * 10;
    actionArc += clamp(powerupCollections / Math.max(6, totalBots * 0.65), 0, 1) * 6;
    actionArc += idealLateDeathRatio * 14;
    actionArc += clamp(averageMovement / 170, 0, 1) * 5;
    actionArc += healthVolatility * 8;
    actionArc = clamp(actionArc, 0, 55);

    let durationScore = 0;
    if (winnerTeamId) {
        if (durationSeconds >= 48) durationScore = 20;
        else if (durationSeconds >= 38) durationScore = 15;
        else if (durationSeconds >= 28) durationScore = 8;
        else if (durationSeconds < 18) durationScore = -32;
    }

    const resolvedWinner = winnerTeamId ? 12 : -45;

    let predictabilityPenalty = 0;
    if (winnerTeamId && winnerLeaderShare >= 0.72 && leadTimeline.changes.length <= 1 && worstDeficit < 1.35) {
        predictabilityPenalty -= clamp((winnerLeaderShare - 0.72) / 0.28, 0, 1) * 45;
        predictabilityPenalty -= clamp(averageWinnerMargin / 0.55, 0, 1) * 28;
    }
    if (winnerTeamId && finalWinnerHealthPercent >= 130 && leadTimeline.changes.length === 0) predictabilityPenalty -= 18;

    let stagnationPenalty = 0;
    if (longestQuietSeconds > 9) stagnationPenalty -= clamp((longestQuietSeconds - 9) / 8, 0, 1) * 36;
    if (deaths.length < totalBots * 0.45) stagnationPenalty -= 28;
    if (damageEvents < totalBots * 1.5) stagnationPenalty -= 18;
    if (final.endedBy === 'timeout') stagnationPenalty -= 12;
    let unresolvedPenalty = 0;
    const finalSurvivingTeams = activeTeamEntries(final, initialHealth).length;
    if (finalSurvivingTeams > 1) {
        unresolvedPenalty = -200;
    }

    const dominanceSwingScore = clamp(dominanceSwings.swings.length * 34 + dominanceSwings.swings.reduce((sum, swing) => sum + clamp((swing.to.ratio - 1.35) * 18, 0, 18), 0), 0, 110);

    const components = Object.freeze({
        collectiveNearDeath: round(categoryScore('collectiveNearDeath', collectiveNearDeath, scoring)),
        underdogComeback: round(categoryScore('underdogComeback', underdogComeback, scoring)),
        clutchFinish: round(categoryScore('clutchFinish', clutchScore, scoring)),
        dominantFavoriteUpset: round(categoryScore('dominantFavoriteUpset', dominantFavoriteUpset, scoring)),
        leadVolatility: round(categoryScore('leadVolatility', leadVolatility, scoring)),
        dominanceSwings: round(categoryScore('dominanceSwings', dominanceSwingScore, scoring)),
        lateUncertainty: round(categoryScore('lateUncertainty', uncertaintyScore, scoring)),
        lateReversal: round(categoryScore('lateReversal', lateReversal, scoring)),
        actionArc: round(categoryScore('actionArc', actionArc, scoring)),
        duration: round(categoryScore('duration', durationScore, scoring)),
        resolvedWinner: round(categoryScore('resolvedWinner', resolvedWinner, scoring)),
        predictabilityPenalty: round(categoryScore('predictabilityPenalty', predictabilityPenalty, scoring)),
        stagnationPenalty: round(categoryScore('stagnationPenalty', stagnationPenalty, scoring)),
        unresolvedPenalty: round(categoryScore('unresolvedPenalty', unresolvedPenalty, scoring))
    });

    const rawScore = Object.values(components).reduce((sum, value) => sum + value, 0);
    const score = round(Math.max(0, rawScore));
    const tier = tierForScore(score);
    const metrics = {
        winnerTeamId,
        finalWinnerHealthPercent,
        minimumWinnerHealthPercent,
        winnerMinimumAliveBots: winnerTrajectory?.minimumAlive || 0,
        winnerLastPlaceSeconds: (winnerTrajectory?.lastPlaceFrames || 0) / framesPerSecond,
        worstWinnerDeficitFactor: worstDeficit,
        leadChanges: leadTimeline.changes.length,
        dominanceSwings: dominanceSwings.swings.length,
        lateLeadChanges,
        finalTenLeadChanges,
        leadChangeFrames: leadTimeline.changes.map(change => change.frame),
        lateUncertainty,
        finalTenUncertainty,
        winnerLeaderShare,
        averageWinnerMargin,
        dominantLoser,
        clutch,
        lateLeader10,
        lateLeader5,
        deaths: deaths.length,
        lateDeaths,
        lateDeathRatio,
        powerupCollections,
        damageEvents,
        longestQuietSeconds,
        durationSeconds,
        healthVolatility,
        averageMovement
    };
    const reasons = createReasons(metrics);
    const flags = Object.freeze([
        ...(finalWinnerHealthPercent <= 10 ? ['near-death-finish'] : []),
        ...(minimumWinnerHealthPercent <= 20 ? ['near-extinction-survival'] : []),
        ...(worstDeficit >= 2 ? ['major-comeback'] : []),
        ...(clutch?.opponentBots >= 3 ? ['one-vs-many-clutch'] : []),
        ...(dominantLoser?.maxRatio >= 2 ? ['favorite-collapsed'] : []),
        ...(lateLeader10?.leaderTeamId && lateLeader10.leaderTeamId !== winnerTeamId ? ['late-reversal'] : []),
        ...(leadTimeline.changes.length >= 3 ? ['volatile-lead'] : []),
        ...(dominanceSwings.swings.length >= 1 ? ['major-dominance-swing'] : []),
        ...(lateUncertainty >= 0.72 ? ['high-late-uncertainty'] : []),
        ...(predictabilityPenalty < -25 ? ['predictable-steamroll'] : []),
        ...(stagnationPenalty < -25 ? ['low-action'] : []),
        ...(finalSurvivingTeams > 1 ? ['multiple-teams-survived'] : [])
    ]);

    return Object.freeze({
        score,
        tier,
        components,
        summary: Object.freeze({
            winnerTeamId,
            endedBy: final.endedBy,
            durationFrames,
            durationSeconds: round(durationSeconds),
            tier,
            reasons,
            flags,
            finalWinnerHealthPercent: round(finalWinnerHealthPercent),
            minimumWinnerHealthPercent: round(minimumWinnerHealthPercent),
            worstWinnerDeficitFactor: round(worstDeficit),
            leadChanges: leadTimeline.changes.length,
            dominanceSwings: dominanceSwings.swings.length,
        dominanceSwings: dominanceSwings.swings.length,
            lateLeadChanges,
            lateUncertainty: round(lateUncertainty),
            finalTenUncertainty: round(finalTenUncertainty),
            deaths: deaths.length,
            lateDeaths,
            powerupCollections,
            damageEvents,
            longestQuietSeconds: round(longestQuietSeconds),
            clutch,
            dominantLoser,
            lateLeader10,
            finalTeams: final.teams
        })
    });
}

function searchStatistics(results, selected) {
    const scores = results.map(result => result.score);
    const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    for (const result of results) tiers[result.tier] = (tiers[result.tier] || 0) + 1;
    return Object.freeze({
        searched: results.length,
        selected: selected.length,
        maximumScore: round(Math.max(...scores, 0)),
        minimumScore: round(scores.length ? Math.min(...scores) : 0),
        averageScore: round(average(scores)),
        medianScore: round(median(scores)),
        tiers: Object.freeze(tiers)
    });
}


function compactSeedResult(result, includeDetails = false) {
    const summary = result.summary || {};
    const compact = {
        seed: result.seed,
        evaluatorId: result.evaluatorId,
        score: result.score,
        tier: result.tier,
        summary: includeDetails ? summary : Object.freeze({
            winnerTeamId: summary.winnerTeamId || result.final?.winnerTeamId || null,
            endedBy: summary.endedBy || result.final?.endedBy || null,
            durationFrames: summary.durationFrames || result.final?.frameCount || 0,
            finalWinnerHealthPercent: summary.finalWinnerHealthPercent,
            minimumWinnerHealthPercent: summary.minimumWinnerHealthPercent,
            worstWinnerDeficitFactor: summary.worstWinnerDeficitFactor,
            leadChanges: summary.leadChanges,
            flags: summary.flags || Object.freeze([])
        }),
        final: Object.freeze({
            frameCount: result.final?.frameCount,
            matchEndFrame: result.final?.matchEndFrame,
            winnerTeamId: result.final?.winnerTeamId,
            endedBy: result.final?.endedBy,
            teams: result.final?.teams
        })
    };
    if (includeDetails) compact.components = result.components;
    return Object.freeze(compact);
}

function insertBoundedRanking(ranking, result, limit) {
    let low = 0;
    let high = ranking.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        const current = ranking[middle];
        const before = result.score > current.score || (result.score === current.score && result.seed.localeCompare(current.seed) < 0);
        if (before) high = middle;
        else low = middle + 1;
    }
    ranking.splice(low, 0, result);
    if (ranking.length > limit) ranking.length = limit;
}

export class SeedFinder {
    constructor(adapter, defaults = {}) {
        this.adapter = adapter;
        this.defaults = Object.freeze({
            sampleEveryFrames: Math.max(1, Number(defaults.sampleEveryFrames) || 30),
            maxFrames: Math.max(1, Number(defaults.maxFrames) || 10000),
            topK: Math.max(1, Number(defaults.topK) || 10),
            minimumScore: Math.max(0, finite(defaults.minimumScore, 190)),
            minimumTier: TIER_ORDER[defaults.minimumTier] ? defaults.minimumTier : 'A',
            selectedLimit: Math.max(1, Number(defaults.selectedLimit) || Number(defaults.topK) || 10),
            framesPerSecond: Math.max(1, finite(defaults.framesPerSecond, 60)),
            scoring: defaults.scoring || {}
        });
        this.evaluators = new Map([
            [DEFAULT_EVALUATOR_ID, engagingEntertainmentEvaluator],
            [LEGACY_EVALUATOR_ID, engagingEntertainmentEvaluator]
        ]);
    }

    registerEvaluator(id, evaluator) {
        if (typeof id !== 'string' || !id || typeof evaluator !== 'function') {
            throw new TypeError('registerEvaluator(id, evaluator) requires a non-empty id and a function.');
        }
        this.evaluators.set(id, evaluator);
    }

    listEvaluators() {
        return [...this.evaluators.keys()];
    }

    async evaluateSeed(seed, options = {}) {
        const evaluatorId = options.evaluatorId || DEFAULT_EVALUATOR_ID;
        const evaluator = this.evaluators.get(evaluatorId);
        if (!evaluator) throw new Error(`Unknown seed evaluator "${evaluatorId}".`);
        const sampleEveryFrames = Math.max(1, Math.round(Number(options.sampleEveryFrames) || this.defaults.sampleEveryFrames));
        const maxFrames = Math.max(1, Math.round(Number(options.maxFrames) || this.defaults.maxFrames));
        const includeSamples = options.includeSamples === true;
        const framesPerSecond = Math.max(1, finite(options.framesPerSecond, this.defaults.framesPerSecond));

        this.adapter.prepare(String(seed));
        const samples = [this.adapter.snapshot()];
        while (this.adapter.state() === 'playing' && this.adapter.frameCount() < maxFrames) {
            this.adapter.step(Math.min(sampleEveryFrames, maxFrames - this.adapter.frameCount()));
            samples.push(this.adapter.snapshot());
            if (options.yieldEverySample) await new Promise(resolve => setTimeout(resolve, 0));
        }

        const final = this.adapter.snapshot();
        const run = Object.freeze({
            seed: String(seed),
            samples,
            final,
            events: this.adapter.events()
        });
        const evaluation = evaluator(run, { ...options, framesPerSecond, scoring: options.scoring || this.defaults.scoring }) || {};
        const score = Math.max(0, Number(evaluation.score) || 0);
        const tier = evaluation.tier || tierForScore(score);
        return Object.freeze({
            seed: String(seed),
            evaluatorId,
            score,
            tier,
            components: evaluation.components || Object.freeze({}),
            summary: evaluation.summary || Object.freeze({}),
            final,
            samples: includeSamples ? samples : undefined
        });
    }

    async search(options = {}) {
        const count = Math.max(1, Math.round(Number(options.count) || 10));
        const start = Math.max(0, Math.round(Number(options.start) || 0));
        const prefix = String(options.prefix || 'seed');
        const seeds = Array.isArray(options.seeds)
            ? options.seeds.map(String)
            : Array.from({ length: count }, (_, index) => `${prefix}-${start + index}`);
        const topK = Math.max(1, Math.round(Number(options.topK) || this.defaults.topK));
        const minimumScore = Math.max(0, finite(options.minimumScore, this.defaults.minimumScore));
        const minimumTier = TIER_ORDER[options.minimumTier] ? options.minimumTier : this.defaults.minimumTier;
        const selectedLimit = Math.max(1, Math.round(Number(options.selectedLimit) || this.defaults.selectedLimit));
        const retainAllResults = options.retainAllResults === true;
        const includeDetails = options.includeDetails === true;
        const retainedLimit = Math.max(topK, selectedLimit);
        const retained = [];
        const all = retainAllResults ? [] : null;
        const scores = [];
        const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };

        for (let index = 0; index < seeds.length; index += 1) {
            const evaluated = await this.evaluateSeed(seeds[index], options);
            const result = compactSeedResult(evaluated, includeDetails);
            scores.push(result.score);
            tiers[result.tier] = (tiers[result.tier] || 0) + 1;
            if (all) all.push(result);
            else insertBoundedRanking(retained, result, retainedLimit);

            options.onProgress?.(Object.freeze({ index: index + 1, total: seeds.length, result }));
            if (options.dispatchProgress !== false && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kinetic-seed-progress', {
                    detail: { index: index + 1, total: seeds.length, result }
                }));
            }
            if (options.yieldEverySeed) await new Promise(resolve => setTimeout(resolve, 0));
        }

        const rankedSource = all || retained;
        rankedSource.sort((first, second) => second.score - first.score || first.seed.localeCompare(second.seed));
        const ranked = rankedSource.map((result, index) => Object.freeze({
            ...result,
            rank: index + 1,
            selected: Boolean(
                result.final?.winnerTeamId &&
                result.score >= minimumScore &&
                tierAtLeast(result.tier, minimumTier)
            )
        }));
        const selected = ranked.filter(result => result.selected).slice(0, selectedLimit);
        const statistics = Object.freeze({
            searched: seeds.length,
            selected: selected.length,
            maximumScore: round(Math.max(...scores, 0)),
            minimumScore: round(scores.length ? Math.min(...scores) : 0),
            averageScore: round(average(scores)),
            medianScore: round(median(scores)),
            tiers: Object.freeze(tiers)
        });

        return Object.freeze({
            evaluatorId: options.evaluatorId || DEFAULT_EVALUATOR_ID,
            criteria: Object.freeze({ minimumScore, minimumTier, selectedLimit }),
            searched: seeds.length,
            selected: Object.freeze(selected),
            top: Object.freeze(ranked.slice(0, topK)),
            results: Object.freeze(retainAllResults ? ranked : []),
            scoreValues: Object.freeze(options.returnScores ? [...scores] : []),
            statistics
        });
    }
}
