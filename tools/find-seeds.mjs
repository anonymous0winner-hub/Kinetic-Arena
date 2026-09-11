#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStaticServer, launchAutomationBrowser } from './lib/browser-automation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIER_ORDER = Object.freeze({ S: 5, A: 4, B: 3, C: 2, D: 1 });
const EPS = 1e-9;

const DEFAULT_REEL_CONFIG = Object.freeze({
    openingEndSeconds: 3,
    selectionEndSeconds: 10,

    firstActionIdealSeconds: 0.75,
    firstActionLatestSeconds: 1.75,
    firstActionSignalThreshold: 0.075,
    openingTargetAction: 0.30,
    openingActionTolerance: 0.20,
    openingTargetEscalation: 0.10,
    openingEscalationTolerance: 0.20,
    openingMinimumActiveSliceRatio: 0.66,
    openingMaxDeaths: 0,
    openingMaxLead: 0.20,
    openingHardMaxChaos: 0.82,
    minimumHookScore: 35,

    selectionMinLead: 0.08,
    selectionIdealLead: 0.20,
    selectionMaxLead: 0.38,
    selectionMinAction: 0.22,
    selectionIdealLeaderShare: 0.64,
    selectionLeaderShareTolerance: 0.30,
    winnerAtTenIdealDeficit: 0.14,
    winnerAtTenDeficitTolerance: 0.18,

    minimumComebackDeficit: 0.15,
    idealComebackDeficit: 0.32,
    minimumComebackArcFraction: 0.16,
    idealFinalLeadDurationFraction: 0.16,
    finalLeadDurationTolerance: 0.15,
    minimumFinalLeadSamples: 2,
    nearExtinctionHealthRatio: 0.20,
    nearExtinctionAliveRatio: 0.34,
    maximumEarlyWinnerLeadShare: 0.55,
    maximumWinnerDominanceShare: 0.68,

    maximumPowerupStrengthShare: 0.48,
    powerupStrengthWeight: 0.85,
    powerupIdMultipliers: {
        OVERCHARGE: 1.35,
        AEGIS: 1.0,
        FOCUS: 0.9,
        TURBO: 0.75,
        REGEN: 0.7
    },

    maximumFinalStrengthMargin: 0.24,
    minimumLateUncertainty: 0.60,
    preferredFinalAliveTeams: 2,
    lateWindowFraction: 0.25,
    quickClutchWindowFraction: 0.10,

    minimumNarrativeScore: 235,
    minimumTier: 'A'
});

function parseArgs(argv) {
    const result = {};
    const cleaned = [];
    let ignoredContinuationTokens = 0;

    for (const token of argv) {
        if (token === '\\') {
            ignoredContinuationTokens += 1;
            continue;
        }
        if (token === '--') continue;
        cleaned.push(token);
    }

    if (ignoredContinuationTokens > 0) {
        console.warn(
            `Ignoring ${ignoredContinuationTokens} standalone "\\" argument(s). ` +
            'On Windows PowerShell use a backtick (`) for line continuation, or run the command on one line.'
        );
    }

    for (let index = 0; index < cleaned.length; index += 1) {
        const token = cleaned[index];
        if (!token.startsWith('--')) continue;
        const [key, inline] = token.slice(2).split('=', 2);
        if (!key) continue;
        if (inline !== undefined) result[key] = inline;
        else if (cleaned[index + 1] && !cleaned[index + 1].startsWith('--')) result[key] = cleaned[++index];
        else result[key] = true;
    }

    return result;
}

function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, finite(value)));
}

function safeRatio(numerator, denominator, fallback = 0) {
    return Math.abs(denominator) <= EPS ? fallback : numerator / denominator;
}

function smoothstep(min, max, value) {
    if (Math.abs(max - min) <= EPS) return value >= max ? 1 : 0;
    const t = clamp((value - min) / (max - min));
    return t * t * (3 - 2 * t);
}

function bell(value, center, radius) {
    if (radius <= EPS) return value === center ? 1 : 0;
    const d = Math.abs(value - center) / radius;
    return clamp(1 - d * d);
}

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function round(value, digits = 3) {
    const scale = 10 ** digits;
    return Math.round((finite(value) + Number.EPSILON) * scale) / scale;
}

function normalizeTier(value, fallback = 'A') {
    const tier = String(value || fallback).toUpperCase();
    return TIER_ORDER[tier] ? tier : fallback;
}

function tierAtLeast(candidate, minimum) {
    return (TIER_ORDER[candidate] || 0) >= (TIER_ORDER[minimum] || 0);
}

function get(object, paths, fallback = undefined) {
    for (const pathParts of paths) {
        let value = object;
        let valid = true;
        for (const key of pathParts) {
            if (value == null || !(key in Object(value))) {
                valid = false;
                break;
            }
            value = value[key];
        }
        if (valid && value != null) return value;
    }
    return fallback;
}

function getArray(object, paths) {
    const value = get(object, paths, []);
    return Array.isArray(value) ? value : [];
}

function sum(items, paths) {
    return items.reduce((total, item) => total + Math.max(0, finite(get(item, paths, 0))), 0);
}

function samplesOf(entry) {
    return getArray(entry, [
        ['samples'],
        ['timeline'],
        ['details', 'samples'],
        ['summary', 'samples'],
        ['evaluation', 'samples']
    ]);
}

function botsOf(sample) {
    return getArray(sample, [
        ['bots'],
        ['players'],
        ['entities', 'bots'],
        ['state', 'bots'],
        ['state', 'players'],
        ['snapshot', 'bots']
    ]);
}

function teamIdOf(value, fallback = 'unknown') {
    return String(get(value, [
        ['id'],
        ['teamId'],
        ['team', 'id'],
        ['team'],
        ['factionId'],
        ['key'],
        ['name']
    ], fallback));
}

function teamsOf(sample) {
    const direct = getArray(sample, [
        ['teams'],
        ['teamStates'],
        ['state', 'teams'],
        ['snapshot', 'teams'],
        ['metrics', 'teams']
    ]);
    if (direct.length) return direct;

    const grouped = new Map();
    for (const bot of botsOf(sample)) {
        const teamId = teamIdOf(bot);
        if (!grouped.has(teamId)) grouped.set(teamId, []);
        grouped.get(teamId).push(bot);
    }
    return [...grouped.entries()].map(([id, members]) => ({ id, members }));
}

function memberAlive(member) {
    const explicit = get(member, [['alive'], ['isAlive'], ['active']], undefined);
    if (explicit !== undefined) return Boolean(explicit);
    const dead = Boolean(get(member, [['dead'], ['destroyed'], ['eliminated']], false));
    const health = finite(get(member, [['health'], ['hp'], ['currentHealth']], 0));
    return !dead && health > 0;
}

function powerupId(value) {
    if (typeof value === 'string') return value.trim().toUpperCase();
    return String(get(value, [['id'], ['powerupId'], ['type'], ['kind'], ['name']], ''))
        .trim()
        .toUpperCase();
}

function powerupList(object) {
    return getArray(object, [
        ['powerupHistory'],
        ['collectedPowerups'],
        ['powerupsCollectedList'],
        ['activePowerups'],
        ['buffs'],
        ['stats', 'powerupHistory'],
        ['stats', 'collectedPowerups']
    ]);
}

function weightedPowerups(list, multipliers) {
    return list.reduce((total, item) => {
        const id = powerupId(item);
        const count = Math.max(0, finite(get(item, [['count'], ['stacks'], ['amount']], 1), 1));
        const explicit = get(item, [['strength'], ['value'], ['score'], ['power']], undefined);
        const strength = explicit !== undefined
            ? Math.max(0, finite(explicit))
            : Math.max(0, finite(multipliers[id], 1));
        return total + count * strength;
    }, 0);
}

function teamSnapshot(team, sample, index, reelConfig) {
    const id = teamIdOf(team, `team-${index}`);
    let members = getArray(team, [['members'], ['bots'], ['players'], ['units']]);
    if (!members.length) members = botsOf(sample).filter(bot => teamIdOf(bot) === id);

    const explicitAlive = get(team, [['aliveCount'], ['membersAlive'], ['remaining'], ['stats', 'aliveCount']], undefined);
    const explicitTotal = get(team, [['totalCount'], ['memberCount'], ['initialCount'], ['stats', 'totalCount']], undefined);
    const aliveCount = explicitAlive !== undefined
        ? Math.max(0, finite(explicitAlive))
        : members.filter(memberAlive).length;
    const totalCount = Math.max(aliveCount, explicitTotal !== undefined ? finite(explicitTotal) : members.length);

    const explicitHealth = get(team, [['health'], ['totalHealth'], ['hp'], ['stats', 'health']], undefined);
    const explicitMaxHealth = get(team, [['maxHealth'], ['totalMaxHealth'], ['maxHp'], ['stats', 'maxHealth']], undefined);
    const totalHealth = explicitHealth !== undefined
        ? Math.max(0, finite(explicitHealth))
        : sum(members, [['health'], ['hp'], ['currentHealth'], ['stats', 'health']]);
    const maxHealth = Math.max(
        totalHealth,
        explicitMaxHealth !== undefined
            ? finite(explicitMaxHealth)
            : sum(members, [['maxHealth'], ['maxHp'], ['healthMax'], ['stats', 'maxHealth']])
    );

    const damageDealt = Math.max(0, finite(get(team, [
        ['damageDealt'], ['damage'], ['stats', 'damageDealt']
    ], sum(members, [['damageDealt'], ['stats', 'damageDealt']]))));

    const powerups = Math.max(0, finite(get(team, [
        ['powerups'], ['powerupsCollected'], ['stats', 'powerupsCollected']
    ], sum(members, [['powerups'], ['powerupsCollected'], ['stats', 'powerupsCollected']]))));

    let powerupStrength = get(team, [
        ['powerupStrength'], ['powerupValue'], ['buffStrength'],
        ['stats', 'powerupStrength'], ['stats', 'powerupValue']
    ], undefined);
    if (powerupStrength === undefined) {
        const teamPowerups = powerupList(team);
        const memberPowerups = members.flatMap(powerupList);
        powerupStrength = teamPowerups.length
            ? weightedPowerups(teamPowerups, reelConfig.powerupIdMultipliers)
            : memberPowerups.length
                ? weightedPowerups(memberPowerups, reelConfig.powerupIdMultipliers)
                : powerups;
    }

    const environmentUse = Math.max(0, finite(get(team, [
        ['environmentUse'], ['tacticalEnvironmentScore'], ['stats', 'environmentUse']
    ], 0))) + sum(members, [
        ['ricochets'], ['wallDodges'], ['coverUses'], ['lineOfSightBreaks'],
        ['hazardAssists'], ['stats', 'environmentUse']
    ]);

    return {
        id,
        aliveCount,
        totalCount,
        totalHealth,
        maxHealth,
        score: Math.max(0, finite(get(team, [['score'], ['points'], ['stats', 'score']], 0))),
        damageDealt,
        powerups,
        powerupStrength: Math.max(0, finite(powerupStrength)),
        environmentUse,
        aliveRatio: safeRatio(aliveCount, totalCount, 0),
        healthRatio: safeRatio(totalHealth, maxHealth, aliveCount > 0 ? 1 : 0),
        alive: aliveCount > 0 && totalHealth > 0
    };
}

function normalizeTimeline(entry, options, reelConfig) {
    const raw = samplesOf(entry);
    const fps = Math.max(1, finite(options.framesPerSecond, 60));
    const sampleEvery = Math.max(1, finite(options.sampleEveryFrames, 30));

    const timeline = raw.map((sample, index) => {
        const explicitTime = get(sample, [
            ['timeSeconds'], ['seconds'], ['time'], ['elapsedSeconds'], ['state', 'timeSeconds']
        ], undefined);
        const frame = get(sample, [['frame'], ['frameCount'], ['state', 'frameCount']], index * sampleEvery);
        return {
            time: Math.max(0, explicitTime !== undefined ? finite(explicitTime) : finite(frame) / fps),
            teams: teamsOf(sample)
                .map((team, teamIndex) => teamSnapshot(team, sample, teamIndex, reelConfig))
                .filter(team => team.id !== 'unknown'),
            shots: Math.max(0, finite(get(sample, [['shots'], ['shotsFired'], ['metrics', 'shots'], ['metrics', 'shotsFired']], 0))),
            hits: Math.max(0, finite(get(sample, [['hits'], ['metrics', 'hits']], 0))),
            projectiles: Math.max(0, finite(get(sample, [['projectiles'], ['activeProjectiles'], ['metrics', 'projectiles']], 0)))
        };
    }).sort((a, b) => a.time - b.time);

    const initial = new Map();
    for (const sample of timeline) {
        for (const team of sample.teams) {
            if (!initial.has(team.id)) {
                initial.set(team.id, {
                    count: Math.max(team.totalCount, team.aliveCount),
                    health: Math.max(team.maxHealth, team.totalHealth)
                });
            }
        }
    }

    for (const sample of timeline) {
        for (const team of sample.teams) {
            const baseline = initial.get(team.id);
            team.totalCount = Math.max(team.totalCount, baseline?.count || 0);
            team.maxHealth = Math.max(team.maxHealth, baseline?.health || 0);
            team.aliveRatio = safeRatio(team.aliveCount, team.totalCount, 0);
            team.healthRatio = safeRatio(team.totalHealth, team.maxHealth, team.alive ? 1 : 0);
            team.alive = team.aliveCount > 0 && team.totalHealth > 0;
        }
    }
    return timeline;
}

function rankedTeams(sample) {
    if (!sample?.teams?.length) return [];
    const maximumScore = Math.max(...sample.teams.map(team => team.score), 0);
    return sample.teams.map(team => ({
        ...team,
        strength: team.alive
            ? 0.52 * clamp(team.healthRatio) +
              0.36 * clamp(team.aliveRatio) +
              0.12 * clamp(maximumScore > 0 ? team.score / maximumScore : 0)
            : 0
    })).sort((a, b) =>
        b.strength - a.strength ||
        b.aliveCount - a.aliveCount ||
        b.totalHealth - a.totalHealth ||
        a.id.localeCompare(b.id)
    );
}

function lead(sample) {
    const ranked = rankedTeams(sample);
    return {
        leaderId: ranked[0]?.id || null,
        margin: ranked[1] ? clamp(ranked[0].strength - ranked[1].strength) : ranked.length ? 1 : 0,
        ranked
    };
}

function windowOf(timeline, start, end) {
    return timeline.filter(sample => sample.time >= start && sample.time <= end);
}

function nearest(timeline, time) {
    return timeline.reduce((best, sample) =>
        !best || Math.abs(sample.time - time) < Math.abs(best.time - time) ? sample : best, null);
}

function aliveTeams(sample) {
    return sample?.teams?.filter(team => team.alive) || [];
}

function totalAlive(sample) {
    return sample?.teams?.reduce((total, team) => total + team.aliveCount, 0) || 0;
}

function totalHealthRatio(sample) {
    const health = sample?.teams?.reduce((total, team) => total + team.totalHealth, 0) || 0;
    const maximum = sample?.teams?.reduce((total, team) => total + team.maxHealth, 0) || 0;
    return safeRatio(health, maximum, 0);
}

function metricTotal(sample, key) {
    return sample?.teams?.reduce((total, team) => total + finite(team[key]), 0) || 0;
}

function actionLevel(samples) {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples.at(-1);
    const seconds = Math.max(0.25, last.time - first.time);
    const initialAlive = Math.max(1, totalAlive(first));
    const healthLoss = clamp(totalHealthRatio(first) - totalHealthRatio(last));
    const deathRatio = Math.max(0, totalAlive(first) - totalAlive(last)) / initialAlive;
    const shots = Math.max(0, last.shots - first.shots);
    const hits = Math.max(0, last.hits - first.hits);
    const damage = Math.max(0, metricTotal(last, 'damageDealt') - metricTotal(first, 'damageDealt'));
    const projectiles = mean(samples.map(sample => sample.projectiles));

    const physical = clamp((healthLoss * 2.6 + deathRatio * 1.7) / seconds * 3);
    const events = clamp((shots * 0.018 + hits * 0.05 + damage * 0.0015) / seconds);
    const visual = clamp(projectiles / Math.max(6, initialAlive * 2.5));
    return clamp(0.62 * physical + 0.25 * events + 0.13 * visual);
}

function actionSignal(previous, current) {
    const seconds = Math.max(0.1, current.time - previous.time);
    const alive = Math.max(1, totalAlive(previous));
    const healthLoss = clamp(totalHealthRatio(previous) - totalHealthRatio(current));
    const deaths = Math.max(0, totalAlive(previous) - totalAlive(current));
    const shots = Math.max(0, current.shots - previous.shots);
    const hits = Math.max(0, current.hits - previous.hits);
    const damage = Math.max(0, metricTotal(current, 'damageDealt') - metricTotal(previous, 'damageDealt'));
    const projectilePresence = clamp(Math.max(previous.projectiles, current.projectiles) / Math.max(6, alive * 2.25));
    return clamp(
        healthLoss * 2.4 / seconds +
        (deaths / alive) * 1.6 / seconds +
        shots * 0.012 / seconds +
        hits * 0.035 / seconds +
        damage * 0.001 / seconds +
        projectilePresence * 0.24
    );
}

function firstActionTime(samples, threshold) {
    for (let index = 1; index < samples.length; index += 1) {
        if (actionSignal(samples[index - 1], samples[index]) >= threshold) return samples[index].time;
    }
    return Infinity;
}

function activeSliceRatio(timeline, start, end, slices) {
    const width = (end - start) / slices;
    let active = 0;
    for (let index = 0; index < slices; index += 1) {
        if (actionLevel(windowOf(timeline, start + index * width, start + (index + 1) * width)) >= 0.065) {
            active += 1;
        }
    }
    return active / slices;
}

function burstChaos(samples) {
    if (samples.length < 3) return 0;
    const lossRates = [];
    const deathRates = [];
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const seconds = Math.max(0.1, current.time - previous.time);
        lossRates.push(clamp(totalHealthRatio(previous) - totalHealthRatio(current)) / seconds);
        deathRates.push(Math.max(0, totalAlive(previous) - totalAlive(current)) / seconds);
    }
    return clamp(
        0.65 * clamp(standardDeviation(lossRates) * 4.5 + Math.max(...lossRates, 0) * 1.8) +
        0.35 * clamp(standardDeviation(deathRates) * 1.5 + Math.max(...deathRates, 0) * 0.7)
    );
}

function strength(sample, teamId) {
    return rankedTeams(sample).find(team => team.id === teamId)?.strength || 0;
}

function rankOf(sample, teamId) {
    const ranked = rankedTeams(sample);
    const index = ranked.findIndex(team => team.id === teamId);
    return index < 0 ? ranked.length + 1 : index + 1;
}

function winnerDeficit(sample, winnerId) {
    const opponent = rankedTeams(sample).find(team => team.id !== winnerId && team.alive)?.strength || 0;
    return clamp(opponent - strength(sample, winnerId));
}

function leaderChanges(samples) {
    let previous = null;
    let changes = 0;
    for (const sample of samples) {
        const current = lead(sample).leaderId;
        if (previous && current && current !== previous) changes += 1;
        if (current) previous = current;
    }
    return changes;
}

function winnerMomentumTurns(samples, winnerId) {
    const values = samples.map(sample => strength(sample, winnerId));
    let previousSign = 0;
    let turns = 0;
    for (let index = 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        const sign = Math.abs(delta) < 0.015 ? 0 : Math.sign(delta);
        if (sign && previousSign && sign !== previousSign) turns += 1;
        if (sign) previousSign = sign;
    }
    return turns;
}

function deepestComebackPoint(samples, winnerId) {
    let result = null;
    for (const sample of samples) {
        const deficit = winnerDeficit(sample, winnerId);
        const rank = rankOf(sample, winnerId);
        if (!result || deficit > result.deficit || (deficit === result.deficit && rank > result.rank)) {
            result = { sample, time: sample.time, deficit, rank };
        }
    }
    return result;
}

function finalLeadStart(samples, winnerId) {
    if (!samples.length || lead(samples.at(-1)).leaderId !== winnerId) {
        return { time: samples.at(-1)?.time || 0, samples: 0 };
    }
    let startIndex = samples.length - 1;
    let interruptionAllowance = 1;
    for (let index = samples.length - 2; index >= 0; index -= 1) {
        if (lead(samples[index]).leaderId === winnerId) {
            startIndex = index;
        } else if (
            interruptionAllowance > 0 &&
            index > 0 &&
            lead(samples[index - 1]).leaderId === winnerId
        ) {
            interruptionAllowance -= 1;
            startIndex = index;
        } else {
            break;
        }
    }
    return { time: samples[startIndex].time, samples: samples.length - startIndex };
}

function lateUncertainty(timeline, reelConfig) {
    const end = timeline.at(-1)?.time || 0;
    const samples = timeline.filter(sample => sample.time >= end * (1 - reelConfig.lateWindowFraction));
    if (!samples.length) return 0;
    const closeness = mean(samples.map(sample => 1 - smoothstep(0.10, 0.38, lead(sample).margin)));
    return clamp(0.72 * closeness + 0.28 * clamp(leaderChanges(samples) / 2));
}

function teamMetricShare(sample, teamId, key) {
    const total = sample?.teams?.reduce((sumValue, team) => sumValue + Math.max(0, finite(team[key])), 0) || 0;
    const target = sample?.teams?.find(team => team.id === teamId);
    return safeRatio(Math.max(0, finite(target?.[key])), total, 0);
}

function leadShare(samples, teamId) {
    return samples.length
        ? mean(samples.map(sample => lead(sample).leaderId === teamId ? 1 : 0))
        : 0;
}

function environmentMerit(finalSample, winnerId) {
    const total = metricTotal(finalSample, 'environmentUse');
    if (total <= 0) return { score: 0.5, available: false, share: 0 };
    const share = teamMetricShare(finalSample, winnerId, 'environmentUse');
    return { score: clamp(0.45 + bell(share, 0.38, 0.34) * 0.55), available: true, share };
}

function evaluateReel(entry, options, reelConfig) {
    const timeline = normalizeTimeline(entry, options, reelConfig);
    const winnerId = String(entry.final?.winnerTeamId || entry.summary?.winnerTeamId || entry.winnerTeamId || '');
    if (!timeline.length || !winnerId) {
        return { score: 0, tier: 'D', hardReject: true, reasons: ['Missing timeline samples or winnerTeamId.'], diagnostics: {} };
    }

    const endTime = timeline.at(-1).time;
    const sampleStep = timeline.length > 1
        ? Math.max(0.05, median(timeline.slice(1).map((sample, index) => sample.time - timeline[index].time)))
        : 0.5;
    const postHookDuration = Math.max(sampleStep, endTime - reelConfig.selectionEndSeconds);
    const opening = windowOf(timeline, 0, reelConfig.openingEndSeconds);
    const openingFirst = windowOf(timeline, 0, reelConfig.openingEndSeconds / 2);
    const openingSecond = windowOf(timeline, reelConfig.openingEndSeconds / 2, reelConfig.openingEndSeconds);
    const selection = windowOf(timeline, reelConfig.openingEndSeconds, reelConfig.selectionEndSeconds);
    const story = windowOf(timeline, reelConfig.selectionEndSeconds, endTime);
    const storyTimeline = story.length ? story : timeline;
    const atThree = nearest(timeline, reelConfig.openingEndSeconds);
    const atTen = nearest(timeline, reelConfig.selectionEndSeconds);
    const finalSample = timeline.at(-1);
    const initialTeams = aliveTeams(timeline[0]).length;

    const openingAction = actionLevel(opening);
    const openingChaos = burstChaos(opening);
    const firstAction = firstActionTime(opening, reelConfig.firstActionSignalThreshold);
    const openingDeaths = Math.max(0, totalAlive(opening[0]) - totalAlive(opening.at(-1)));
    const activeSlices = activeSliceRatio(timeline, 0, reelConfig.openingEndSeconds, 3);
    const escalation = actionLevel(openingSecond) - actionLevel(openingFirst);
    const firstActionScore = Number.isFinite(firstAction)
        ? firstAction <= reelConfig.firstActionIdealSeconds
            ? 0.82 + 0.18 * smoothstep(0, reelConfig.firstActionIdealSeconds, firstAction)
            : 1 - smoothstep(reelConfig.firstActionIdealSeconds, reelConfig.firstActionLatestSeconds, firstAction)
        : 0;

    const hookScore = 60 * (
        0.22 * firstActionScore +
        0.25 * bell(openingAction, reelConfig.openingTargetAction, reelConfig.openingActionTolerance) +
        0.18 * (1 - smoothstep(0.34, reelConfig.openingHardMaxChaos, openingChaos)) +
        0.14 * smoothstep(reelConfig.openingMinimumActiveSliceRatio / 2, reelConfig.openingMinimumActiveSliceRatio, activeSlices) +
        0.10 * bell(escalation, reelConfig.openingTargetEscalation, reelConfig.openingEscalationTolerance) +
        0.07 * (1 - smoothstep(reelConfig.openingMaxLead * 0.55, reelConfig.openingMaxLead, lead(atThree).margin)) +
        0.04 * (openingDeaths <= reelConfig.openingMaxDeaths ? 1 : clamp(1 - openingDeaths * 0.55))
    );

    const selectionLead = lead(atTen).margin;
    const preferredTeam = lead(atTen).leaderId;
    const preferredShare = leadShare(selection, preferredTeam);
    const selectionLeadScore = selectionLead < reelConfig.selectionMinLead
        ? smoothstep(0, reelConfig.selectionMinLead, selectionLead)
        : selectionLead > reelConfig.selectionMaxLead
            ? 1 - smoothstep(reelConfig.selectionMaxLead, 0.65, selectionLead)
            : bell(selectionLead, reelConfig.selectionIdealLead, reelConfig.selectionMaxLead - reelConfig.selectionIdealLead);
    const aliveAtTen = aliveTeams(atTen).length;
    const winnerRankAtTen = rankOf(atTen, winnerId);
    const winnerDeficitAtTen = winnerDeficit(atTen, winnerId);
    const underdogAtTenScore = winnerRankAtTen > 1
        ? clamp(
            0.55 * bell(winnerDeficitAtTen, reelConfig.winnerAtTenIdealDeficit, reelConfig.winnerAtTenDeficitTolerance) +
            0.45 * smoothstep(1, Math.max(2, aliveAtTen), winnerRankAtTen)
        )
        : 0.40;

    const selectionScore = 52 * (
        0.30 * selectionLeadScore +
        0.22 * smoothstep(reelConfig.selectionMinAction * 0.60, reelConfig.selectionMinAction * 1.45, actionLevel(selection)) +
        0.18 * bell(preferredShare, reelConfig.selectionIdealLeaderShare, reelConfig.selectionLeaderShareTolerance) +
        0.14 * (aliveAtTen === initialTeams ? 1 : clamp(1 - (initialTeams - aliveAtTen) * 0.45)) +
        0.12 * underdogAtTenScore +
        0.04 * clamp(Math.max(0, totalAlive(selection[0]) - totalAlive(selection.at(-1))) / Math.max(1, totalAlive(selection[0])) * 2.5)
    );

    const comeback = deepestComebackPoint(storyTimeline, winnerId);
    const finalLead = finalLeadStart(storyTimeline, winnerId);
    const comebackDeficit = comeback?.deficit || 0;
    const comebackRank = comeback?.rank || 1;
    const aliveAtComeback = Math.max(1, aliveTeams(comeback?.sample).length);
    const comebackArcFraction = safeRatio(Math.max(0, finalLead.time - (comeback?.time || finalLead.time)), postHookDuration, 0);
    const finalLeadDurationFraction = safeRatio(endTime - finalLead.time, postHookDuration, 0);
    const finalTakeoverScore = finalLead.samples >= reelConfig.minimumFinalLeadSamples
        ? bell(finalLeadDurationFraction, reelConfig.idealFinalLeadDurationFraction, reelConfig.finalLeadDurationTolerance)
        : 0;

    const comebackScore = 62 * (
        0.42 * (comebackDeficit < reelConfig.minimumComebackDeficit
            ? smoothstep(0, reelConfig.minimumComebackDeficit, comebackDeficit)
            : bell(comebackDeficit, reelConfig.idealComebackDeficit, 0.33)) +
        0.20 * (comebackRank >= aliveAtComeback ? 1 : smoothstep(1, Math.max(2, aliveAtComeback), comebackRank)) +
        0.20 * smoothstep(reelConfig.minimumComebackArcFraction / 2, reelConfig.minimumComebackArcFraction, comebackArcFraction) +
        0.18 * finalTakeoverScore
    );

    const changes = leaderChanges(storyTimeline);
    const momentumTurns = winnerMomentumTurns(storyTimeline, winnerId);
    const winnerRanks = storyTimeline.map(sample => rankOf(sample, winnerId));
    const rankSpan = winnerRanks.length ? Math.max(...winnerRanks) - Math.min(...winnerRanks) : 0;
    const rollerScore = 42 * (
        0.46 * smoothstep(1, 4, changes) +
        0.34 * smoothstep(1, 5, momentumTurns) +
        0.20 * smoothstep(1, Math.max(2, initialTeams - 1), rankSpan)
    );

    const nearTeams = new Set();
    let winnerNearExtinction = false;
    let winnerWorstHealth = 1;
    for (const sample of storyTimeline) {
        for (const team of sample.teams) {
            if (!team.alive) continue;
            if (
                team.aliveCount <= 1 ||
                team.aliveRatio <= reelConfig.nearExtinctionAliveRatio ||
                team.healthRatio <= reelConfig.nearExtinctionHealthRatio
            ) {
                nearTeams.add(team.id);
                if (team.id === winnerId) {
                    winnerNearExtinction = true;
                    winnerWorstHealth = Math.min(winnerWorstHealth, team.healthRatio);
                }
            }
        }
    }
    const nearScore = 42 * (
        0.48 * smoothstep(0, 2, nearTeams.size) +
        0.34 * (winnerNearExtinction ? 1 : 0) +
        0.18 * (winnerNearExtinction
            ? 1 - smoothstep(reelConfig.nearExtinctionHealthRatio * 0.30, reelConfig.nearExtinctionHealthRatio, winnerWorstHealth)
            : 0)
    );

    const finalAlive = aliveTeams(finalSample).length;
    const exactTwo = finalAlive === reelConfig.preferredFinalAliveTeams;
    const finalRanked = rankedTeams(finalSample);
    const declaredWinner = finalRanked.find(team => team.id === winnerId);
    const runnerUp = finalRanked.find(team => team.id !== winnerId && team.alive);
    const finalLeaderId = finalRanked[0]?.id || null;
    const finalMargin = declaredWinner && runnerUp ? clamp(declaredWinner.strength - runnerUp.strength) : 1;
    const uncertainty = lateUncertainty(timeline, reelConfig);
    const endingScore = 62 * (
        0.34 * (exactTwo ? 1 : 0) +
        0.28 * uncertainty +
        0.20 * (1 - smoothstep(reelConfig.maximumFinalStrengthMargin * 0.55, reelConfig.maximumFinalStrengthMargin, finalMargin)) +
        0.12 * finalTakeoverScore +
        0.06 * (finalLeaderId === winnerId ? 1 : 0)
    );

    const earlyLeadShare = leadShare(timeline.filter(sample => sample.time <= reelConfig.selectionEndSeconds), winnerId);
    const overallLeadShare = leadShare(timeline, winnerId);
    const powerupShare = teamMetricShare(finalSample, winnerId, 'powerups');
    const powerupStrengthShare = teamMetricShare(finalSample, winnerId, 'powerupStrength');
    const powerupReliance = clamp(
        (1 - reelConfig.powerupStrengthWeight) * powerupShare +
        reelConfig.powerupStrengthWeight * powerupStrengthShare
    );
    const damageShare = teamMetricShare(finalSample, winnerId, 'damageDealt');
    const environment = environmentMerit(finalSample, winnerId);
    const meritScore = 34 * (
        0.32 * (1 - smoothstep(reelConfig.maximumPowerupStrengthShare * 0.75, reelConfig.maximumPowerupStrengthShare, powerupReliance)) +
        0.20 * (1 - smoothstep(0.58, 0.84, damageShare)) +
        0.28 * environment.score +
        0.20 * (1 - smoothstep(reelConfig.maximumWinnerDominanceShare * 0.78, reelConfig.maximumWinnerDominanceShare, overallLeadShare))
    );

    const winnerAtComeback = comeback?.sample?.teams?.find(team => team.id === winnerId);
    const opponentsAtComeback = aliveTeams(comeback?.sample)
        .filter(team => team.id !== winnerId)
        .reduce((total, team) => total + team.aliveCount, 0);
    const quickClutch = clamp(
        (winnerAtComeback?.aliveCount === 1 && opponentsAtComeback >= 2 &&
            safeRatio(endTime - (comeback?.time || endTime), postHookDuration) <= reelConfig.quickClutchWindowFraction ? 0.70 : 0) +
        (comebackDeficit >= 0.30 && comebackArcFraction <= reelConfig.quickClutchWindowFraction ? 0.42 : 0) +
        (finalLead.samples < reelConfig.minimumFinalLeadSamples ||
            finalLeadDurationFraction <= reelConfig.quickClutchWindowFraction * 0.55 ? 0.30 : 0)
    );

    const penalties =
        74 * quickClutch +
        44 * smoothstep(reelConfig.maximumEarlyWinnerLeadShare * 0.72, reelConfig.maximumEarlyWinnerLeadShare, earlyLeadShare) +
        42 * smoothstep(reelConfig.maximumPowerupStrengthShare * 0.82, reelConfig.maximumPowerupStrengthShare + 0.18, powerupReliance) +
        56 * smoothstep(reelConfig.maximumFinalStrengthMargin, 0.62, finalMargin) +
        84 * (exactTwo ? 0 : finalAlive <= 1 ? 1 : 0.58) +
        38 * (1 - smoothstep(reelConfig.minimumLateUncertainty * 0.66, reelConfig.minimumLateUncertainty, uncertainty)) +
        52 * (1 - smoothstep(reelConfig.minimumHookScore * 0.70, reelConfig.minimumHookScore, hookScore)) +
        30 * smoothstep(
            reelConfig.idealFinalLeadDurationFraction + reelConfig.finalLeadDurationTolerance,
            0.62,
            finalLeadDurationFraction
        );

    const score = Math.max(0, hookScore + selectionScore + comebackScore + rollerScore + nearScore + endingScore + meritScore - penalties);
    const rejects = [];
    if (!exactTwo) rejects.push(`ended with ${finalAlive} living teams instead of exactly 2`);
    if (!Number.isFinite(firstAction) || firstAction > reelConfig.firstActionLatestSeconds) rejects.push('reel hook begins too late');
    if (hookScore < reelConfig.minimumHookScore) rejects.push('first three seconds are too weak');
    if (openingChaos > reelConfig.openingHardMaxChaos) rejects.push('opening is unreadably chaotic');
    if (openingDeaths > reelConfig.openingMaxDeaths + 1) rejects.push('opening contains an early casualty burst');
    if (comebackDeficit < reelConfig.minimumComebackDeficit * 0.55) rejects.push('winner was never meaningfully disadvantaged');
    if (quickClutch >= 0.70) rejects.push('result depends on a fast lone-player clutch');
    if (powerupReliance > reelConfig.maximumPowerupStrengthShare + 0.15) rejects.push('winner relied too heavily on powerups');
    if (uncertainty < reelConfig.minimumLateUncertainty * 0.55) rejects.push('winner became obvious too early');
    if (finalLeaderId !== winnerId) rejects.push('declared winner does not visibly lead at the end');
    if (finalLead.samples < reelConfig.minimumFinalLeadSamples) rejects.push('final takeover is too brief to read');

    const hardReject = rejects.length > 0;
    const tier = hardReject
        ? score >= 215 ? 'B' : score >= 165 ? 'C' : 'D'
        : score >= 290 ? 'S' : score >= 235 ? 'A' : score >= 185 ? 'B' : score >= 135 ? 'C' : 'D';

    return {
        score,
        tier,
        hardReject,
        components: {
            hook: round(hookScore),
            audienceSelection: round(selectionScore),
            comeback: round(comebackScore),
            rollerCoaster: round(rollerScore),
            nearExtinction: round(nearScore),
            ending: round(endingScore),
            merit: round(meritScore),
            penalties: round(penalties)
        },
        diagnostics: {
            firstActionSeconds: Number.isFinite(firstAction) ? round(firstAction) : null,
            hookScore: round(hookScore),
            openingAction: round(openingAction),
            openingChaos: round(openingChaos),
            activeOpeningSlices: round(activeSlices),
            openingDeaths,
            preferredTeamAtTen: preferredTeam,
            selectionLead: round(selectionLead),
            selectionLeaderShare: round(preferredShare),
            winnerRankAtTen,
            winnerDeficitAtTen: round(winnerDeficitAtTen),
            comebackDeficit: round(comebackDeficit),
            comebackRank,
            comebackArcFraction: round(comebackArcFraction),
            finalLeadDurationFraction: round(finalLeadDurationFraction),
            leaderChanges: changes,
            winnerMomentumTurns: momentumTurns,
            winnerRankSpan: rankSpan,
            nearExtinctionTeams: nearTeams.size,
            winnerNearExtinction,
            lateUncertainty: round(uncertainty),
            finalAliveTeams: finalAlive,
            finalMargin: round(finalMargin),
            winnerPowerupReliance: round(powerupReliance),
            winnerLeadShare: round(overallLeadShare),
            quickClutchPenalty: round(quickClutch)
        },
        reasons: [
            `hook ${round(hookScore, 1)}/60; first action ${Number.isFinite(firstAction) ? `${round(firstAction, 2)}s` : 'missing'}; chaos ${round(openingChaos)}`,
            `3-10s leader ${preferredTeam || 'none'}; lead ${round(selectionLead * 100, 1)}%; phase control ${round(preferredShare * 100, 1)}%`,
            `winner at 10s rank ${winnerRankAtTen}/${aliveAtTen}; deficit ${round(winnerDeficitAtTen * 100, 1)}%`,
            `comeback deficit ${round(comebackDeficit * 100, 1)}%; rank ${comebackRank}; recovery arc ${round(comebackArcFraction * 100, 1)}%`,
            `${changes} lead changes; ${momentumTurns} winner momentum turns; rank span ${rankSpan}`,
            `${nearTeams.size} near-extinction teams; winnerNearExtinction=${winnerNearExtinction}`,
            `late uncertainty ${round(uncertainty)}; final margin ${round(finalMargin)}; final teams ${finalAlive}`,
            `winner powerup reliance ${round(powerupReliance)}; lead share ${round(overallLeadShare)}`,
            ...(environment.available
                ? [`environment-use share ${round(environment.share)}`]
                : ['environment telemetry unavailable; treated as neutral']),
            ...rejects.map(reason => `reject: ${reason}`)
        ]
    };
}

function stripSamples(entry) {
    const { samples, timeline, evaluation, ...rest } = entry;
    return {
        ...rest,
        ...(entry.details && typeof entry.details === 'object'
            ? { details: Object.fromEntries(Object.entries(entry.details).filter(([key]) => !['samples', 'timeline'].includes(key))) }
            : {}),
        ...(entry.summary && typeof entry.summary === 'object'
            ? { summary: Object.fromEntries(Object.entries(entry.summary).filter(([key]) => !['samples', 'timeline'].includes(key))) }
            : {})
    };
}

function makeBatches(seeds, batchSize) {
    const batches = [];
    for (let index = 0; index < seeds.length; index += batchSize) batches.push(seeds.slice(index, index + batchSize));
    return batches;
}

function reelConfigFrom(gameConfig, args) {
    const finder = gameConfig.seedFinder || {};
    const configured = finder.narrative || {};
    const legacyScoring = finder.scoring || {};
    return {
        ...DEFAULT_REEL_CONFIG,
        ...configured,
        powerupStrengthWeight: finite(
            configured.powerupStrengthWeight,
            finite(legacyScoring.powerupStrengthWeight, DEFAULT_REEL_CONFIG.powerupStrengthWeight)
        ),
        powerupIdMultipliers: {
            ...DEFAULT_REEL_CONFIG.powerupIdMultipliers,
            ...(legacyScoring.powerupIdMultipliers || {}),
            ...(configured.powerupIdMultipliers || {})
        },
        openingEndSeconds: finite(args['opening-end'], configured.openingEndSeconds ?? DEFAULT_REEL_CONFIG.openingEndSeconds),
        selectionEndSeconds: finite(args['selection-end'], configured.selectionEndSeconds ?? DEFAULT_REEL_CONFIG.selectionEndSeconds),
        minimumNarrativeScore: finite(args['min-score'], finder.minimumScore ?? configured.minimumNarrativeScore ?? DEFAULT_REEL_CONFIG.minimumNarrativeScore),
        minimumTier: normalizeTier(args['min-tier'], finder.minimumTier ?? configured.minimumTier ?? DEFAULT_REEL_CONFIG.minimumTier)
    };
}


const COMPACT_METRIC_ALIASES = Object.freeze({
    actionArc: ['actionarc', 'hookscore', 'openingaction', 'earlyaction', 'reelhook'],
    underdogComeback: ['underdogcomeback', 'comebackscore', 'comeback'],
    collectiveNearDeath: ['collectiveneardeath', 'nearextinction', 'neardeath'],
    dominantFavoriteUpset: ['dominantfavoriteupset', 'favoriteupset', 'upset'],
    leadVolatility: ['leadvolatility', 'leadchanges', 'leaderchanges'],
    dominanceSwings: ['dominanceswings', 'dominanceswing', 'momentumturns'],
    lateUncertainty: ['lateuncertainty', 'uncertainty'],
    lateReversal: ['latereversal', 'finalreversal'],
    clutchFinish: ['clutchfinish', 'quickclutch', 'clutchpenalty'],
    predictabilityPenalty: ['predictabilitypenalty', 'predictability'],
    stagnationPenalty: ['stagnationpenalty', 'stagnation'],
    resolvedWinner: ['resolvedwinner', 'winnerresolved'],
    powerupReliance: ['winnerpowerupreliance', 'powerupreliance', 'winnerpowerupshare', 'powerupstrengthshare'],
    finalAliveTeams: ['finalaliveteams', 'livingteams', 'remainingteams', 'teamsalive'],
    finalMargin: ['finalmargin', 'winningmargin', 'leadmargin'],
    firstActionSeconds: ['firstactionseconds', 'firstactiontime'],
    openingChaos: ['openingchaos', 'earlychaos'],
    openingDeaths: ['openingdeaths', 'earlydeaths'],
    selectionLead: ['selectionlead', 'leadatten', 'tensecondlead'],
    duration: ['durationseconds', 'matchduration', 'duration']
});

function canonicalMetricKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function numericLeaves(object, maximumDepth = 7) {
    const leaves = [];
    const seen = new Set();

    function visit(value, pathParts, depth) {
        if (value == null || depth > maximumDepth) return;

        if (typeof value === 'number' && Number.isFinite(value)) {
            leaves.push({ path: pathParts, value });
            return;
        }

        if (typeof value === 'boolean') {
            leaves.push({ path: pathParts, value: value ? 1 : 0 });
            return;
        }

        if (typeof value !== 'object') return;
        if (seen.has(value)) return;
        seen.add(value);

        if (Array.isArray(value)) {
            // Compact fallback must never walk bot/timeline arrays.
            if (value.length > 32) return;
            for (let index = 0; index < value.length; index += 1) {
                visit(value[index], [...pathParts, String(index)], depth + 1);
            }
            return;
        }

        for (const [key, child] of Object.entries(value)) {
            const canonical = canonicalMetricKey(key);
            if (['samples', 'timeline', 'bots', 'players', 'entities', 'snapshots'].includes(canonical)) continue;
            visit(child, [...pathParts, key], depth + 1);
        }
    }

    visit(object, [], 0);
    return leaves;
}

function compactMetric(entry, aliasKey) {
    const aliases = COMPACT_METRIC_ALIASES[aliasKey] || [canonicalMetricKey(aliasKey)];
    const candidates = [];

    for (const leaf of numericLeaves(entry)) {
        const canonicalParts = leaf.path.map(canonicalMetricKey);
        const canonicalPath = canonicalParts.join('.');
        let aliasIndex = -1;

        for (let index = 0; index < aliases.length; index += 1) {
            if (canonicalPath.includes(aliases[index])) {
                aliasIndex = index;
                break;
            }
        }

        if (aliasIndex < 0) continue;

        const last = canonicalParts.at(-1) || '';
        const preferredLeaf = ['score', 'value', 'total', 'raw', 'bonus', 'count', 'ratio', 'share', 'seconds'].includes(last);
        const exactPart = canonicalParts.some(part => aliases.includes(part));
        const rank =
            (exactPart ? 100 : 0) +
            (preferredLeaf ? 25 : 0) -
            aliasIndex * 3 -
            leaf.path.length * 0.05;

        candidates.push({ rank, value: leaf.value, path: leaf.path.join('.') });
    }

    candidates.sort((first, second) => second.rank - first.rank);
    return candidates.length
        ? { available: true, value: finite(candidates[0].value), path: candidates[0].path }
        : { available: false, value: 0, path: null };
}

function compactFeatures(entry) {
    const metrics = {};
    for (const key of Object.keys(COMPACT_METRIC_ALIASES)) metrics[key] = compactMetric(entry, key);

    return {
        baseScore: finite(entry.score),
        winnerTeamId: entry.final?.winnerTeamId || entry.summary?.winnerTeamId || entry.winnerTeamId || null,
        metrics
    };
}

function percentileMaps(records, metricKeys) {
    const maps = {};

    for (const metricKey of metricKeys) {
        const present = records
            .filter(record => record.compactRaw?.metrics?.[metricKey]?.available)
            .map(record => ({ seed: record.seed, value: record.compactRaw.metrics[metricKey].value }))
            .sort((first, second) => first.value - second.value || String(first.seed).localeCompare(String(second.seed)));

        const map = new Map();
        if (present.length === 1) map.set(present[0].seed, 0.5);
        else {
            for (let index = 0; index < present.length; index += 1) {
                map.set(present[index].seed, index / Math.max(1, present.length - 1));
            }
        }
        maps[metricKey] = map;
    }

    const base = [...records]
        .sort((first, second) => finite(first.compactRaw?.baseScore) - finite(second.compactRaw?.baseScore));
    const baseMap = new Map();
    if (base.length === 1) baseMap.set(base[0].seed, 0.5);
    else {
        for (let index = 0; index < base.length; index += 1) {
            baseMap.set(base[index].seed, index / Math.max(1, base.length - 1));
        }
    }
    maps.baseScore = baseMap;
    return maps;
}

function compactPercentile(record, maps, key, neutral = 0.5) {
    if (!record.compactRaw?.metrics?.[key]?.available) return neutral;
    return maps[key]?.get(record.seed) ?? neutral;
}

function absoluteCompactHook(record, reelConfig, percentileActionArc) {
    const metrics = record.compactRaw.metrics;
    let weighted = percentileActionArc;
    let weight = 1;

    if (metrics.firstActionSeconds.available) {
        const seconds = metrics.firstActionSeconds.value;
        const firstActionScore = seconds <= reelConfig.firstActionIdealSeconds
            ? 1
            : 1 - smoothstep(reelConfig.firstActionIdealSeconds, reelConfig.firstActionLatestSeconds, seconds);
        weighted += clamp(firstActionScore) * 0.75;
        weight += 0.75;
    }

    if (metrics.openingChaos.available) {
        weighted += (1 - smoothstep(0.35, reelConfig.openingHardMaxChaos, metrics.openingChaos.value)) * 0.55;
        weight += 0.55;
    }

    if (metrics.openingDeaths.available) {
        weighted += (metrics.openingDeaths.value <= reelConfig.openingMaxDeaths ? 1 : clamp(1 - metrics.openingDeaths.value * 0.5)) * 0.35;
        weight += 0.35;
    }

    if (metrics.selectionLead.available) {
        const leadValue = metrics.selectionLead.value > 1 ? metrics.selectionLead.value / 100 : metrics.selectionLead.value;
        weighted += bell(leadValue, reelConfig.selectionIdealLead, reelConfig.selectionMaxLead - reelConfig.selectionIdealLead) * 0.40;
        weight += 0.40;
    }

    return clamp(weighted / Math.max(EPS, weight));
}

function scoreCompactFallback(records, reelConfig) {
    if (!records.length) return records;

    const metricKeys = Object.keys(COMPACT_METRIC_ALIASES);
    const maps = percentileMaps(records, metricKeys);

    return records.map(record => {
        const p = key => compactPercentile(record, maps, key);
        const actionArc = p('actionArc');
        const hookQuality = absoluteCompactHook(record, reelConfig, actionArc);
        const underdog = p('underdogComeback');
        const nearDeath = p('collectiveNearDeath');
        const upset = p('dominantFavoriteUpset');
        const volatility = p('leadVolatility');
        const swings = p('dominanceSwings');
        const uncertainty = p('lateUncertainty');
        const reversal = p('lateReversal');
        const clutch = p('clutchFinish', 0);
        const predictability = p('predictabilityPenalty', 0);
        const stagnation = p('stagnationPenalty', 0);
        const powerup = p('powerupReliance', 0.35);
        const baseRank = maps.baseScore.get(record.seed) ?? 0.5;

        const hookScore = 70 * (0.82 * hookQuality + 0.18 * baseRank);
        const selectionScore = 45 * (0.34 * upset + 0.34 * volatility + 0.32 * swings);
        const comebackScore = 55 * (0.68 * underdog + 0.32 * reversal);
        const rollerScore = 35 * (0.55 * volatility + 0.45 * swings);
        const nearScore = 30 * nearDeath;

        const finalAliveMetric = record.compactRaw.metrics.finalAliveTeams;
        const finalAlive = finalAliveMetric.available ? Math.round(finalAliveMetric.value) : null;
        const exactTwoScore = finalAlive == null ? 0.62 : finalAlive === reelConfig.preferredFinalAliveTeams ? 1 : 0;
        const finalMarginMetric = record.compactRaw.metrics.finalMargin;
        const finalMargin = finalMarginMetric.available
            ? (finalMarginMetric.value > 1 ? finalMarginMetric.value / 100 : finalMarginMetric.value)
            : null;
        const closeEnding = finalMargin == null
            ? 0.60
            : 1 - smoothstep(reelConfig.maximumFinalStrengthMargin * 0.55, reelConfig.maximumFinalStrengthMargin, finalMargin);
        const endingScore = 38 * (0.44 * uncertainty + 0.24 * reversal + 0.20 * exactTwoScore + 0.12 * closeEnding);

        const meritScore = 30 * (
            0.35 * (1 - clutch) +
            0.23 * (1 - powerup) +
            0.27 * (1 - predictability) +
            0.15 * underdog
        );

        const penalties =
            42 * clutch +
            32 * predictability +
            30 * stagnation +
            34 * (finalAlive == null || finalAlive === reelConfig.preferredFinalAliveTeams ? 0 : finalAlive <= 1 ? 1 : 0.55) +
            18 * (1 - hookQuality);

        const score = Math.max(0, hookScore + selectionScore + comebackScore + rollerScore + nearScore + endingScore + meritScore - penalties);
        const rejects = [];

        if (!record.compactRaw.winnerTeamId) rejects.push('no winner was returned by the base evaluator');
        if (finalAlive != null && finalAlive !== reelConfig.preferredFinalAliveTeams) {
            rejects.push(`ended with ${finalAlive} living teams instead of exactly ${reelConfig.preferredFinalAliveTeams}`);
        }
        if (hookQuality < 0.30 && record.compactRaw.metrics.actionArc.available) rejects.push('compact hook telemetry is weak');
        if (clutch > 0.92 && underdog < 0.55) rejects.push('result is dominated by clutch-finish telemetry');
        if (stagnation > 0.96) rejects.push('match is strongly stagnation-ranked');

        const hardReject = rejects.length > 0;
        const tier = hardReject
            ? score >= 215 ? 'B' : score >= 165 ? 'C' : 'D'
            : score >= 290 ? 'S' : score >= 235 ? 'A' : score >= 185 ? 'B' : score >= 135 ? 'C' : 'D';

        const availableMetrics = Object.entries(record.compactRaw.metrics)
            .filter(([, metric]) => metric.available)
            .map(([key]) => key);

        return {
            ...record,
            score: round(score),
            tier,
            hardReject,
            evaluationMode: 'compact-fallback',
            narrative: {
                hook: round(hookScore),
                audienceSelection: round(selectionScore),
                comeback: round(comebackScore),
                rollerCoaster: round(rollerScore),
                nearExtinction: round(nearScore),
                ending: round(endingScore),
                merit: round(meritScore),
                penalties: round(penalties),
                diagnostics: {
                    telemetryMode: 'compact-fallback',
                    hookQuality: round(hookQuality),
                    actionArcPercentile: round(actionArc),
                    underdogComebackPercentile: round(underdog),
                    nearDeathPercentile: round(nearDeath),
                    leadVolatilityPercentile: round(volatility),
                    dominanceSwingsPercentile: round(swings),
                    lateUncertaintyPercentile: round(uncertainty),
                    lateReversalPercentile: round(reversal),
                    clutchFinishPercentile: round(clutch),
                    predictabilityPenaltyPercentile: round(predictability),
                    stagnationPenaltyPercentile: round(stagnation),
                    finalAliveTeams: finalAlive,
                    finalMargin: finalMargin == null ? null : round(finalMargin),
                    availableMetrics
                }
            },
            summary: {
                ...(record.summary || {}),
                winnerTeamId: record.compactRaw.winnerTeamId,
                reasons: [
                    'Browser search returned compact results without timelines; used reel-oriented compact reranking.',
                    `hook quality ${round(hookQuality)}; action-arc percentile ${round(actionArc)}`,
                    `comeback ${round(underdog)}; near-death ${round(nearDeath)}; late uncertainty ${round(uncertainty)}`,
                    `volatility ${round(volatility)}; swings ${round(swings)}; late reversal ${round(reversal)}`,
                    `clutch ${round(clutch)}; predictability ${round(predictability)}; stagnation ${round(stagnation)}`,
                    finalAlive == null
                        ? 'final living-team count unavailable; exact-two-team gate could not be verified'
                        : `final living teams ${finalAlive}`,
                    ...rejects.map(reason => `reject: ${reason}`)
                ]
            },
            compactRaw: undefined
        };
    });
}

function compactCandidate(entry) {
    return stripSamples({
        ...entry,
        baseScore: finite(entry.score),
        baseTier: entry.tier || 'D',
        evaluationMode: 'compact-fallback',
        compactRaw: compactFeatures(entry)
    });
}

function missingResultCandidate(seed) {
    return {
        seed,
        baseScore: 0,
        baseTier: 'D',
        score: 0,
        tier: 'D',
        hardReject: true,
        evaluationMode: 'missing-result',
        summary: {
            winnerTeamId: null,
            reasons: ['The browser seed search returned no result for this seed.']
        },
        narrative: {
            diagnostics: {
                telemetryMode: 'missing-result'
            }
        }
    };
}

function normalizeSampleMode(value) {
    const mode = String(value || 'auto').toLowerCase();
    return ['auto', 'required', 'compact'].includes(mode) ? mode : 'auto';
}

function validPositiveInteger(value) {
    return Number.isInteger(value) && value >= 1;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage: node tools/find-seeds.mjs [options]\n\n` +
            `  --prefix <text>             Seed prefix (default: arena)\n` +
            `  --start <number>            First numeric suffix (default: 0)\n` +
            `  --count <number>            Seeds to evaluate (default: 100)\n` +
            `  --workers <number>          Parallel logic workers\n` +
            `  --batch-size <number>       Seeds per worker batch (default: 20)\n` +
            `  --top <number>              Highest-ranked seeds retained\n` +
            `  --sample-every <frames>     Timeline interval (recommend 15-20)\n` +
            `  --sample-mode <mode>        auto|required|compact (default: auto)\n` +
            `  --base-evaluator <id>       Browser evaluator used to run simulations\n` +
            `  --min-score <number>        Reel score threshold\n` +
            `  --min-tier <S|A|B|C|D>     Reel tier threshold\n` +
            `  --selected-limit <number>   Maximum selected seeds\n` +
            `  --retries <number>          Search retries per batch (default: 2)\n` +
            `  --details                   Print narrative reasons\n` +
            `  --all-results               Save all scored results\n` +
            `  --output <file.json>        Output path\n` +
            `  --chromium <path>           Chromium executable override\n`);
        return;
    }

    const configPath = path.join(root, 'game-config.json');
    const gameConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const finder = gameConfig.seedFinder || {};
    const reelConfig = reelConfigFrom(gameConfig, args);
    const fps = Math.max(1, finite(gameConfig.targetFps, 60));

    const configuredMaxFrames = Number(finder.maxFrames);
    if (!validPositiveInteger(configuredMaxFrames)) {
        throw new Error(
            `game-config.json: seedFinder.maxFrames must be an integer >= 1. ` +
            `Use ${Math.max(1, Math.round(finite(gameConfig.match?.maxDurationSeconds, 60) * fps))} for the current match limit.`
        );
    }

    const count = Math.max(1, integer(args.count, 100));
    const start = integer(args.start, 0);
    const prefixValue = String(args.prefix || 'arena');
    const seeds = Array.from({ length: count }, (_, index) => `${prefixValue}-${start + index}`);
    const cpuDefault = Math.max(1, Math.min(6, (os.availableParallelism?.() || os.cpus().length || 2) - 1));
    const workers = Math.max(1, Math.min(count, integer(args.workers, finder.parallelWorkers || cpuDefault), 8));
    const batchSize = Math.max(1, integer(args['batch-size'], 20));
    const topK = Math.max(1, integer(args.top, finder.topK || 30));
    const selectedLimit = Math.max(1, integer(args['selected-limit'], finder.selectedLimit || topK));
    const sampleEveryFrames = Math.max(1, integer(args['sample-every'], finder.sampleEveryFrames || 20));
    const maxFrames = configuredMaxFrames;
    const baseEvaluator = String(args['base-evaluator'] || args.evaluator || finder.baseEvaluator || finder.evaluator || 'engaging-v2');
    const outputPath = path.resolve(root, String(args.output || 'seed-results.json'));
    const includeDetails = Boolean(args.details);
    const retainAllResults = Boolean(args['all-results'] || finder.retainAllResults);
    const sampleMode = normalizeSampleMode(args['sample-mode'] || finder.sampleMode || 'auto');
    const retries = Math.max(0, Math.min(5, integer(args.retries, 2)));

    const server = await startStaticServer(root);
    const browsers = [];
    const batches = makeBatches(seeds, batchSize);
    const scored = [];
    let nextBatch = 0;
    let completed = 0;
    let warnedCompactFallback = false;
    const startedAt = Date.now();

    console.log(
        `Evaluating ${count} seeds with ${workers} workers ` +
        `(batch=${batchSize}, base=${baseEvaluator}, reranker=reel-narrative-v3, sampleMode=${sampleMode}).`
    );

    async function browserSearch(browser, batchSeeds) {
        const requestSamples = sampleMode !== 'compact';
        const searchPayload = {
            seeds: batchSeeds,
            evaluatorId: baseEvaluator,
            sampleEveryFrames,
            maxFrames,
            framesPerSecond: fps,
            topK: batchSeeds.length,
            selectedLimit: batchSeeds.length,
            minimumScore: 0,
            minimumTier: 'D',
            includeSamples: requestSamples,
            includeDetails: true,
            retainAllResults: true,
            returnScores: true,
            dispatchProgress: false,
            yieldEverySeed: false
        };

        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await browser.client.evaluate(
                    `window.KineticArena.seedFinder.search(${JSON.stringify(searchPayload)})`
                );
            } catch (error) {
                lastError = error;
                if (attempt >= retries) break;
                console.warn(`Seed batch retry ${attempt + 1}/${retries}: ${error.message || error}`);
            }
        }
        throw lastError;
    }

    async function worker(workerIndex) {
        const browser = await launchAutomationBrowser({
            url: `${server.url}/?automation=seed`,
            width: finite(gameConfig.recording?.width, 1080),
            height: finite(gameConfig.recording?.height, 1920),
            chromium: args.chromium || process.env.CHROMIUM_PATH || null
        });
        browsers.push(browser);

        const evaluators = await browser.client.evaluate('window.KineticArena.seedFinder.listEvaluators()');
        if (!evaluators.includes(baseEvaluator)) {
            throw new Error(`Unknown base evaluator "${baseEvaluator}". Available: ${evaluators.join(', ')}`);
        }

        while (true) {
            const batchIndex = nextBatch++;
            if (batchIndex >= batches.length) return;
            const batchSeeds = batches[batchIndex];
            const result = await browserSearch(browser, batchSeeds);
            const entries = [...(result.results || []), ...(result.top || []), ...(result.selected || [])];
            const unique = new Map();
            for (const entry of entries) {
                if (!entry?.seed) continue;
                const existing = unique.get(entry.seed);
                if (!existing || samplesOf(entry).length > samplesOf(existing).length || finite(entry.score) > finite(existing.score)) {
                    unique.set(entry.seed, entry);
                }
            }

            const hasAnySamples = [...unique.values()].some(entry => samplesOf(entry).length > 0);
            if (sampleMode === 'required' && unique.size > 0 && !hasAnySamples) {
                throw new Error(
                    'Browser seed search did not return timeline samples and --sample-mode=required was selected. ' +
                    'Use --sample-mode=auto for compact fallback or patch the browser search to return samples.'
                );
            }

            if (!hasAnySamples && sampleMode === 'auto' && !warnedCompactFallback) {
                warnedCompactFallback = true;
                console.warn(
                    'Browser seed search returned compact results without timeline samples. ' +
                    'Continuing with the reel-oriented compact fallback. Exact 0-3 s / 3-10 s checks are used only when matching telemetry exists.'
                );
            }

            for (const seed of batchSeeds) {
                const entry = unique.get(seed);
                if (!entry) {
                    scored.push(missingResultCandidate(seed));
                    continue;
                }

                if (samplesOf(entry).length > 0 && sampleMode !== 'compact') {
                    const reel = evaluateReel(entry, { framesPerSecond: fps, sampleEveryFrames }, reelConfig);
                    scored.push(stripSamples({
                        ...entry,
                        baseScore: finite(entry.score),
                        baseTier: entry.tier || 'D',
                        score: round(reel.score),
                        tier: reel.tier,
                        hardReject: reel.hardReject,
                        evaluationMode: 'timeline',
                        narrative: { ...reel.components, diagnostics: { ...reel.diagnostics, telemetryMode: 'timeline' } },
                        summary: {
                            ...(entry.summary || {}),
                            winnerTeamId: entry.final?.winnerTeamId || entry.summary?.winnerTeamId || null,
                            reasons: reel.reasons
                        }
                    }));
                } else {
                    scored.push(compactCandidate(entry));
                }
            }

            completed += batchSeeds.length;
            const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
            const rate = completed / elapsed;
            const remaining = (count - completed) / Math.max(0.001, rate);
            console.log(`[worker ${workerIndex + 1}] ${completed}/${count}, ${rate.toFixed(2)} seeds/s, ETA ${remaining.toFixed(0)}s`);
        }
    }

    try {
        await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));

        const compactRecords = scored.filter(entry => entry.evaluationMode === 'compact-fallback');
        const compactScored = scoreCompactFallback(compactRecords, reelConfig);
        const compactBySeed = new Map(compactScored.map(entry => [entry.seed, entry]));
        const finalized = scored.map(entry => compactBySeed.get(entry.seed) || entry);

        const bySeed = new Map();
        for (const entry of finalized) {
            const existing = bySeed.get(entry.seed);
            if (!existing || entry.score > existing.score) bySeed.set(entry.seed, entry);
        }

        const ranked = [...bySeed.values()]
            .sort((first, second) => Number(first.hardReject) - Number(second.hardReject) || finite(second.score) - finite(first.score) || first.seed.localeCompare(second.seed))
            .map((entry, index) => ({
                ...entry,
                rank: index + 1,
                selected: Boolean(
                    !entry.hardReject &&
                    (entry.final?.winnerTeamId || entry.summary?.winnerTeamId) &&
                    entry.score >= reelConfig.minimumNarrativeScore &&
                    tierAtLeast(entry.tier, reelConfig.minimumTier)
                )
            }));

        const selected = ranked.filter(entry => entry.selected).slice(0, selectedLimit);
        const top = ranked.slice(0, topK);
        const scoreValues = ranked.map(entry => finite(entry.score));
        const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
        const modes = { timeline: 0, compactFallback: 0, missingResult: 0 };
        for (const entry of ranked) {
            tiers[entry.tier] = (tiers[entry.tier] || 0) + 1;
            if (entry.evaluationMode === 'timeline') modes.timeline += 1;
            else if (entry.evaluationMode === 'compact-fallback') modes.compactFallback += 1;
            else modes.missingResult += 1;
        }

        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const output = {
            evaluatorId: 'reel-narrative-v3',
            baseEvaluatorId: baseEvaluator,
            criteria: {
                minimumScore: reelConfig.minimumNarrativeScore,
                minimumTier: reelConfig.minimumTier,
                requiredFinalAliveTeams: reelConfig.preferredFinalAliveTeams,
                openingSeconds: [0, reelConfig.openingEndSeconds],
                audienceSelectionSeconds: [reelConfig.openingEndSeconds, reelConfig.selectionEndSeconds],
                durationScored: false
            },
            execution: {
                logicOnly: true,
                parallelWorkers: workers,
                batchSize,
                sampleEveryFrames,
                maxFrames,
                sampleModeRequested: sampleMode,
                telemetryModes: modes,
                elapsedSeconds: round(elapsedSeconds),
                seedsPerSecond: round(count / Math.max(0.001, elapsedSeconds))
            },
            searched: count,
            statistics: {
                searched: count,
                scored: ranked.length,
                selected: selected.length,
                hardRejected: ranked.filter(entry => entry.hardReject).length,
                maximumScore: round(Math.max(...scoreValues, 0)),
                minimumScore: round(scoreValues.length ? Math.min(...scoreValues) : 0),
                averageScore: round(mean(scoreValues)),
                medianScore: round(median(scoreValues)),
                tiers,
                telemetryModes: modes
            },
            selected,
            top,
            ...(retainAllResults ? { results: ranked } : {})
        };

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');

        console.log(`\nSelected ${selected.length} of ${count} seeds.`);
        const display = selected.length ? selected : top;
        console.log(selected.length ? '\nReel-ready seeds:' : '\nNo seed passed every gate; highest scores:');

        for (const entry of display.slice(0, selectedLimit)) {
            const diagnostics = entry.narrative?.diagnostics || {};
            const reasons = includeDetails && Array.isArray(entry.summary?.reasons)
                ? `\n     ${entry.summary.reasons.slice(0, 5).join('; ')}`
                : '';
            console.log(
                `${String(entry.rank).padStart(3)}. ${entry.seed} ` +
                `score=${finite(entry.score).toFixed(1)} tier=${entry.tier} ` +
                `winner=${entry.summary?.winnerTeamId || entry.final?.winnerTeamId || 'draw'} ` +
                `mode=${entry.evaluationMode || 'unknown'} ` +
                `hook=${finite(diagnostics.hookScore ?? diagnostics.hookQuality).toFixed(2)} ` +
                `finalTeams=${diagnostics.finalAliveTeams ?? '?'} ` +
                `${entry.hardReject ? '[REJECTED]' : ''}${reasons}`
            );
        }

        if (modes.compactFallback > 0) {
            console.log(
                `\nNote: ${modes.compactFallback} seed(s) used compact fallback telemetry. ` +
                'They are ranked for reel potential, but exact frame-window validation requires browser timeline samples.'
            );
        }
        console.log(`Saved ${outputPath}`);
    } finally {
        await Promise.all(browsers.map(browser => browser.close().catch(() => {})));
        await new Promise(resolve => server.server.close(resolve));
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});