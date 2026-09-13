import { test } from "node:test";
import assert from "node:assert/strict";
import { executeInstallation } from "../extensions/skill-explorer/lib/installation-flow.mjs";
import { DEFAULT_CONFIG } from "../extensions/skill-explorer/lib/config.mjs";

const revision = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const digest = "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff";
const source = "owner/repo/skills/example";

test("executeInstallation requires a confirmation bound to the vetting receipt", async () => {
    const result = await executeInstallation({
        action: "install",
        repoOrUrl: source,
        scope: "user",
        userConfirmed: true,
        confirmationSummary: "yes",
        expectedRevision: revision,
        expectedDigest: digest,
        config: DEFAULT_CONFIG
    });

    assert.equal(result.status, "CONFIRMATION_REQUIRED");
});

test("executeInstallation reserves replacement for tracked synchronization", async () => {
    await assert.rejects(
        executeInstallation({
            action: "install",
            repoOrUrl: source,
            scope: "user",
            userConfirmed: true,
            confirmationSummary: `${source} user ${revision} ${digest}`,
            expectedRevision: revision,
            expectedDigest: digest,
            config: DEFAULT_CONFIG,
            replaceExisting: true
        }),
        /Use sync/i
    );
});
