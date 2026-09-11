#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startStaticServer, launchAutomationBrowser } from './lib/browser-automation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIER_ORDER = Object.freeze({ S: 5, A: 4, B: 3, C: 2, D: 1 });

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [key, inline] = token.slice(2).split('=', 2);
        if (inline !== undefined) result[key] = inline;
        else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index];
        else result[key] = true;
    }
    return result;
}

function integer(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
}

function number(value, fallback) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTier(value, fallback = 'A') {
    const normalized = String(value || fallback).toUpperCase();
    return TIER_ORDER[normalized] ? normalized : fallback;
}

function tierAtLeast(candidate, minimum) {
    return (TIER_ORDER[candidate] || 0) >= (TIER_ORDER[minimum] || 0);
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 3) {
    const scale = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function mergeCandidates(batchResults, options) {
    const bySeed = new Map();
    for (const batch of batchResults) {
        for (const entry of [...(batch.top || []), ...(batch.selected || []), ...(batch.results || [])]) {
            const existing = bySeed.get(entry.seed);
            if (!existing || entry.score > existing.score) bySeed.set(entry.seed, entry);
        }
    }

    const ranked = [...bySeed.values()]
        .sort((first, second) => second.score - first.score || first.seed.localeCompare(second.seed))
        .map((entry, index) => ({
            ...entry,
            rank: index + 1,
            selected: Boolean(
                entry.final?.winnerTeamId &&
                entry.score >= options.minimumScore &&
                tierAtLeast(entry.tier, options.minimumTier)
            )
        }));

    return {
        top: ranked.slice(0, options.topK),
        selected: ranked.filter(entry => entry.selected).slice(0, options.selectedLimit),
        retained: ranked
    };
}

function buildStatistics(batchResults, scores, selectedCount) {
    const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    let searched = 0;
    for (const batch of batchResults) {
        searched += Number(batch.searched) || 0;
        for (const [tier, count] of Object.entries(batch.statistics?.tiers || {})) {
            tiers[tier] = (tiers[tier] || 0) + Number(count || 0);
        }
    }
    const total = scores.reduce((sum, score) => sum + score, 0);
    return {
        searched,
        selected: selectedCount,
        maximumScore: round(Math.max(...scores, 0)),
        minimumScore: round(scores.length ? Math.min(...scores) : 0),
        averageScore: round(scores.length ? total / scores.length : 0),
        medianScore: round(median(scores)),
        tiers
    };
}

function makeBatches(seeds, batchSize) {
    const batches = [];
    for (let index = 0; index < seeds.length; index += batchSize) {
        batches.push(seeds.slice(index, index + batchSize));
    }
    return batches;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage: node tools/find-seeds.mjs [options]\n\n` +
            `  --prefix <text>          Generated seed prefix (default: arena)\n` +
            `  --start <number>         First numeric suffix (default: 0)\n` +
            `  --count <number>         Number of seeds to evaluate (default: 100)\n` +
            `  --workers <number>       Parallel headless logic workers (default: config/CPU based)\n` +
            `  --batch-size <number>    Seeds sent to each worker per batch (default: 20)\n` +
            `  --top <number>           Highest-ranked seeds retained\n` +
            `  --sample-every <frames>  State sample interval (default: config, normally 30)\n` +
            `  --evaluator <id>         Evaluator id (default: engaging-v2)\n` +
            `  --min-score <number>     Selection score threshold\n` +
            `  --min-tier <S|A|B|C|D>  Selection tier threshold\n` +
            `  --selected-limit <n>     Maximum selected seeds retained\n` +
            `  --details                Retain score components and human-readable reasons\n` +
            `  --all-results            Retain every evaluated result (slower/larger JSON)\n` +
            `  --output <file.json>     Result file (default: seed-results.json)\n` +
            `  --chromium <path>        Chromium executable override\n`);
        return;
    }

    const config = JSON.parse(await fs.readFile(path.join(root, 'game-config.json'), 'utf8'));
    const width = Number(config.recording?.width) || 1080;
    const height = Number(config.recording?.height) || 1920;
    const finderConfig = config.seedFinder || {};
    const count = Math.max(1, integer(args.count, 100));
    const start = integer(args.start, 0);
    const prefix = String(args.prefix || 'arena');
    const seeds = Array.from({ length: count }, (_, index) => `${prefix}-${start + index}`);
    const cpuDefault = Math.max(1, Math.min(6, (os.availableParallelism?.() || os.cpus().length || 2) - 1));
    const configuredWorkers = Number(finderConfig.parallelWorkers) || cpuDefault;
    const workers = Math.max(1, Math.min(count, integer(args.workers, configuredWorkers), 8));
    const batchSize = Math.max(1, integer(args['batch-size'], 20));

    const options = {
        topK: Math.max(1, integer(args.top, Number(finderConfig.topK) || 20)),
        sampleEveryFrames: Math.max(1, integer(args['sample-every'], Number(finderConfig.sampleEveryFrames) || 30)),
        maxFrames: Number(finderConfig.maxFrames) || Number(config.match?.maxDurationSeconds || 60) * Number(config.targetFps || 60),
        framesPerSecond: Number(config.targetFps) || 60,
        evaluatorId: String(args.evaluator || finderConfig.evaluator || 'engaging-v2'),
        minimumScore: Math.max(0, number(args['min-score'], Number(finderConfig.minimumScore) || 190)),
        minimumTier: normalizeTier(args['min-tier'], finderConfig.minimumTier || 'A'),
        selectedLimit: Math.max(1, integer(args['selected-limit'], Number(finderConfig.selectedLimit) || Number(finderConfig.topK) || 20)),
        includeSamples: false,
        includeDetails: Boolean(args.details),
        retainAllResults: Boolean(args['all-results']),
        returnScores: true,
        dispatchProgress: false,
        yieldEverySeed: false
    };
    const outputPath = path.resolve(root, String(args.output || 'seed-results.json'));
    const batches = makeBatches(seeds, batchSize);
    const server = await startStaticServer(root);
    const browsers = [];
    const batchResults = [];
    let nextBatch = 0;
    let completedSeeds = 0;
    const startedAt = Date.now();

    console.log(
        `Evaluating ${count} seeds with ${workers} parallel logic-only workers ` +
        `(batch=${batchSize}, evaluator=${options.evaluatorId}).`
    );

    async function worker(workerIndex) {
        const browser = await launchAutomationBrowser({
            url: `${server.url}/?automation=seed`,
            width,
            height,
            chromium: args.chromium || process.env.CHROMIUM_PATH || null
        });
        browsers.push(browser);
        const evaluators = await browser.client.evaluate('window.KineticArena.seedFinder.listEvaluators()');
        if (!evaluators.includes(options.evaluatorId)) {
            throw new Error(`Unknown evaluator "${options.evaluatorId}". Available: ${evaluators.join(', ')}`);
        }

        while (true) {
            const batchIndex = nextBatch++;
            if (batchIndex >= batches.length) return;
            const batchSeeds = batches[batchIndex];
            const result = await browser.client.evaluate(
                `window.KineticArena.seedFinder.search(${JSON.stringify({ ...options, seeds: batchSeeds })})`
            );
            batchResults.push(result);
            completedSeeds += batchSeeds.length;
            const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
            const seedsPerSecond = completedSeeds / elapsedSeconds;
            const remainingSeconds = (count - completedSeeds) / Math.max(0.001, seedsPerSecond);
            console.log(
                `[worker ${workerIndex + 1}] ${completedSeeds}/${count} seeds, ` +
                `${seedsPerSecond.toFixed(2)} seeds/s, ETA ${remainingSeconds.toFixed(0)}s`
            );
        }
    }

    try {
        await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));
        const scores = batchResults.flatMap(result => result.scoreValues || []);
        const merged = mergeCandidates(batchResults, options);
        const statistics = buildStatistics(batchResults, scores, merged.selected.length);
        const persisted = {
            evaluatorId: options.evaluatorId,
            criteria: {
                minimumScore: options.minimumScore,
                minimumTier: options.minimumTier,
                selectedLimit: options.selectedLimit
            },
            execution: {
                logicOnly: true,
                parallelWorkers: workers,
                batchSize,
                sampleEveryFrames: options.sampleEveryFrames,
                elapsedSeconds: round((Date.now() - startedAt) / 1000),
                seedsPerSecond: round(count / Math.max(0.001, (Date.now() - startedAt) / 1000))
            },
            searched: statistics.searched,
            statistics,
            selected: merged.selected,
            top: merged.top,
            ...(options.retainAllResults ? { results: merged.retained } : {})
        };

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(persisted, null, 2) + '\n');

        console.log(`\nSelected ${merged.selected.length} of ${statistics.searched} seeds.`);
        const display = merged.selected.length ? merged.selected : merged.top;
        console.log(merged.selected.length ? '\nEngaging seeds:' : '\nNo seed met the threshold; highest scores:');
        for (const entry of display.slice(0, options.selectedLimit)) {
            const summary = entry.summary || {};
            const extra = options.includeDetails && Array.isArray(summary.reasons)
                ? `\n     ${summary.reasons.slice(0, 3).join('; ')}`
                : '';
            console.log(
                `${String(entry.rank).padStart(3)}. ${entry.seed}  ` +
                `score=${Number(entry.score).toFixed(1)} tier=${entry.tier} ` +
                `winner=${summary.winnerTeamId || entry.final?.winnerTeamId || 'draw'}${extra}`
            );
        }
        console.log(
            `\nmax=${statistics.maximumScore.toFixed(1)}, median=${statistics.medianScore.toFixed(1)}, ` +
            `average=${statistics.averageScore.toFixed(1)}, elapsed=${persisted.execution.elapsedSeconds.toFixed(1)}s`
        );
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
