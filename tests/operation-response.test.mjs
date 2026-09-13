import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperationDiagnosticReport } from "../extensions/skill-explorer/lib/diagnostics.mjs";
import { createOperationResponse, operationFailure } from "../extensions/skill-explorer/lib/operation-response.mjs";

const operations = ["search", "trending", "vet", "install", "sync"];

function assertContract(response, operation) {
    assert.equal(response.operation, operation);
    assert.equal(typeof response.complete, "boolean");
    assert.equal(typeof response.counters, "object");
    assert.equal(typeof response.budgetExhausted, "boolean");
    assert.ok(Array.isArray(response.sourceErrors));
    assert.ok(Array.isArray(response.attemptedSources));
    assert.ok(Array.isArray(response.warnings));
    assert.equal(response.operationReceipt.operation, operation);
    assert.equal(typeof response.diagnosticCounts.omittedSourceErrors, "number");
}

test("all operation success responses share the contract", () => {
    for (const operation of operations) {
        const response = createOperationResponse({
            operation,
            result: { results: [{ name: "example" }], complete: true },
            attemptedSources: ["primary"],
            counters: { httpRequests: 1 },
            resultCount: 1
        });
        assertContract(response, operation);
        assert.equal(response.complete, true);
        assert.equal(response.httpRequests, 1);
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

test("operation diagnostic report summarizes local reliability signals", () => {
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
});
