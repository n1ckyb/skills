import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(rootDir, "tests");
const testFiles = (await readdir(testsDir))
    .filter(file => file.endsWith(".test.mjs"))
    .sort()
    .map(file => path.join(testsDir, file));

if (testFiles.length === 0) {
    throw new Error(`No test files found in ${testsDir}`);
}

const child = spawn(process.execPath, ["--test", ...testFiles], {
    cwd: rootDir,
    stdio: "inherit",
    // The test harness must never write telemetry classified as production.
    env: { ...process.env, SKILL_EXPLORER_ORIGIN: "test" }
});

child.on("error", error => {
    console.error(error);
    process.exitCode = 1;
});

child.on("exit", (code, signal) => {
    process.exitCode = code ?? 1;
    if (signal) {
        console.error(`Test process terminated by ${signal}`);
    }
});
