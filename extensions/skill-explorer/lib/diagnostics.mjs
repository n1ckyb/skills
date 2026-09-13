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
