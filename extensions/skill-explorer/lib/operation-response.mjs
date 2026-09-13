import { createBoundedDiagnostics } from "./diagnostics.mjs";

const WARNING_LIMIT = 20;

function toWarnings(warnings, observabilityWarning) {
    return [...warnings, ...(observabilityWarning ? [observabilityWarning] : [])]
        .filter(warning => typeof warning === "string" && warning.trim())
        .slice(0, WARNING_LIMIT);
}

export function createOperationResponse({
    operation,
    result = {},
    complete,
    sourceErrors = result.sourceErrors || [],
    attemptedSources = result.attemptedSources || [],
    warnings = [],
    counters = {},
    resultCount = Array.isArray(result.results) ? result.results.length : 0,
    budgetExhausted = false
}) {
    if (!operation) throw new Error("An operation identifier is required.");

    const diagnostics = createBoundedDiagnostics({ sourceErrors, attemptedSources });
    const responseComplete = complete ?? result.complete ?? !result.error;
    const responseWarnings = toWarnings(warnings, result.observabilityWarning);
    const normalizedCounters = { ...counters };
    const receipt = {
        operation,
        resultCount,
        complete: Boolean(responseComplete),
        budgetExhausted,
        ...normalizedCounters,
        ...diagnostics
    };

    return {
        ...result,
        operation,
        complete: Boolean(responseComplete),
        degraded: result.degraded ?? (!responseComplete || sourceErrors.length > 0),
        counters: normalizedCounters,
        ...normalizedCounters,
        ...diagnostics,
        warnings: responseWarnings,
        budgetExhausted,
        operationReceipt: { ...receipt, ...(result.operationReceipt || {}) }
    };
}

export function operationFailure(operation, error, options = {}) {
    const source = options.source || "operation";
    const sourceErrors = options.sourceErrors || [{
        source,
        error: error.message,
        statusCode: error.statusCode || null
    }];
    return createOperationResponse({
        operation,
        result: { ...(options.result || {}), error: options.message || error.message, results: options.results || [] },
        complete: false,
        sourceErrors,
        attemptedSources: options.attemptedSources || [source],
        warnings: options.warnings,
        counters: options.counters,
        resultCount: 0,
        budgetExhausted: /budget exhausted|operation deadline/i.test(error.message)
    });
}
