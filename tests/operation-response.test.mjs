import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createOperationDiagnosticReport,
    DEFAULT_DIAGNOSTIC_THRESHOLDS
} from "../extensions/skill-explorer/lib/diagnostics.mjs";
import {
    createOperationResponse,
    operationFailure,
    validateOperationEnvelope,
    SCHEMA_VERSION,
    REQUIRED_ENVELOPE_FIELDS,
    DEPRECATION_GUIDANCE
} from "../extensions/skill-explorer/lib/operation-response.mjs";

const operations = ["search", "trending", "vet", "install", "sync", "configure"];

function assertContract(response, operation) {
    assert.ok(validateOperationEnvelope(response));
    assert.equal(response.operation, operation);
    assert.equal(response.schemaVersion, SCHEMA_VERSION);
    assert.equal(typeof response.complete, "boolean");
    assert.equal(typeof response.degraded, "boolean");
    assert.equal(typeof response.counters, "object");
    assert.equal(typeof response.budgetExhausted, "boolean");
    assert.ok(Array.isArray(response.sourceErrors));
    assert.ok(Array.isArray(response.attemptedSources));
    assert.ok(Array.isArray(response.warnings));
    assert.equal(typeof response.deprecationGuidance, "object");
    assert.equal(response.operationReceipt.operation, operation);
    assert.equal(response.operationReceipt.schemaVersion, SCHEMA_VERSION);
    assert.equal(typeof response.diagnosticCounts.omittedSourceErrors, "number");
}

test("all operation success responses share the standardized contract and schema version", () => {
    for (const operation of operations) {
        const response = createOperationResponse({
            operation,
            result: { results: [{ name: "example" }], complete: true },
            attemptedSources: ["primary"],
            counters: { httpRequests: 1, gitCommands: 0 },
            resultCount: 1
        });
        assertContract(response, operation);
        assert.equal(response.complete, true);
        assert.equal(response.httpRequests, 1);
        assert.equal(response.schemaVersion, "1.0.0");
        assert.ok(response.deprecationGuidance.totalCount);
    }
});

test("all operation failure and confirmation responses share the contract", () => {
    for (const operation of operations) {
        const failure = operationFailure(operation, new Error("upstream unavailable"), {
            source: "upstream",
            counters: { requestsAttempted: 2 }
        });
        assertContract(failure, operation);
        assert.equal(failure.complete, false);
        assert.equal(failure.sourceErrors[0].source, "upstream");

        const confirmation = createOperationResponse({
            operation,
            result: { status: "CONFIRMATION_REQUIRED" },
            attemptedSources: ["upstream"]
        });
        assertContract(confirmation, operation);
        assert.equal(confirmation.complete, true);
        assert.equal(confirmation.status, "CONFIRMATION_REQUIRED");
    }
});

test("validateOperationEnvelope catches missing required envelope fields", () => {
    const valid = createOperationResponse({
        operation: "search",
        result: { results: [] }
    });
    assert.ok(validateOperationEnvelope(valid));

    for (const field of REQUIRED_ENVELOPE_FIELDS) {
        const invalid = { ...valid };
        delete invalid[field];
        assert.throws(
            () => validateOperationEnvelope(invalid),
            new RegExp(`missing required envelope fields:.*${field}`)
        );
    }

    assert.throws(
        () => validateOperationEnvelope(null),
        /Operation response must be a non-null object/
    );
});

test("deprecation guidance provides migration mappings for legacy fields", () => {
    assert.ok(DEPRECATION_GUIDANCE.searchQuery);
    assert.ok(DEPRECATION_GUIDANCE.totalCount);
    assert.ok(DEPRECATION_GUIDANCE.canonicalSource);
    assert.ok(DEPRECATION_GUIDANCE.secondarySource);
    assert.ok(DEPRECATION_GUIDANCE.directorySource);
    assert.ok(DEPRECATION_GUIDANCE.source);
    assert.ok(DEPRECATION_GUIDANCE.period);
    assert.ok(DEPRECATION_GUIDANCE.rankingNote);
    assert.ok(DEPRECATION_GUIDANCE.findingsCount);
    assert.ok(DEPRECATION_GUIDANCE.recommendation);
});

test("operation diagnostic report summarizes local reliability signals and triggers threshold warnings", () => {
    const report = createOperationDiagnosticReport([{
        operation: "search",
        durationMs: 12,
        budgetExhausted: true,
        droppedRecordCount: 3,
        attemptedSources: ["catalog", "github-search-fallback"],
        sourceErrors: [{ source: "catalog", error: "503" }]
    }]);

    assert.deepEqual(report.duration, { totalMs: 12, averageMs: 12, sampledOperations: 1 });
    assert.equal(report.budget.exhaustedOperations, 1);
    assert.equal(report.stateCompaction.droppedRecords, 3);
    assert.equal(report.fallback.attempts, 1);
    assert.deepEqual(report.sourceAvailability.find(source => source.source === "catalog"), {
        source: "catalog", attempts: 1, failures: 1, available: false, failureRate: 1
    });

    // Check threshold warnings
    assert.equal(report.healthy, false);
    assert.ok(report.warnings.some(w => w.includes("Budget exhaustion alert")));
    assert.ok(report.warnings.some(w => w.includes("Source failure rate alert: 'catalog'")));
    assert.ok(report.warnings.some(w => w.includes("Git fallback alert")));
    assert.ok(report.warnings.some(w => w.includes("State compaction alert")));
});

test("operation diagnostic report reports healthy status when below all thresholds", () => {
    const report = createOperationDiagnosticReport([{
        operation: "vet",
        durationMs: 45,
        budgetExhausted: false,
        droppedRecordCount: 0,
        attemptedSources: ["github/awesome-copilot/skills/docker"],
        sourceErrors: []
    }]);

    assert.equal(report.healthy, true);
    assert.equal(report.warnings.length, 0);
    assert.equal(report.budget.exhaustedOperations, 0);
    assert.equal(report.stateCompaction.droppedRecords, 0);
    assert.equal(report.fallback.attempts, 0);
});
