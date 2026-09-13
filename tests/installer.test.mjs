import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { installSkillAtomic } from "../extensions/skill-explorer/lib/installer.mjs";
import { DEFAULT_CONFIG } from "../extensions/skill-explorer/lib/config.mjs";
import { calculateContentDigest } from "../extensions/skill-explorer/lib/vetting.mjs";

const VALID_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

test("installSkillAtomic enforces confirmation requirements", async () => {
    const res = await installSkillAtomic({
        repoOrUrl: "owner/repo",
        scope: "user",
        userConfirmed: false,
        confirmationSummary: "",
        expectedRevision: VALID_SHA,
        expectedDigest: "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
        config: DEFAULT_CONFIG
    });

    assert.equal(res.status, "CONFIRMATION_REQUIRED");
});

test("installSkillAtomic validates expectedRevision and expectedDigest format", async () => {
    await assert.rejects(
        installSkillAtomic({
            repoOrUrl: "owner/repo",
            scope: "user",
            userConfirmed: true,
            confirmationSummary: "confirm",
            expectedRevision: "invalid-sha",
            expectedDigest: "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            config: DEFAULT_CONFIG
        }),
        /40-character commit SHA/i
    );

    await assert.rejects(
        installSkillAtomic({
            repoOrUrl: "owner/repo",
            scope: "user",
            userConfirmed: true,
            confirmationSummary: "confirm",
            expectedRevision: VALID_SHA,
            expectedDigest: "invalid-digest",
            config: DEFAULT_CONFIG
        }),
        /sha256:64-hex digest/i
    );
});

test("installSkillAtomic rejects revision mismatch and digest mismatch", async () => {
    const filesMap = { "SKILL.md": "name: test\n" };
    const correctDigest = calculateContentDigest(filesMap);

    const sourceOverride = {
        filesMap,
        skillName: "test-skill",
        provenance: "github-folder",
        vetScope: "owner/repo/skills/test-skill",
        sourceRevision: VALID_SHA,
        contentDigest: correctDigest
    };

    // Revision mismatch
    await assert.rejects(
        installSkillAtomic({
            repoOrUrl: "owner/repo",
            scope: "user",
            userConfirmed: true,
            confirmationSummary: "confirm",
            expectedRevision: "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5",
            expectedDigest: correctDigest,
            config: DEFAULT_CONFIG,
            sourceOverride
        }),
        /Revision mismatch/i
    );

    // Digest mismatch
    await assert.rejects(
        installSkillAtomic({
            repoOrUrl: "owner/repo",
            scope: "user",
            userConfirmed: true,
            confirmationSummary: "confirm",
            expectedRevision: VALID_SHA,
            expectedDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            config: DEFAULT_CONFIG,
            sourceOverride
        }),
        /Content digest mismatch/i
    );
});

test("installSkillAtomic blocks installation when risk threshold is met", async () => {
    const filesMap = { "SKILL.md": "child_process.execSync('whoami')\nprocess.env.AWS_SECRET\n" };
    const digest = calculateContentDigest(filesMap);

    const sourceOverride = {
        filesMap,
        skillName: "bad-skill",
        provenance: "github-folder",
        vetScope: "owner/repo/skills/bad-skill",
        sourceRevision: VALID_SHA,
        contentDigest: digest
    };

    const res = await installSkillAtomic({
        repoOrUrl: "owner/repo",
        scope: "user",
        userConfirmed: true,
        confirmationSummary: "confirm",
        expectedRevision: VALID_SHA,
        expectedDigest: digest,
        config: DEFAULT_CONFIG,
        sourceOverride
    });

    assert.equal(res.status, "INSTALLATION_BLOCKED");
});

test("installSkillAtomic performs atomic staging, verification, and collision detection", async () => {
    const tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-inst-test-"));
    const targetDir = path.join(tempTestDir, "test-skill");

    const filesMap = {
        "SKILL.md": "name: test-skill\n",
        "lib/index.js": "console.log('hello');"
    };
    const digest = calculateContentDigest(filesMap);

    const sourceOverride = {
        filesMap,
        skillName: "test-skill",
        provenance: "github-folder",
        vetScope: "owner/repo/skills/test-skill",
        sourceRevision: VALID_SHA,
        contentDigest: digest
    };

    // 1. Initial installation
    const res1 = await installSkillAtomic({
        repoOrUrl: "owner/repo",
        scope: "user",
        userConfirmed: true,
        confirmationSummary: "confirm",
        expectedRevision: VALID_SHA,
        expectedDigest: digest,
        config: DEFAULT_CONFIG,
        targetDirOverride: targetDir,
        sourceOverride
    });

    assert.equal(res1.status, "INSTALLED_SUCCESSFULLY");
    assert.equal(await fs.readFile(path.join(targetDir, "SKILL.md"), "utf8"), "name: test-skill\n");

    // 2. Re-installation with same digest -> ALREADY_INSTALLED
    const res2 = await installSkillAtomic({
        repoOrUrl: "owner/repo",
        scope: "user",
        userConfirmed: true,
        confirmationSummary: "confirm",
        expectedRevision: VALID_SHA,
        expectedDigest: digest,
        config: DEFAULT_CONFIG,
        targetDirOverride: targetDir,
        sourceOverride
    });

    assert.equal(res2.status, "ALREADY_INSTALLED");

    // 3. Collision with differing content digest -> rejects with error
    const differingFilesMap = { "SKILL.md": "name: altered-skill\n" };
    const differingDigest = calculateContentDigest(differingFilesMap);
    const sourceOverride2 = {
        filesMap: differingFilesMap,
        skillName: "test-skill",
        provenance: "github-folder",
        vetScope: "owner/repo/skills/test-skill",
        sourceRevision: VALID_SHA,
        contentDigest: differingDigest
    };

    await assert.rejects(
        installSkillAtomic({
            repoOrUrl: "owner/repo",
            scope: "user",
            userConfirmed: true,
            confirmationSummary: "confirm",
            expectedRevision: VALID_SHA,
            expectedDigest: differingDigest,
            config: DEFAULT_CONFIG,
            targetDirOverride: targetDir,
            sourceOverride: sourceOverride2
        }),
        /already exists with a different content digest/i
    );

    // Clean up
    await fs.rm(tempTestDir, { recursive: true, force: true });
});
