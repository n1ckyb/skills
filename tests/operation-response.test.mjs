import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    createOperationDiagnosticReport,
    filterRecordsByWindow,
    parseDiagnosticWindow,
    DIAGNOSTIC_WINDOWS,
    DEFAULT_DIAGNOSTIC_WINDOW,
    DEFAULT_DIAGNOSTIC_THRESHOLDS
} from "../extensions/skill-explorer/lib/diagnostics.mjs";
import {
    createOperationResponse,
    operationFailure,
    validateOperationEnvelope,
    assertNoAdHocEnvelope,
    getSchemaMigrationPolicy,
    getLegacyFields,
    isLegacyField,
    SCHEMA_VERSION,
    TARGET_SCHEMA_VERSION,
    SUPPORTED_OPERATIONS,
    REQUIRED_ENVELOPE_FIELDS,
    LEGACY_FIELDS,
    DEPRECATION_GUIDANCE,
    SCHEMA_MIGRATION_POLICY
} from "../extensions/skill-explorer/lib/operation-response.mjs";

const execFileAsync = promisify(execFile);
const operations = SUPPORTED_OPERATIONS;

function assertContract(response, operation) {
    assert.ok(validateOperationEnvelope(response));
    assert.ok(assertNoAdHocEnvelope(response, operation));
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

test("static test: all registered tools in extension.mjs use createOperationResponse or operationFailure", async () => {
    const extensionSource = await fs.readFile(
        path.join(process.cwd(), "extensions", "skill-explorer", "extension.mjs"),
        "utf8"
    );

    // Verify all tool names match supported operations
    const toolNameMatches = [...extensionSource.matchAll(/name:\s*"skill_explorer_([a-z_]+)"/g)].map(m => m[1]);
    for (const tool of toolNameMatches) {
        assert.ok(
            SUPPORTED_OPERATIONS.includes(tool),
            `Tool 'skill_explorer_${tool}' is not listed in SUPPORTED_OPERATIONS`
        );
    }

    // Verify all return statements in handler functions return JSON.stringify(createOperationResponse(...)) or JSON.stringify(operationFailure(...))
    const returnStatements = [...extensionSource.matchAll(/return\s+JSON\.stringify\(([^;]+)\)/g)].map(m => m[1]);
    assert.ok(returnStatements.length >= 8, "Expected at least 8 handler return pathways in extension.mjs");
    for (const stmt of returnStatements) {
        assert.ok(
            stmt.includes("createOperationResponse") || stmt.includes("operationFailure"),
            `Handler return statement does not use createOperationResponse or operationFailure: ${stmt}`
        );
    }
});

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

test("assertNoAdHocEnvelope rejects ad-hoc and invalid envelopes", () => {
    const valid = createOperationResponse({ operation: "search", result: { results: [] } });
    assert.ok(assertNoAdHocEnvelope(valid, "search"));
    assert.throws(() => assertNoAdHocEnvelope(valid, "vet"), /Operation mismatch/);

    assert.throws(() => assertNoAdHocEnvelope({}), /missing required envelope fields/);
    assert.throws(() => assertNoAdHocEnvelope(null), /must be a non-null object/);
    assert.throws(() => assertNoAdHocEnvelope("string"), /must be a non-null object/);
});

test("validateOperationEnvelope catches missing required envelope fields and invalid types", () => {
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

    assert.throws(() => validateOperationEnvelope(null), /Operation response must be a non-null object/);
    assert.throws(() => validateOperationEnvelope([]), /Operation response must be a non-null object/);
    assert.throws(() => validateOperationEnvelope({ ...valid, operation: "" }), /field 'operation' must be a non-empty string/);
    assert.throws(() => validateOperationEnvelope({ ...valid, schemaVersion: "invalid" }), /valid semver string/);
    assert.throws(() => validateOperationEnvelope({ ...valid, complete: "true" }), /field 'complete' must be a boolean/);
    assert.throws(() => validateOperationEnvelope({ ...valid, degraded: "false" }), /field 'degraded' must be a boolean/);
    assert.throws(() => validateOperationEnvelope({ ...valid, budgetExhausted: 1 }), /field 'budgetExhausted' must be a boolean/);
    assert.throws(() => validateOperationEnvelope({ ...valid, sourceErrors: {} }), /field 'sourceErrors' must be an array/);
    assert.throws(() => validateOperationEnvelope({ ...valid, attemptedSources: "primary" }), /field 'attemptedSources' must be an array/);
    assert.throws(() => validateOperationEnvelope({ ...valid, warnings: null }), /field 'warnings' must be an array/);
    assert.throws(() => validateOperationEnvelope({ ...valid, counters: null }), /field 'counters' must be a non-null object/);
    assert.throws(() => validateOperationEnvelope({ ...valid, diagnosticCounts: null }), /field 'diagnosticCounts' must be a non-null object/);
    assert.throws(() => validateOperationEnvelope({ ...valid, operationReceipt: null }), /field 'operationReceipt' must be a non-null object/);
    assert.throws(() => validateOperationEnvelope({ ...valid, deprecationGuidance: null }), /field 'deprecationGuidance' must be a non-null object/);
});

test("schema migration policy exposes compatibility window, deprecation metadata, and removal criteria", () => {
    const policy = getSchemaMigrationPolicy();
    assert.equal(policy.currentVersion, "1.0.0");
    assert.equal(policy.targetVersion, "2.0.0");
    assert.ok(policy.compatibilityWindow.includes("v1.x"));
    assert.equal(policy.defaultMode, "backward-compatible");
    assert.ok(policy.removalCriteriaSummary.length >= 4);

    const legacyFieldsList = getLegacyFields();
    assert.deepEqual(legacyFieldsList, LEGACY_FIELDS);

    for (const field of legacyFieldsList) {
        assert.ok(isLegacyField(field), `Field '${field}' should be identified as legacy`);
        const meta = policy.legacyFields[field];
        assert.ok(meta, `Legacy field '${field}' is missing metadata`);
        assert.equal(meta.deprecatedIn, "1.0.0");
        assert.equal(meta.scheduledRemoval, "2.0.0");
        assert.ok(meta.replacement, `Field '${field}' is missing replacement recommendation`);
        assert.ok(meta.removalCriteria, `Field '${field}' is missing removal criteria`);
    }

    assert.equal(isLegacyField("operation"), false);
    assert.equal(isLegacyField("complete"), false);
});

test("backward compatibility is preserved by default while compatibilityMode: false strips legacy fields", () => {
    const legacyResult = {
        searchQuery: "docker",
        totalCount: 5,
        canonicalSource: { repository: "github/awesome-copilot" },
        secondarySource: { repository: "mattpocock/skills" },
        directorySource: { catalog: "https://www.skills.sh" },
        priorityOrdering: ["P0", "P1"],
        results: [{ name: "docker-helper" }]
    };

    // 1. Default (backward-compatible)
    const defaultResponse = createOperationResponse({
        operation: "search",
        result: legacyResult
    });
    assert.equal(defaultResponse.searchQuery, "docker");
    assert.equal(defaultResponse.totalCount, 5);
    assert.ok(defaultResponse.canonicalSource);
    assert.ok(defaultResponse.secondarySource);
    assert.ok(defaultResponse.directorySource);
    assert.deepEqual(defaultResponse.priorityOrdering, ["P0", "P1"]);
    assert.equal(defaultResponse.operationReceipt.migrationPolicy.compatibilityMode, true);

    // 2. Strict / Modern mode (compatibilityMode: false)
    const modernResponse = createOperationResponse({
        operation: "search",
        result: legacyResult,
        compatibilityMode: false
    });
    assert.equal(modernResponse.searchQuery, undefined);
    assert.equal(modernResponse.totalCount, undefined);
    assert.equal(modernResponse.canonicalSource, undefined);
    assert.equal(modernResponse.secondarySource, undefined);
    assert.equal(modernResponse.directorySource, undefined);
    assert.equal(modernResponse.priorityOrdering, undefined);
    assert.deepEqual(modernResponse.results, [{ name: "docker-helper" }]);
    assert.equal(modernResponse.operationReceipt.migrationPolicy.compatibilityMode, false);
    assertContract(modernResponse, "search");
});

test("deprecation guidance provides migration mappings for legacy fields", () => {
    for (const field of LEGACY_FIELDS) {
        assert.ok(DEPRECATION_GUIDANCE[field], `DEPRECATION_GUIDANCE is missing '${field}'`);
    }
});

test("parseDiagnosticWindow supports standard durations, shorthand aliases, and custom windows", () => {
    assert.deepEqual(parseDiagnosticWindow("all"), { name: "all", durationMs: null });
    assert.deepEqual(parseDiagnosticWindow("1h"), { name: "1h", durationMs: 3600000 });
    assert.deepEqual(parseDiagnosticWindow("hour"), { name: "1h", durationMs: 3600000 });
    assert.deepEqual(parseDiagnosticWindow("24h"), { name: "24h", durationMs: 86400000 });
    assert.deepEqual(parseDiagnosticWindow("day"), { name: "24h", durationMs: 86400000 });
    assert.deepEqual(parseDiagnosticWindow("7d"), { name: "7d", durationMs: 604800000 });
    assert.deepEqual(parseDiagnosticWindow("week"), { name: "7d", durationMs: 604800000 });
    assert.deepEqual(parseDiagnosticWindow("30m"), { name: "30m", durationMs: 1800000 });
    assert.deepEqual(parseDiagnosticWindow(5000), { name: "5000ms", durationMs: 5000 });

    assert.throws(() => parseDiagnosticWindow("invalid_window"), /Unrecognized diagnostic window/);
});

test("filterRecordsByWindow filters records by timestamp relative to reference time", () => {
    const baseTime = new Date("2026-09-13T16:00:00.000Z");
    const records = [
        { operation: "search", recordedAt: "2026-09-13T15:45:00.000Z", durationMs: 10 }, // 15 mins ago (in 1h, in 24h, in all)
        { operation: "vet", recordedAt: "2026-09-13T14:30:00.000Z", durationMs: 20 },    // 1.5h ago (outside 1h, in 24h, in all)
        { operation: "install", recordedAt: "2026-09-12T10:00:00.000Z", durationMs: 30 } // 30h ago (outside 1h, outside 24h, in all)
    ];

    // 1h window
    const filter1h = filterRecordsByWindow(records, "1h", { now: baseTime });
    assert.equal(filter1h.filteredRecords.length, 1);
    assert.equal(filter1h.filteredRecords[0].operation, "search");
    assert.equal(filter1h.window.name, "1h");
    assert.equal(filter1h.window.totalRetainedRecords, 3);
    assert.equal(filter1h.window.filteredRecordCount, 1);
    assert.equal(filter1h.window.startTime, "2026-09-13T15:00:00.000Z");
    assert.equal(filter1h.window.endTime, "2026-09-13T16:00:00.000Z");

    // 24h window
    const filter24h = filterRecordsByWindow(records, "24h", { now: baseTime });
    assert.equal(filter24h.filteredRecords.length, 2);
    assert.equal(filter24h.window.name, "24h");
    assert.equal(filter24h.window.filteredRecordCount, 2);

    // All window (default)
    const filterAll = filterRecordsByWindow(records, "all", { now: baseTime });
    assert.equal(filterAll.filteredRecords.length, 3);
    assert.equal(filterAll.window.name, "all");
    assert.equal(filterAll.window.startTime, "2026-09-12T10:00:00.000Z");
    assert.equal(filterAll.window.endTime, "2026-09-13T16:00:00.000Z");
});

test("diagnostic report computes alert rates and threshold warnings scoped to active window", () => {
    const baseTime = new Date("2026-09-13T16:00:00.000Z");
    const records = [
        // Within 1h: 1 healthy search, 1 healthy vet
        { operation: "search", recordedAt: "2026-09-13T15:40:00.000Z", durationMs: 10, attemptedSources: ["catalog"], sourceErrors: [] },
        { operation: "vet", recordedAt: "2026-09-13T15:50:00.000Z", durationMs: 20, attemptedSources: ["catalog"], sourceErrors: [] },
        // 5 hours ago (outside 1h, inside 24h): budget exhaustion and failures
        { operation: "sync", recordedAt: "2026-09-13T11:00:00.000Z", durationMs: 50, budgetExhausted: true, attemptedSources: ["failing-source"], sourceErrors: [{ source: "failing-source", error: "503" }] }
    ];

    // Report for 1h window should be healthy
    const report1h = createOperationDiagnosticReport(records, { window: "1h", now: baseTime });
    assert.equal(report1h.window.name, "1h");
    assert.equal(report1h.recordCount, 2);
    assert.equal(report1h.budget.exhaustedOperations, 0);
    assert.equal(report1h.budget.exhaustionRate, 0);
    assert.equal(report1h.healthy, true);
    assert.equal(report1h.warnings.length, 0);

    // Report for 24h window should capture the failure and alert
    const report24h = createOperationDiagnosticReport(records, { window: "24h", now: baseTime });
    assert.equal(report24h.window.name, "24h");
    assert.equal(report24h.recordCount, 3);
    assert.equal(report24h.budget.exhaustedOperations, 1);
    assert.equal(report24h.budget.exhaustionRate, 0.3333);
    assert.equal(report24h.healthy, false);
    assert.ok(report24h.warnings.some(w => w.includes("Budget exhaustion alert")));
    assert.ok(report24h.warnings.some(w => w.includes("Source failure rate alert: 'failing-source'")));
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

test("diagnostics CLI script supports --window, --hour, --day, --all, --all-windows, and --help", async () => {
    const scriptPath = path.join(process.cwd(), "scripts", "skill-explorer-diagnostics.mjs");

    // 1. --help
    const { stdout: helpOut } = await execFileAsync(process.execPath, [scriptPath, "--help"]);
    assert.ok(helpOut.includes("Skill Explorer Diagnostics CLI"));
    assert.ok(helpOut.includes("--window"));
    assert.ok(helpOut.includes("--hour"));
    assert.ok(helpOut.includes("--day"));

    // 2. Default execution (all-history)
    const { stdout: defaultOut } = await execFileAsync(process.execPath, [scriptPath]);
    const parsedDefault = JSON.parse(defaultOut);
    assert.equal(parsedDefault.window.name, "all");
    assert.equal(typeof parsedDefault.recordCount, "number");

    // 3. --window 1h
    const { stdout: hourOut } = await execFileAsync(process.execPath, [scriptPath, "--window", "1h"]);
    const parsedHour = JSON.parse(hourOut);
    assert.equal(parsedHour.window.name, "1h");

    // 4. --all-windows
    const { stdout: matrixOut } = await execFileAsync(process.execPath, [scriptPath, "--all-windows"]);
    const parsedMatrix = JSON.parse(matrixOut);
    assert.ok(parsedMatrix["1h"]);
    assert.ok(parsedMatrix["24h"]);
    assert.ok(parsedMatrix["all"]);
});
