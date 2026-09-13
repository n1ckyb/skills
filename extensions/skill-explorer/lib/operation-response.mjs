import { createBoundedDiagnostics } from "./diagnostics.mjs";

export const SCHEMA_VERSION = "1.0.0";

export const REQUIRED_ENVELOPE_FIELDS = Object.freeze([
    "operation",
    "schemaVersion",
    "complete",
    "degraded",
    "counters",
    "sourceErrors",
    "attemptedSources",
    "diagnosticCounts",
    "warnings",
    "budgetExhausted",
    "operationReceipt",
    "deprecationGuidance"
]);

export const DEPRECATION_GUIDANCE = Object.freeze({
    searchQuery: "Deprecated: use receipt or tool input arguments for query context.",
    canonicalSource: "Deprecated: use attemptedSources and sourceAvailability diagnostic records.",
    secondarySource: "Deprecated: use attemptedSources and sourceAvailability diagnostic records.",
    directorySource: "Deprecated: use attemptedSources and sourceAvailability diagnostic records.",
    priorityOrdering: "Deprecated: priority tiers are documented in schema and trustTierLabel.",
    totalCount: "Deprecated: use resultCount and operationReceipt.resultCount.",
    source: "Deprecated: use attemptedSources and sourceAvailability diagnostic records.",
    period: "Deprecated: use result items or ranking metadata in chatUx.",
    rankingNote: "Deprecated: ranking metadata is contained in individual item cards.",
    findingsCount: "Deprecated: use findings.length or vetting receipt risk summary.",
    recommendation: "Deprecated: use verdict, isBlocked, and review structure."
});

const WARNING_LIMIT = 20;

function toWarnings(warnings = [], observabilityWarning) {
    return [...warnings, ...(observabilityWarning ? [observabilityWarning] : [])]
        .filter(warning => typeof warning === "string" && warning.trim())
        .slice(0, WARNING_LIMIT);
}

export function validateOperationEnvelope(response) {
    if (!response || typeof response !== "object") {
        throw new Error("Operation response must be a non-null object.");
    }
    const missing = REQUIRED_ENVELOPE_FIELDS.filter(field => !(field in response));
    if (missing.length > 0) {
        throw new Error(`Operation response for '${response.operation || "unknown"}' is missing required envelope fields: ${missing.join(", ")}`);
    }
    return true;
}

export function createOperationResponse({
    operation,
    result = {},
    complete,
    sourceErrors = result.sourceErrors || [],
    attemptedSources = result.attemptedSources || [],
    warnings = [],
    counters = {},
    resultCount = Array.isArray(result.results) ? result.results.length : (result.results ? 1 : (result.status ? 1 : 0)),
    budgetExhausted = false
}) {
    if (!operation) throw new Error("An operation identifier is required.");

    const diagnostics = createBoundedDiagnostics({ sourceErrors, attemptedSources });
    const responseComplete = complete ?? result.complete ?? !result.error;
    const responseWarnings = toWarnings(warnings, result.observabilityWarning);
    const normalizedCounters = { ...counters };
    const receipt = {
        operation,
        schemaVersion: SCHEMA_VERSION,
        resultCount,
        complete: Boolean(responseComplete),
        budgetExhausted,
        ...normalizedCounters,
        ...diagnostics
    };

    const response = {
        ...result,
        operation,
        schemaVersion: SCHEMA_VERSION,
        complete: Boolean(responseComplete),
        degraded: result.degraded ?? (!responseComplete || sourceErrors.length > 0),
        counters: normalizedCounters,
        ...normalizedCounters,
        ...diagnostics,
        warnings: responseWarnings,
        budgetExhausted,
        operationReceipt: { ...receipt, ...(result.operationReceipt || {}) },
        deprecationGuidance: DEPRECATION_GUIDANCE
    };

    return response;
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
