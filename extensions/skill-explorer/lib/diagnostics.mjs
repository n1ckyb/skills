/**
 * Skill Explorer Diagnostics & Local Observability Engine
 *
 * Responsibilities:
 * - Aggregating local reliability telemetry from operation state records (~/.copilot/skill-explorer-operation-state.jsonl).
 * - Multi-dimensional record filtering across configurable time windows (1h, 24h, 7d, all) and origins (production, development, test, all).
 * - Origin-aware breakdown and safe handling of legacy untagged records (defaulting to production).
 * - Threshold evaluation for alert warnings: budget exhaustion, source failure rates, Git fallback frequency, and state compaction drops.
 * - Generating bounded diagnostic summaries for tool response envelopes and CLI inspection.
 */

export const MODEL_DIAGNOSTIC_LIMITS = Object.freeze({
    sourceErrors: 20,
    attemptedSources: 50
});

export const DEFAULT_DIAGNOSTIC_THRESHOLDS = Object.freeze({
    budgetExhaustionThreshold: 1,
    sourceFailureRateThreshold: 0.25,
    gitFallbackThreshold: 1,
    compactionDroppedRecordsThreshold: 1
});

export const DIAGNOSTIC_WINDOWS = Object.freeze(["1h", "24h", "7d", "all"]);
export const DEFAULT_DIAGNOSTIC_WINDOW = "all";

export const KNOWN_ORIGINS = Object.freeze(["production", "development", "test", "all"]);
export const DEFAULT_ORIGIN_FILTER = "all";

/**
 * Normalizes an origin filter string to a canonical origin name.
 *
 * @param {string} [origin]
 * @returns {string}
 */
export function normalizeOriginFilter(origin) {
    if (!origin || origin === "all" || origin === "*" || origin === "any") {
        return "all";
    }
    const lower = String(origin).trim().toLowerCase();
    if (lower === "prod" || lower === "production") return "production";
    if (lower === "dev" || lower === "development") return "development";
    if (lower === "test" || lower === "testing") return "test";
    return lower;
}

/**
 * Filters operation state records by origin/environment marker and calculates breakdown counts.
 *
 * @param {Array<object>} [records=[]]
 * @param {string} [originFilter="all"]
 * @param {object} [options={}]
 * @returns {{ filteredRecords: Array<object>, origin: string, recordsByOrigin: { production: number, development: number, test: number, other: number }, fallbackOriginRecords: number }}
 */
export function filterRecordsByOrigin(records = [], originFilter = DEFAULT_ORIGIN_FILTER, options = {}) {
    const normalized = normalizeOriginFilter(originFilter);
    const defaultOriginForLegacy = options.defaultOrigin || "production";

    const recordsByOrigin = {
        production: 0,
        development: 0,
        test: 0,
        other: 0
    };
    let fallbackOriginRecords = 0;

    for (const record of records) {
        if (record.originResolution?.usedFallback || (!record.origin && !record.environment)) {
            fallbackOriginRecords++;
        }
        const recordOrigin = (record.origin || record.environment || defaultOriginForLegacy).toLowerCase();
        if (recordOrigin === "production" || recordOrigin === "prod") {
            recordsByOrigin.production++;
        } else if (recordOrigin === "development" || recordOrigin === "dev") {
            recordsByOrigin.development++;
        } else if (recordOrigin === "test" || recordOrigin === "testing") {
            recordsByOrigin.test++;
        } else {
            recordsByOrigin.other++;
        }
    }

    if (normalized === "all") {
        return {
            filteredRecords: [...records],
            origin: "all",
            recordsByOrigin,
            fallbackOriginRecords
        };
    }

    const filteredRecords = records.filter(record => {
        const recordOrigin = (record.origin || record.environment || defaultOriginForLegacy).toLowerCase();
        if (normalized === "production" && (recordOrigin === "production" || recordOrigin === "prod")) return true;
        if (normalized === "development" && (recordOrigin === "development" || recordOrigin === "dev")) return true;
        if (normalized === "test" && (recordOrigin === "test" || recordOrigin === "testing")) return true;
        return recordOrigin === normalized;
    });

    return {
        filteredRecords,
        origin: normalized,
        recordsByOrigin,
        fallbackOriginRecords
    };
}

export function parseDiagnosticWindow(windowSpec) {
    if (!windowSpec || windowSpec === "all" || windowSpec === "alltime") {
        return { name: "all", durationMs: null };
    }
    if (typeof windowSpec === "number" && windowSpec > 0) {
        return { name: `${windowSpec}ms`, durationMs: windowSpec };
    }
    const normalized = String(windowSpec).trim().toLowerCase();
    switch (normalized) {
        case "1h":
        case "hour":
        case "1hour":
        case "recent-hour":
            return { name: "1h", durationMs: 60 * 60 * 1000 };
        case "24h":
        case "1d":
        case "day":
        case "1day":
        case "recent-day":
            return { name: "24h", durationMs: 24 * 60 * 60 * 1000 };
        case "7d":
        case "1w":
        case "week":
        case "7days":
        case "recent-week":
            return { name: "7d", durationMs: 7 * 24 * 60 * 60 * 1000 };
        case "all":
        case "alltime":
        case "history":
        case "retained":
            return { name: "all", durationMs: null };
        default: {
            const match = normalized.match(/^(\d+)(h|d|w|m|s|ms)$/);
            if (match) {
                const count = parseInt(match[1], 10);
                const unit = match[2];
                let multiplier = 1000;
                if (unit === "s") multiplier = 1000;
                else if (unit === "m") multiplier = 60 * 1000;
                else if (unit === "h") multiplier = 60 * 60 * 1000;
                else if (unit === "d") multiplier = 24 * 60 * 60 * 1000;
                else if (unit === "w") multiplier = 7 * 24 * 60 * 60 * 1000;
                else if (unit === "ms") multiplier = 1;
                return { name: `${count}${unit}`, durationMs: count * multiplier };
            }
            throw new Error(`Unrecognized diagnostic window '${windowSpec}'. Supported windows: 1h, 24h, 7d, all.`);
        }
    }
}

export function filterRecordsByWindow(records = [], windowSpec = DEFAULT_DIAGNOSTIC_WINDOW, options = {}) {
    const { name, durationMs } = parseDiagnosticWindow(windowSpec);
    const now = options.now instanceof Date
        ? options.now
        : (options.now ? new Date(options.now) : new Date());

    if (durationMs === null) {
        let earliestTimestamp = null;
        for (const record of records) {
            const ts = record.recordedAt || record.timestamp;
            if (ts && (!earliestTimestamp || new Date(ts) < new Date(earliestTimestamp))) {
                earliestTimestamp = ts;
            }
        }
        return {
            filteredRecords: [...records],
            window: {
                name: "all",
                durationMs: null,
                startTime: earliestTimestamp,
                endTime: now.toISOString(),
                totalRetainedRecords: records.length,
                filteredRecordCount: records.length
            }
        };
    }

    const startCutoff = new Date(now.getTime() - durationMs);
    const filteredRecords = records.filter(record => {
        const ts = record.recordedAt || record.timestamp;
        if (!ts) return false;
        const recordDate = new Date(ts);
        return recordDate >= startCutoff && recordDate <= now;
    });

    return {
        filteredRecords,
        window: {
            name,
            durationMs,
            startTime: startCutoff.toISOString(),
            endTime: now.toISOString(),
            totalRetainedRecords: records.length,
            filteredRecordCount: filteredRecords.length
        }
    };
}

export function createBoundedDiagnostics({ sourceErrors = [], attemptedSources = [] }, limits = MODEL_DIAGNOSTIC_LIMITS) {
    const boundedErrors = sourceErrors.slice(0, limits.sourceErrors);
    const boundedSources = attemptedSources.slice(0, limits.attemptedSources);
    return {
        sourceErrors: boundedErrors,
        attemptedSources: boundedSources,
        diagnosticCounts: {
            sourceErrors: sourceErrors.length,
            attemptedSources: attemptedSources.length,
            omittedSourceErrors: sourceErrors.length - boundedErrors.length,
            omittedAttemptedSources: attemptedSources.length - boundedSources.length
        }
    };
}

export function createOperationDiagnosticReport(records = [], options = {}) {
    const originOption = options.origin || DEFAULT_ORIGIN_FILTER;
    const { filteredRecords: originFilteredRecords, origin: activeOrigin, recordsByOrigin, fallbackOriginRecords } = filterRecordsByOrigin(records, originOption, options);

    const windowOption = options.window || DEFAULT_DIAGNOSTIC_WINDOW;
    const { filteredRecords, window: windowMeta } = filterRecordsByWindow(originFilteredRecords, windowOption, options);
    const activeFallbackOriginRecords = filteredRecords.filter(record =>
        record.originResolution?.usedFallback || (!record.origin && !record.environment)
    ).length;

    const sourceAvailability = new Map();
    let totalDurationMs = 0;
    let durationSamples = 0;
    let budgetExhaustions = 0;
    let fallbackAttempts = 0;
    let compactionDrops = 0;

    for (const record of filteredRecords) {
        if (Number.isFinite(record.durationMs)) {
            totalDurationMs += record.durationMs;
            durationSamples++;
        }
        if (record.budgetExhausted) budgetExhaustions++;
        if (record.droppedRecordCount) compactionDrops += record.droppedRecordCount;
        for (const source of record.attemptedSources || []) {
            const current = sourceAvailability.get(source) || { source, attempts: 0, failures: 0 };
            current.attempts++;
            sourceAvailability.set(source, current);
            if (/fallback/i.test(source)) fallbackAttempts++;
        }
        for (const failure of record.sourceErrors || record.failures || []) {
            const source = failure.source || "operation";
            const current = sourceAvailability.get(source) || { source, attempts: 0, failures: 0 };
            current.failures++;
            sourceAvailability.set(source, current);
        }
    }

    const thresholds = { ...DEFAULT_DIAGNOSTIC_THRESHOLDS, ...(options.thresholds || {}) };
    const warnings = [];

    const originLabel = activeOrigin === "all" ? "" : ` (${activeOrigin} telemetry)`;
    const scopeLabel = windowMeta.name === "all"
        ? `all retained history${originLabel}`
        : `window '${windowMeta.name}'${originLabel}`;

    if (budgetExhaustions >= thresholds.budgetExhaustionThreshold) {
        warnings.push(`Budget exhaustion alert: ${budgetExhaustions} operation(s) exhausted their allocated request budget in ${scopeLabel}.`);
    }

    const sources = [...sourceAvailability.values()].map(source => {
        const rate = source.attempts ? source.failures / source.attempts : (source.failures > 0 ? 1 : 0);
        return {
            ...source,
            available: source.failures === 0,
            failureRate: Number(rate.toFixed(4))
        };
    });

    for (const src of sources) {
        if (src.failures > 0 && src.failureRate >= thresholds.sourceFailureRateThreshold) {
            warnings.push(`Source failure rate alert: '${src.source}' has a ${(src.failureRate * 100).toFixed(1)}% failure rate (${src.failures}/${src.attempts}) in ${scopeLabel}.`);
        }
    }

    if (fallbackAttempts >= thresholds.gitFallbackThreshold) {
        warnings.push(`Git fallback alert: ${fallbackAttempts} operation(s) fell back to Git transport in ${scopeLabel}.`);
    }

    if (compactionDrops >= thresholds.compactionDroppedRecordsThreshold) {
        warnings.push(`State compaction alert: ${compactionDrops} record(s) dropped due to local operation-state retention bounds in ${scopeLabel}.`);
    }
    if (activeFallbackOriginRecords > 0) {
        warnings.push(`Origin configuration warning: ${activeFallbackOriginRecords} record(s) used the production fallback; configure SKILL_EXPLORER_ORIGIN explicitly.`);
    }

    const recordCount = filteredRecords.length;

    return {
        recordCount,
        origin: activeOrigin,
        recordsByOrigin,
        originConfiguration: {
            fallbackRecords: activeFallbackOriginRecords,
            retainedFallbackRecords: fallbackOriginRecords
        },
        window: windowMeta,
        duration: {
            totalMs: totalDurationMs,
            averageMs: durationSamples ? Math.round(totalDurationMs / durationSamples) : 0,
            sampledOperations: durationSamples
        },
        budget: {
            exhaustedOperations: budgetExhaustions,
            exhaustionRate: recordCount ? Number((budgetExhaustions / recordCount).toFixed(4)) : 0
        },
        sourceAvailability: sources,
        stateCompaction: { droppedRecords: compactionDrops },
        fallback: {
            attempts: fallbackAttempts,
            fallbackRate: recordCount ? Number((fallbackAttempts / recordCount).toFixed(4)) : 0
        },
        thresholds,
        warnings,
        healthy: warnings.length === 0
    };
}
