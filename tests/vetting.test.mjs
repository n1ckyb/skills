import { test } from "node:test";
import assert from "node:assert/strict";
import { vetFilesMap } from "../extensions/skill-explorer/lib/vetting.mjs";
import { DEFAULT_CONFIG } from "../extensions/skill-explorer/lib/config.mjs";

test("vetFilesMap flags dangerous execution and credential exfiltration", () => {
    const filesMap = {
        "SKILL.md": "# Test Skill\n\n```js\nchild_process.execSync('whoami');\nconst token = process.env.GITHUB_TOKEN;\n```\n"
    };

    const res = vetFilesMap(filesMap, "owner/repo", DEFAULT_CONFIG);
    assert.equal(res.isBlocked, true);
    assert.ok(res.riskScore >= 50);
    assert.equal(res.findings.length, 2);
    assert.equal(res.findings[0].ruleId, "DANGEROUS_EXECUTION");
    assert.equal(res.findings[1].ruleId, "CREDENTIAL_EXFILTRATION");
});

test("vetFilesMap deduplicates repeated matches of same rule in same file", () => {
    const lines = [];
    for (let i = 0; i < 10; i++) {
        lines.push(`execSync('cmd${i}');`);
    }
    const filesMap = {
        "script.js": lines.join("\n")
    };

    const res = vetFilesMap(filesMap, "owner/repo", DEFAULT_CONFIG);
    assert.equal(res.findings.length, 10);
    assert.equal(res.riskScore, 45);
});

test("vetFilesMap ensures trust priority does NOT discount risk score or bypass blocking", () => {
    const filesMap = {
        "SKILL.md": "process.env.AWS_SECRET\nchild_process.spawn('sh')\n"
    };

    const configWithTrusted = {
        ...DEFAULT_CONFIG,
        trustedRepos: ["github/awesome-copilot"]
    };

    const res = vetFilesMap(filesMap, "github/awesome-copilot", configWithTrusted);
    assert.equal(res.isWhitelisted, true);
    assert.equal(res.isBlocked, true);
    assert.ok(res.riskScore >= 50);
});

test("vetFilesMap returns SAFE status when no dangerous rules trigger", () => {
    const filesMap = {
        "SKILL.md": "# Pure Skill\n\nThis is a documentation skill with no executable code.\n"
    };

    const res = vetFilesMap(filesMap, "owner/repo", DEFAULT_CONFIG);
    assert.equal(res.isBlocked, false);
    assert.equal(res.riskScore, 0);
    assert.equal(res.status, "SAFE");
});
