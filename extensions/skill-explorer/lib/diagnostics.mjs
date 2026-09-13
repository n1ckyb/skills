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

export function createOperationDiagnosticReport(records, options = {}) {
    const sourceAvailability = new Map();
    let totalDurationMs = 0;
    let durationSamples = 0;
    let budgetExhaustions = 0;
    let fallbackAttempts = 0;
    let compactionDrops = 0;

    for (const record of records) {
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

    if (budgetExhaustions >= thresholds.budgetExhaustionThreshold) {
        warnings.push(`Budget exhaustion alert: ${budgetExhaustions} operation(s) exhausted their allocated request budget.`);
    }

    const sources = [...sourceAvailability.values()].map(source => {
        const rate = source.attempts ? source.failures / source.attempts : (source.failures > 0 ? 1 : 0);
        return {
            ...source,
            available: source.failures === 0,
            failureRate: rate
        };
    });

    for (const src of sources) {
        if (src.failures > 0 && src.failureRate >= thresholds.sourceFailureRateThreshold) {
            warnings.push(`Source failure rate alert: '${src.source}' has a ${(src.failureRate * 100).toFixed(1)}% failure rate (${src.failures}/${src.attempts}).`);
        }
    }

    if (fallbackAttempts >= thresholds.gitFallbackThreshold) {
        warnings.push(`Git fallback alert: ${fallbackAttempts} operation(s) fell back to Git transport.`);
    }

    if (compactionDrops >= thresholds.compactionDroppedRecordsThreshold) {
        warnings.push(`State compaction alert: ${compactionDrops} record(s) dropped due to local operation-state retention bounds.`);
    }

    return {
        recordCount: records.length,
        duration: {
            totalMs: totalDurationMs,
            averageMs: durationSamples ? Math.round(totalDurationMs / durationSamples) : 0,
            sampledOperations: durationSamples
        },
        budget: {
            exhaustedOperations: budgetExhaustions,
            exhaustionRate: records.length ? Number((budgetExhaustions / records.length).toFixed(4)) : 0
        },
        sourceAvailability: sources,
        stateCompaction: { droppedRecords: compactionDrops },
        fallback: { attempts: fallbackAttempts },
        thresholds,
        warnings,
        healthy: warnings.length === 0
    };
}
