import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    createOperationDiagnosticReport,
    filterRecordsByWindow,
    filterRecordsByOrigin,
    normalizeOriginFilter,
    parseDiagnosticWindow,
    DIAGNOSTIC_WINDOWS,
    DEFAULT_DIAGNOSTIC_WINDOW,
    KNOWN_ORIGINS,
    DEFAULT_ORIGIN_FILTER,
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
import {
    resolveRecordOrigin,
    resolveRecordOriginMetadata,
    recordOperationState,
    loadOperationState,
    DEFAULT_ORIGIN
} from "../extensions/skill-explorer/lib/config.mjs";

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

const APPROVED_RESPONSE_FACTORIES = ["createOperationResponse", "operationFailure"];

function assertHandlerReturnsOperationResponse(toolSource, operation) {
    const returnStatements = [...toolSource.matchAll(/return\s+JSON\.stringify\(\s*/g)];
    assert.ok(returnStatements.length > 0, `Public operation '${operation}' has no JSON response return.`);
    for (const statement of returnStatements) {
        const payload = toolSource.slice(statement.index + statement[0].length);
        const factory = /^([A-Za-z_$][\w$]*)\s*\(/.exec(payload);
        assert.ok(
            factory,
            `Public operation '${operation}' returns an ad hoc JSON payload instead of ${APPROVED_RESPONSE_FACTORIES.join(" or ")}.`
        );
        assert.ok(
            APPROVED_RESPONSE_FACTORIES.includes(factory[1]),
            `Public operation '${operation}' returns '${factory[1]}' instead of ${APPROVED_RESPONSE_FACTORIES.join(" or ")}.`
        );
    }
}

test("static contract: every registered public handler returns an operation response", async () => {
    const extensionSource = await fs.readFile(
        path.join(process.cwd(), "extensions", "skill-explorer", "extension.mjs"),
        "utf8"
    );

    const toolMatches = [...extensionSource.matchAll(/name:\s*"skill_explorer_([a-z_]+)"/g)];
    const registeredOperations = toolMatches.map(match => match[1]);
    assert.deepEqual(
        [...registeredOperations].sort(),
        [...SUPPORTED_OPERATIONS].sort(),
        "Every registered public tool must be listed in SUPPORTED_OPERATIONS, and every supported operation must be registered."
    );
    assert.equal(new Set(registeredOperations).size, registeredOperations.length, "Public tool names must be unique.");

    for (let index = 0; index < toolMatches.length; index++) {
        const operation = registeredOperations[index];
        const start = toolMatches[index].index;
        const end = toolMatches[index + 1]?.index ?? extensionSource.length;
        const toolSource = extensionSource.slice(start, end);
        assert.match(toolSource, /handler:\s*async\s*\(/, `Public operation '${operation}' must have an async handler.`);

        assertHandlerReturnsOperationResponse(toolSource, operation);
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

test("resolveRecordOrigin supports explicit option, environment variables, NODE_ENV, and safe default", () => {
    const originalEnv = { ...process.env };

    try {
        delete process.env.SKILL_EXPLORER_ORIGIN;
        delete process.env.SKILL_EXPLORER_ENV;
        delete process.env.COPILOT_ENVIRONMENT;
        delete process.env.NODE_ENV;

        // 1. Safe default
        assert.equal(resolveRecordOrigin(), "production");
        assert.deepEqual(resolveRecordOriginMetadata(), {
            origin: "production",
            source: "default",
            usedFallback: true,
            warning: "Telemetry origin was not configured; defaulting to production. Set SKILL_EXPLORER_ORIGIN explicitly."
        });

        // 2. Explicit argument
        assert.equal(resolveRecordOrigin("development"), "development");
        assert.equal(resolveRecordOrigin("test"), "test");
        assert.equal(resolveRecordOrigin("custom-staging"), "custom-staging");

        // 3. SKILL_EXPLORER_ORIGIN
        process.env.SKILL_EXPLORER_ORIGIN = "development";
        assert.equal(resolveRecordOrigin(), "development");
        delete process.env.SKILL_EXPLORER_ORIGIN;

        // 4. SKILL_EXPLORER_ENV
        process.env.SKILL_EXPLORER_ENV = "staging";
        assert.equal(resolveRecordOrigin(), "staging");
        delete process.env.SKILL_EXPLORER_ENV;

        // 5. COPILOT_ENVIRONMENT
        process.env.COPILOT_ENVIRONMENT = "test";
        assert.equal(resolveRecordOrigin(), "test");
        delete process.env.COPILOT_ENVIRONMENT;

        // 6. NODE_ENV heuristics
        process.env.NODE_ENV = "test";
        assert.equal(resolveRecordOrigin(), "test");
        process.env.NODE_ENV = "development";
        assert.equal(resolveRecordOrigin(), "development");
        process.env.NODE_ENV = "production";
        assert.equal(resolveRecordOrigin(), "production");
    } finally {
        process.env = originalEnv;
    }
});

test("recordOperationState embeds origin and environment markers in JSONL records", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-origin-"));
    const statePath = path.join(tempDir, "operation-state.jsonl");

    try {
        await recordOperationState("search", { query: "docker" }, statePath, undefined, { origin: "production" });
        await recordOperationState("vet", { repo: "owner/repo" }, statePath, undefined, { origin: "test" });
        await recordOperationState("install", { scope: "user" }, statePath, undefined, { origin: "development" });

        const records = await loadOperationState(statePath);
        assert.equal(records.length, 3);
        assert.equal(records[0].origin, "production");
        assert.equal(records[0].environment, "production");
        assert.equal(records[1].origin, "test");
        assert.equal(records[1].environment, "test");
        assert.equal(records[2].origin, "development");
        assert.equal(records[2].environment, "development");
        assert.equal(records[0].originResolution.source, "explicit");
        assert.equal(records[1].originResolution.usedFallback, false);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("recordOperationState preserves safe fallback metadata and warning when origin is unconfigured", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-origin-fallback-"));
    const statePath = path.join(tempDir, "operation-state.jsonl");
    const originalEnv = { ...process.env };

    try {
        delete process.env.SKILL_EXPLORER_ORIGIN;
        delete process.env.SKILL_EXPLORER_ENV;
        delete process.env.COPILOT_ENVIRONMENT;
        delete process.env.NODE_ENV;

        const receipt = await recordOperationState("search", {}, statePath);
        const [record] = await loadOperationState(statePath);
        assert.equal(record.origin, "production");
        assert.deepEqual(record.originResolution, resolveRecordOriginMetadata());
        assert.equal(record.originResolution.usedFallback, true);
        assert.match(record.observabilityWarning, /defaulting to production/i);
        assert.match(receipt.observabilityWarning, /defaulting to production/i);
    } finally {
        process.env = originalEnv;
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("filterRecordsByOrigin filters records and calculates breakdown by origin", () => {
    const records = [
        { operation: "search", origin: "production" },
        { operation: "vet", origin: "production" },
        { operation: "install", origin: "development" },
        { operation: "sync", origin: "test" },
        { operation: "configure" } // legacy untagged record, should map to default (production)
    ];

    // All origins
    const all = filterRecordsByOrigin(records, "all");
    assert.equal(all.filteredRecords.length, 5);
    assert.equal(all.origin, "all");
    assert.deepEqual(all.recordsByOrigin, {
        production: 3,
        development: 1,
        test: 1,
        other: 0
    });
    assert.equal(all.fallbackOriginRecords, 1);

    // Production only
    const prod = filterRecordsByOrigin(records, "production");
    assert.equal(prod.filteredRecords.length, 3);
    assert.equal(prod.origin, "production");

    // Development only
    const dev = filterRecordsByOrigin(records, "development");
    assert.equal(dev.filteredRecords.length, 1);
    assert.equal(dev.filteredRecords[0].operation, "install");

    // Test only
    const testRes = filterRecordsByOrigin(records, "test");
    assert.equal(testRes.filteredRecords.length, 1);
    assert.equal(testRes.filteredRecords[0].operation, "sync");
});

test("diagnostic report supports origin and window filtering simultaneously", () => {
    const baseTime = new Date("2026-09-13T16:00:00.000Z");
    const records = [
        // Within 1h: 1 prod search, 1 test search
        { operation: "search", origin: "production", recordedAt: "2026-09-13T15:45:00.000Z", durationMs: 10, attemptedSources: ["prod-src"], sourceErrors: [] },
        { operation: "search", origin: "test", recordedAt: "2026-09-13T15:50:00.000Z", durationMs: 5, attemptedSources: ["test-src"], sourceErrors: [] },
        // 5 hours ago (in 24h, outside 1h): 1 prod failure, 1 test failure
        { operation: "vet", origin: "production", recordedAt: "2026-09-13T11:00:00.000Z", durationMs: 20, budgetExhausted: true, attemptedSources: ["prod-fail"], sourceErrors: [{ source: "prod-fail", error: "500" }] },
        { operation: "vet", origin: "test", recordedAt: "2026-09-13T11:00:00.000Z", durationMs: 15, attemptedSources: ["test-src"], sourceErrors: [] }
    ];

    // Report for 1h window + production origin
    const report1hProd = createOperationDiagnosticReport(records, { origin: "production", window: "1h", now: baseTime });
    assert.equal(report1hProd.origin, "production");
    assert.equal(report1hProd.recordCount, 1);
    assert.equal(report1hProd.budget.exhaustedOperations, 0);
    assert.equal(report1hProd.healthy, true);

    // Report for 24h window + production origin (captures prod failure)
    const report24hProd = createOperationDiagnosticReport(records, { origin: "production", window: "24h", now: baseTime });
    assert.equal(report24hProd.origin, "production");
    assert.equal(report24hProd.recordCount, 2);
    assert.equal(report24hProd.budget.exhaustedOperations, 1);
    assert.equal(report24hProd.healthy, false);
    assert.ok(report24hProd.warnings[0].includes("production telemetry"));

    // Report for 24h window + test origin (test did not exhaust budget)
    const report24hTest = createOperationDiagnosticReport(records, { origin: "test", window: "24h", now: baseTime });
    assert.equal(report24hTest.origin, "test");
    assert.equal(report24hTest.recordCount, 2);
    assert.equal(report24hTest.budget.exhaustedOperations, 0);
    assert.equal(report24hTest.healthy, true);
});

test("diagnostics report warns about fallback origin records without mixing explicit origins", () => {
    const report = createOperationDiagnosticReport([
        { operation: "legacy" },
        { operation: "test", origin: "test", originResolution: { usedFallback: false } }
    ], { origin: "production" });

    assert.equal(report.recordCount, 1);
    assert.equal(report.originConfiguration.fallbackRecords, 1);
    assert.ok(report.warnings.some(warning => warning.includes("Origin configuration warning")));
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
        { operation: "search", origin: "test", recordedAt: "2026-09-13T15:40:00.000Z", durationMs: 10, attemptedSources: ["catalog"], sourceErrors: [] },
        { operation: "vet", origin: "test", recordedAt: "2026-09-13T15:50:00.000Z", durationMs: 20, attemptedSources: ["catalog"], sourceErrors: [] },
        // 5 hours ago (outside 1h, inside 24h): budget exhaustion and failures
        { operation: "sync", origin: "test", recordedAt: "2026-09-13T11:00:00.000Z", durationMs: 50, budgetExhausted: true, attemptedSources: ["failing-source"], sourceErrors: [{ source: "failing-source", error: "503" }] }
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

test("diagnostics CLI script supports --window, --hour, --day, --all, --all-windows, --origin, --prod, --dev, --test, --all-origins, and --help", async () => {
    const scriptPath = path.join(process.cwd(), "scripts", "skill-explorer-diagnostics.mjs");

    // 1. --help
    const { stdout: helpOut } = await execFileAsync(process.execPath, [scriptPath, "--help"]);
    assert.ok(helpOut.includes("Skill Explorer Diagnostics CLI"));
    assert.ok(helpOut.includes("--window"));
    assert.ok(helpOut.includes("--hour"));
    assert.ok(helpOut.includes("--day"));
    assert.ok(helpOut.includes("--origin"));
    assert.ok(helpOut.includes("--prod"));
    assert.ok(helpOut.includes("--dev"));
    assert.ok(helpOut.includes("--test"));
    assert.ok(helpOut.includes("--all-origins"));

    // 2. Default execution (all-history, all-origins)
    const { stdout: defaultOut } = await execFileAsync(process.execPath, [scriptPath]);
    const parsedDefault = JSON.parse(defaultOut);
    assert.equal(parsedDefault.window.name, "all");
    assert.equal(parsedDefault.origin, "all");
    assert.equal(typeof parsedDefault.recordCount, "number");
    assert.equal(typeof parsedDefault.recordsByOrigin, "object");

    // 3. --prod (shorthand)
    const { stdout: prodOut } = await execFileAsync(process.execPath, [scriptPath, "--prod"]);
    const parsedProd = JSON.parse(prodOut);
    assert.equal(parsedProd.origin, "production");

    // 4. --origin test
    const { stdout: testOut } = await execFileAsync(process.execPath, [scriptPath, "--origin", "test"]);
    const parsedTest = JSON.parse(testOut);
    assert.equal(parsedTest.origin, "test");

    // 5. --all-origins matrix
    const { stdout: matrixOriginsOut } = await execFileAsync(process.execPath, [scriptPath, "--all-origins"]);
    const parsedOriginsMatrix = JSON.parse(matrixOriginsOut);
    assert.ok(parsedOriginsMatrix["production"]);
    assert.ok(parsedOriginsMatrix["development"]);
    assert.ok(parsedOriginsMatrix["test"]);
    assert.ok(parsedOriginsMatrix["all"]);

    // 6. --all-windows matrix
    const { stdout: matrixOut } = await execFileAsync(process.execPath, [scriptPath, "--all-windows"]);
    const parsedMatrix = JSON.parse(matrixOut);
    assert.ok(parsedMatrix["1h"]);
    assert.ok(parsedMatrix["24h"]);
    assert.ok(parsedMatrix["all"]);
});

test("static contract check rejects ad hoc JSON.stringify returns", () => {
    const assertHandlerSource = (toolSource) => assertHandlerReturnsOperationResponse(toolSource, "example");

    assert.throws(
        () => assertHandlerSource('return JSON.stringify(createOperationResponse({ operation: "vet" }));\nreturn JSON.stringify({ error: message });'),
        /ad hoc JSON payload/,
        "An object-literal return must fail even when a valid factory return exists in the same handler."
    );

    assert.throws(
        () => assertHandlerSource('return JSON.stringify(operationFailure("vet", err));\nreturn JSON.stringify(response);'),
        /ad hoc JSON payload/,
        "A bare identifier return must fail even when a valid factory return exists in the same handler."
    );

    assert.throws(
        () => assertHandlerSource("return JSON.stringify(buildLegacyPayload(result));"),
        /returns 'buildLegacyPayload'/
    );

    assert.throws(
        () => assertHandlerSource("const value = 1;"),
        /no JSON response return/
    );

    assert.doesNotThrow(
        () => assertHandlerSource('return JSON.stringify(createOperationResponse({ operation: "vet" }));\nreturn JSON.stringify(operationFailure("vet", err));')
    );
});

test("vet handler forwards the observability warning and vetting receipt to the response envelope", async () => {
    const extensionSource = await fs.readFile(
        path.join(process.cwd(), "extensions", "skill-explorer", "extension.mjs"),
        "utf8"
    );
    const start = extensionSource.indexOf('name: "skill_explorer_vet"');
    assert.ok(start > -1, "vet tool must be registered");
    const end = extensionSource.indexOf('name: "skill_explorer_install"', start);
    const vetSource = extensionSource.slice(start, end === -1 ? extensionSource.length : end);

    assert.match(
        vetSource,
        /vetted\.observabilityWarning/,
        "The vet handler must forward vetted.observabilityWarning so origin-classification issues reach callers."
    );
    assert.match(
        vetSource,
        /vettingReceipt:\s*vetted\.receipt/,
        "The vet handler must forward the vetting receipt recorded with the operation state."
    );

    const warning = "Operation origin defaulted to production because no origin environment is configured.";
    const response = createOperationResponse({
        operation: "vet",
        result: { riskScore: 0, observabilityWarning: warning },
        attemptedSources: ["owner/repo"]
    });
    assert.ok(
        response.warnings.includes(warning),
        "createOperationResponse must surface a forwarded observabilityWarning in warnings."
    );
});
