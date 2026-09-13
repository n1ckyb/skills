import { createBoundedDiagnostics } from "./diagnostics.mjs";

/**
 * Skill Explorer Operation Response Contract & Schema Migration Engine
 *
 * Responsibilities:
 * - Constructing standardized, predictable JSON response envelopes for all public skill explorer operations
 *   (search, trending, vet, install, sync, configure).
 * - Enforcing envelope schema compliance (required fields, type checks, semver versioning).
 * - Exposing backward-compatible legacy fields throughout the v1.x support lifecycle.
 * - Providing deprecation guidance and mapping for downstream consumers migrating to modern fields.
 * - Supporting strict modern envelope generation (compatibilityMode: false) for v2.0-ready clients.
 * - Providing standardized error envelope generation (operationFailure) for all exception pathways.
 */

export const SCHEMA_VERSION = "1.0.0";
export const TARGET_SCHEMA_VERSION = "2.0.0";

export const SUPPORTED_OPERATIONS = Object.freeze([
    "search",
    "trending",
    "vet",
    "install",
    "sync",
    "configure"
]);

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

export const LEGACY_FIELDS = Object.freeze([
    "searchQuery",
    "canonicalSource",
    "secondarySource",
    "directorySource",
    "priorityOrdering",
    "totalCount",
    "source",
    "period",
    "rankingNote",
    "findingsCount",
    "recommendation"
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

export const SCHEMA_MIGRATION_POLICY = Object.freeze({
    currentVersion: SCHEMA_VERSION,
    targetVersion: TARGET_SCHEMA_VERSION,
    compatibilityWindow: "Supported through v1.x until v2.0.0 release (minimum 6 months from 1.0.0 release date, through 2026-12-31)",
    defaultMode: "backward-compatible",
    legacyFields: Object.freeze({
        searchQuery: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "operationReceipt.query or tool invocation arguments",
            removalCriteria: "Downstream consumers migrate to operationReceipt; compatibility window elapsed."
        }),
        canonicalSource: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "attemptedSources, sourceAvailability, and operationReceipt.sources",
            removalCriteria: "Zero telemetry showing consumption of top-level source descriptors."
        }),
        secondarySource: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "attemptedSources, sourceAvailability, and operationReceipt.sources",
            removalCriteria: "Zero telemetry showing consumption of top-level source descriptors."
        }),
        directorySource: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "attemptedSources, sourceAvailability, and operationReceipt.sources",
            removalCriteria: "Zero telemetry showing consumption of top-level source descriptors."
        }),
        priorityOrdering: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "trustTierLabel on individual items and documentation",
            removalCriteria: "UI rendering consumes item-level trust tiers directly."
        }),
        totalCount: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "resultCount and operationReceipt.resultCount",
            removalCriteria: "All client callers query resultCount."
        }),
        source: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "attemptedSources and sourceAvailability",
            removalCriteria: "All clients consume structured source availability diagnostics."
        }),
        period: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "rankingPeriod on individual item cards or chatUx metadata",
            removalCriteria: "Clients inspect item cards or chatUx directly."
        }),
        rankingNote: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "Individual item card badges and chatUx descriptions",
            removalCriteria: "UI surfaces handle ranking notes in item cards."
        }),
        findingsCount: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "findings.length and review structure",
            removalCriteria: "Consumers query findings array length directly."
        }),
        recommendation: Object.freeze({
            deprecatedIn: "1.0.0",
            scheduledRemoval: "2.0.0",
            replacement: "verdict, isBlocked, and review structure",
            removalCriteria: "Consumers inspect structured verdict and review fields."
        })
    }),
    removalCriteriaSummary: Object.freeze([
        "1. Compatibility window (v1.x lifecycle) has completed.",
        "2. Modern replacement fields are populated in standard envelope and operationReceipt.",
        "3. Strict modern mode (compatibilityMode: false) validated across all public operations.",
        "4. Breaking release (v2.0.0) increment with migration guide."
    ])
});

const WARNING_LIMIT = 20;

function toWarnings(warnings = [], observabilityWarning) {
    return [...warnings, ...(observabilityWarning ? [observabilityWarning] : [])]
        .filter(warning => typeof warning === "string" && warning.trim())
        .slice(0, WARNING_LIMIT);
}

export function getSchemaMigrationPolicy() {
    return SCHEMA_MIGRATION_POLICY;
}

export function getLegacyFields() {
    return LEGACY_FIELDS;
}

export function isLegacyField(fieldName) {
    return fieldName in SCHEMA_MIGRATION_POLICY.legacyFields;
}

export function validateOperationEnvelope(response) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new Error("Operation response must be a non-null object.");
    }
    const missing = REQUIRED_ENVELOPE_FIELDS.filter(field => !(field in response));
    if (missing.length > 0) {
        throw new Error(`Operation response for '${response.operation || "unknown"}' is missing required envelope fields: ${missing.join(", ")}`);
    }
    if (typeof response.operation !== "string" || !response.operation.trim()) {
        throw new Error("Operation response field 'operation' must be a non-empty string.");
    }
    if (typeof response.schemaVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(response.schemaVersion)) {
        throw new Error(`Operation response field 'schemaVersion' must be a valid semver string, got '${response.schemaVersion}'.`);
    }
    if (typeof response.complete !== "boolean") {
        throw new Error("Operation response field 'complete' must be a boolean.");
    }
    if (typeof response.degraded !== "boolean") {
        throw new Error("Operation response field 'degraded' must be a boolean.");
    }
    if (typeof response.budgetExhausted !== "boolean") {
        throw new Error("Operation response field 'budgetExhausted' must be a boolean.");
    }
    if (typeof response.counters !== "object" || response.counters === null) {
        throw new Error("Operation response field 'counters' must be a non-null object.");
    }
    if (!Array.isArray(response.sourceErrors)) {
        throw new Error("Operation response field 'sourceErrors' must be an array.");
    }
    if (!Array.isArray(response.attemptedSources)) {
        throw new Error("Operation response field 'attemptedSources' must be an array.");
    }
    if (!Array.isArray(response.warnings)) {
        throw new Error("Operation response field 'warnings' must be an array.");
    }
    if (typeof response.diagnosticCounts !== "object" || response.diagnosticCounts === null) {
        throw new Error("Operation response field 'diagnosticCounts' must be a non-null object.");
    }
    if (typeof response.operationReceipt !== "object" || response.operationReceipt === null) {
        throw new Error("Operation response field 'operationReceipt' must be a non-null object.");
    }
    if (typeof response.deprecationGuidance !== "object" || response.deprecationGuidance === null) {
        throw new Error("Operation response field 'deprecationGuidance' must be a non-null object.");
    }
    return true;
}

export function assertNoAdHocEnvelope(response, expectedOperation) {
    validateOperationEnvelope(response);
    if (expectedOperation && response.operation !== expectedOperation) {
        throw new Error(`Operation mismatch: expected '${expectedOperation}', got '${response.operation}'.`);
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
    budgetExhausted = false,
    compatibilityMode = true
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
        ...diagnostics,
        migrationPolicy: {
            currentVersion: SCHEMA_VERSION,
            targetVersion: TARGET_SCHEMA_VERSION,
            compatibilityMode: Boolean(compatibilityMode)
        }
    };

    let payload = { ...result };
    if (!compatibilityMode) {
        for (const legacyField of LEGACY_FIELDS) {
            delete payload[legacyField];
        }
    }

    const response = {
        ...payload,
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

    validateOperationEnvelope(response);
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
        budgetExhausted: /budget exhausted|operation deadline/i.test(error.message),
        compatibilityMode: options.compatibilityMode ?? true
    });
}
