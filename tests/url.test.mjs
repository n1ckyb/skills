import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseAndValidateGitHubUrl,
    parseGitHubTreeUrl,
    parseGitHubFolderSpec,
    parseSkillsRegistryUrl,
    getCanonicalSkillSlug,
    validatePathSafety
} from "../extensions/skill-explorer/lib/url.mjs";
import { cloneRepoSecurely } from "../extensions/skill-explorer/lib/github.mjs";

test("parseAndValidateGitHubUrl accepts valid owner/repo and https URLs", () => {
    const r1 = parseAndValidateGitHubUrl("github/awesome-copilot");
    assert.equal(r1.owner, "github");
    assert.equal(r1.repo, "awesome-copilot");
    assert.equal(r1.cloneUrl, "https://github.com/github/awesome-copilot.git");

    const r2 = parseAndValidateGitHubUrl("https://github.com/mattpocock/skills.git");
    assert.equal(r2.owner, "mattpocock");
    assert.equal(r2.repo, "skills");
    assert.equal(r2.cloneUrl, "https://github.com/mattpocock/skills.git");
});

test("parseAndValidateGitHubUrl rejects unsafe schemes and protocols", () => {
    assert.throws(() => parseAndValidateGitHubUrl("git@github.com:user/repo.git"), /SSH URLs/i);
    assert.throws(() => parseAndValidateGitHubUrl("http://github.com/user/repo"), /Insecure HTTP/i);
    assert.throws(() => parseAndValidateGitHubUrl("file:///C:/path/to/repo"), /File URLs/i);
    assert.throws(() => parseAndValidateGitHubUrl("C:\\Windows\\System32"), /Local directory/i);
    assert.throws(() => parseAndValidateGitHubUrl("../relative/path"), /Local directory/i);
});

test("parseAndValidateGitHubUrl rejects credentials, query params, fragments, non-standard ports, and non-github hosts", () => {
    assert.throws(() => parseAndValidateGitHubUrl("https://user:pass@github.com/user/repo"), /credentials/i);
    assert.throws(() => parseAndValidateGitHubUrl("https://github.com/user/repo?query=1"), /query parameters/i);
    assert.throws(() => parseAndValidateGitHubUrl("https://github.com/user/repo#fragment"), /fragments/i);
    assert.throws(() => parseAndValidateGitHubUrl("https://github.com:8443/user/repo"), /Non-standard ports/i);
    assert.throws(() => parseAndValidateGitHubUrl("https://gitlab.com/user/repo"), /github.com is allowed/i);
});

test("parseAndValidateGitHubUrl rejects shell injection characters", () => {
    assert.throws(() => parseAndValidateGitHubUrl("owner/repo; rm -rf /"), /unsafe shell/i);
    assert.throws(() => parseAndValidateGitHubUrl("owner/repo && echo hack"), /unsafe shell/i);
    assert.throws(() => parseAndValidateGitHubUrl("owner/repo | cat /etc/passwd"), /unsafe shell/i);
});

test("parseGitHubTreeUrl, parseSkillsRegistryUrl, and getCanonicalSkillSlug", () => {
    const tree = parseGitHubTreeUrl("https://github.com/github/awesome-copilot/tree/main/skills/steno-mode");
    assert.deepEqual(tree, {
        owner: "github",
        repo: "awesome-copilot",
        ref: "main",
        folder: "skills/steno-mode"
    });

    const reg = parseSkillsRegistryUrl("https://skills.sh/vercel/ai/rag");
    assert.deepEqual(reg, { owner: "vercel", repo: "ai", slug: "rag" });

    assert.equal(getCanonicalSkillSlug("github/awesome-copilot/skills/steno-mode"), "steno-mode");
    assert.equal(getCanonicalSkillSlug("https://awesome-copilot.github.com/skill/steno-mode"), "steno-mode");
    assert.equal(getCanonicalSkillSlug("mattpocock/skills"), null);
});

test("parseGitHubFolderSpec accepts nested shorthand skill paths", () => {
    assert.deepEqual(parseGitHubFolderSpec("mattpocock/skills/skills/engineering/code-review"), {
        owner: "mattpocock",
        repo: "skills",
        folder: "skills/engineering/code-review"
    });
    assert.equal(parseGitHubFolderSpec("owner/repo"), null);
    assert.equal(parseGitHubFolderSpec("owner/repo/../unsafe"), null);
});

test("validatePathSafety enforces relative path constraints", () => {
    assert.equal(validatePathSafety("SKILL.md"), true);
    assert.equal(validatePathSafety("lib/helpers.js"), true);

    assert.equal(validatePathSafety("../outside.js"), false);
    assert.equal(validatePathSafety("folder/../../outside.js"), false);
    assert.equal(validatePathSafety("/absolute/path"), false);
    assert.equal(validatePathSafety("C:\\Windows"), false);
    assert.equal(validatePathSafety(".git/config"), false);
    assert.equal(validatePathSafety(".gitmodules"), false);
});

test("cloneRepoSecurely rejects unpinned Git transport", async () => {
    await assert.rejects(
        cloneRepoSecurely("owner/repo", "unused-target", "main"),
        /40-character commit SHA/i
    );
});
