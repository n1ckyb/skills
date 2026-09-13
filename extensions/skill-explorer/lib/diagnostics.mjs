export const MODEL_DIAGNOSTIC_LIMITS = Object.freeze({
    sourceErrors: 20,
    attemptedSources: 50
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

export function createOperationDiagnosticReport(records) {
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

    return {
        recordCount: records.length,
        duration: {
            totalMs: totalDurationMs,
            averageMs: durationSamples ? Math.round(totalDurationMs / durationSamples) : 0,
            sampledOperations: durationSamples
        },
        budget: { exhaustedOperations: budgetExhaustions },
        sourceAvailability: [...sourceAvailability.values()].map(source => ({
            ...source,
            available: source.failures === 0,
            failureRate: source.attempts ? source.failures / source.attempts : 1
        })),
        stateCompaction: { droppedRecords: compactionDrops },
        fallback: { attempts: fallbackAttempts }
    };
}
