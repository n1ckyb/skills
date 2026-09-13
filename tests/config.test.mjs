import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../extension/lib/config.mjs";

test("loadConfig returns default config and creates file when missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-test-"));
    const configPath = path.join(tempDir, "sub", "config.json");

    const cfg = await loadConfig(configPath);
    assert.equal(cfg.maxRiskThreshold, 50);
    assert.equal(await fs.readFile(configPath, "utf8").then(t => JSON.parse(t).maxRiskThreshold), 50);

    await fs.rm(tempDir, { recursive: true, force: true });
});

test("loadConfig throws explicit error when config file contains malformed JSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-test-"));
    const configPath = path.join(tempDir, "config.json");

    await fs.writeFile(configPath, "{ malformed json...", "utf8");

    await assert.rejects(
        loadConfig(configPath),
        /Malformed configuration JSON/i
    );

    await fs.rm(tempDir, { recursive: true, force: true });
});
