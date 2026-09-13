import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    loadOperationState,
    recordOperationState
} from "../extensions/skill-explorer/lib/config.mjs";
import { createRequestBudget } from "../extensions/skill-explorer/lib/github.mjs";
import { cloneAndReadRepo, cloneRepoSecurely, runGitCommand } from "../extensions/skill-explorer/lib/github.mjs";
import { filterSynchronizedResults } from "../extensions/skill-explorer/lib/synchronization.mjs";
import { createBoundedDiagnostics } from "../extensions/skill-explorer/lib/diagnostics.mjs";

test("operation state compacts safely by record count and reports dropped records", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-rotation-"));
    const statePath = path.join(tempDir, "operation-state.jsonl");
    let receipt;
    try {
        for (let index = 0; index < 4; index++) {
            receipt = await recordOperationState("search", { index }, statePath, { maxBytes: 1024, maxRecords: 3 });
        }
        const history = await loadOperationState(statePath);
        assert.deepEqual(history.map(entry => entry.index), [1, 2, 3]);
        assert.equal(receipt.droppedRecordCount, 1);
        assert.match(receipt.observabilityWarning, /dropped 1 older record/);
        await assert.rejects(fs.access(`${statePath}.${process.pid}.${Date.now()}.tmp`));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("synchronized result diagnostics preserve failures while keeping results visible", async () => {
    const result = await filterSynchronizedResults(
        [{ fullName: "owner/repo", name: "repo" }],
        {
            loadInstalledRegistry: async () => ({
                "user:owner/repo": { sourceRevision: "old", contentDigest: "old" }
            }),
            readSkillSource: async () => {
                const error = new Error("upstream unavailable");
                error.statusCode = 503;
                throw error;
            }
        }
    );
    assert.equal(result.results[0].syncStatus, "Sync check unavailable");
    assert.equal(result.complete, false);
    assert.deepEqual(result.attemptedSources, ["sync:owner/repo"]);
    assert.deepEqual(result.sourceErrors, [{
        source: "sync:owner/repo",
        error: "upstream unavailable",
        statusCode: 503
    }]);
});

test("operation state compaction is thresholded and retains bounded diagnostics under load", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-load-"));
    const statePath = path.join(tempDir, "operation-state.jsonl");
    try {
        const receipts = await Promise.all(Array.from({ length: 100 }, (_, index) =>
            recordOperationState("load", { index }, statePath, { maxBytes: 32 * 1024, maxRecords: 25, compactEvery: 25 })
        ));
        const history = await loadOperationState(statePath);
        assert.ok(history.length <= 25);
        assert.ok(history.every(entry => entry.index >= 75));
        assert.ok(receipts.some(receipt => receipt.droppedRecordCount > 0));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("request budget exposes independent transport counters", async () => {
    const budget = createRequestBudget({ maxRequests: 3, timeoutMs: 10_000 });
    budget.take("httpRequests");
    budget.take("gitCommands");
    budget.count("childProcesses");
    budget.count("filesystemOperations", 4);
    const snapshot = budget.snapshot();
    assert.equal(snapshot.httpRequests, 1);
    assert.equal(snapshot.gitCommands, 1);
    assert.equal(snapshot.childProcesses, 1);
    assert.equal(snapshot.filesystemOperations, 4);
    assert.equal(snapshot.requestsAttempted, 2);
    assert.equal(snapshot.requestsRemaining, 1);
    assert.equal(typeof snapshot.elapsedMs, "number");
});

test("model diagnostics are capped while reporting complete local counts", () => {
    const diagnostics = createBoundedDiagnostics({
        sourceErrors: Array.from({ length: 25 }, (_, index) => ({ source: `source-${index}` })),
        attemptedSources: Array.from({ length: 55 }, (_, index) => `source-${index}`)
    });
    assert.equal(diagnostics.sourceErrors.length, 20);
    assert.equal(diagnostics.attemptedSources.length, 50);
    assert.deepEqual(diagnostics.diagnosticCounts, {
        sourceErrors: 25,
        attemptedSources: 55,
        omittedSourceErrors: 5,
        omittedAttemptedSources: 5
    });
});

test("Git transport shares operation deadline and rejects expired contexts before spawning", async () => {
    const budget = createRequestBudget({ maxRequests: 1, timeoutMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(
        runGitCommand(["--version"], { budget, executeGit: async () => assert.fail("must not spawn") }),
        /budget exhausted/
    );
});

test("Git transport aborts a running child when the shared operation deadline expires", async () => {
    const budget = createRequestBudget({ maxRequests: 1, timeoutMs: 5 });
    let observedAbort = false;
    await assert.rejects(
        runGitCommand(["--version"], {
            budget,
            executeGit: async (_args, commandOptions) => new Promise((_resolve, reject) => {
                commandOptions.signal.addEventListener("abort", () => {
                    observedAbort = true;
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                });
            })
        }),
        /exceeded the operation deadline/
    );
    assert.equal(observedAbort, true);
});

test("Git fallback consumes a budget step per command and cleans its temporary checkout on failure", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "git-fallback-"));
    const originalTmpdir = os.tmpdir;
    os.tmpdir = () => tempRoot;
    const commands = [];
    try {
        await assert.rejects(
            cloneAndReadRepo("owner/repo", "a".repeat(40), {
                budget: createRequestBudget({ maxRequests: 4, timeoutMs: 10_000 }),
                executeGit: async (args) => {
                    commands.push(args);
                    if (args.includes("init")) await fs.mkdir(args.at(-1), { recursive: true });
                    return { stdout: "" };
                }
            }),
            /Request budget exhausted/
        );
        assert.equal(commands.length, 4);
        assert.deepEqual(await fs.readdir(tempRoot), []);
    } finally {
        os.tmpdir = originalTmpdir;
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test("Git checkout preserves pinned SHA verification", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-pin-"));
    try {
        await assert.rejects(
            cloneRepoSecurely("https://github.com/owner/repo.git", tempDir, "a".repeat(40), {
                budget: createRequestBudget({ maxRequests: 5, timeoutMs: 10_000 }),
                executeGit: async args => ({ stdout: args.includes("rev-parse") ? `${"b".repeat(40)}\n` : "" })
            }),
            /Pinned Git checkout mismatch/
        );
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
