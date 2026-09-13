import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseAndValidateGitHubUrl,
    parseGitHubTreeUrl,
    parseGitHubFolderSpec,
    parseSkillsRegistryUrl,
    getCanonicalSkillSlug,
    validatePathSafety,
    isSafeGitRef
} from "../extensions/skill-explorer/lib/url.mjs";
import { cloneRepoSecurely, resolveContainedFolder, resolveCommitSha, readSkillSource } from "../extensions/skill-explorer/lib/github.mjs";

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

test("parseGitHubTreeUrl rejects traversal, dotgit folders and unsafe refs", () => {
    const malicious = [
        "https://github.com/o/r/tree/main/../../etc",
        "https://github.com/o/r/tree/main/skills/../../../secret",
        "https://github.com/o/r/tree/main/.git/config",
        "https://github.com/o/r/tree/--upload-pack=touch/skills/x",
        "https://github.com/o/r/tree/a..b/skills/x",
        "https://github.com/o@evil/r/tree/main/skills/x",
        "https://github.com/o/r r/tree/main/skills/x"
    ];
    for (const url of malicious) {
        assert.equal(parseGitHubTreeUrl(url), null, `expected null for ${url}`);
    }
});

test("parseGitHubTreeUrl still parses legitimate tree URLs", () => {
    assert.deepEqual(parseGitHubTreeUrl("https://github.com/github/awesome-copilot/tree/main/skills/diagnose"), {
        owner: "github",
        repo: "awesome-copilot",
        ref: "main",
        folder: "skills/diagnose"
    });
    const withSlashRef = parseGitHubTreeUrl("https://github.com/o/r.git/tree/release/v1/skills/a");
    assert.equal(withSlashRef.repo, "r");
});

test("isSafeGitRef rejects option-like and malformed refs", () => {
    for (const ref of ["--upload-pack=touch", "-x", "a..b", "/main", "main/", "main.lock", "ma in", "", null]) {
        assert.equal(isSafeGitRef(ref), false, `expected ${ref} to be unsafe`);
    }
    for (const ref of ["main", "release/v1.2.0", "feature_x-1"]) {
        assert.equal(isSafeGitRef(ref), true, `expected ${ref} to be safe`);
    }
});

test("resolveContainedFolder blocks any path escaping the checkout root", () => {
    const root = process.platform === "win32" ? "C:\\tmp\\root" : "/tmp/root";
    for (const folder of ["../../etc", "skills/../../x", ".git/config", "..\\..\\x"]) {
        assert.throws(() => resolveContainedFolder(root, folder), /Unsafe skill folder path|escapes the checkout/);
    }
    const ok = resolveContainedFolder(root, "/skills/diagnose/");
    assert.equal(ok.normalizedFolder, "skills/diagnose");
    assert.ok(ok.folderDir.endsWith("diagnose"));
});

test("resolveCommitSha refuses option-like refs before invoking git", async () => {
    await assert.rejects(
        () => resolveCommitSha("o", "r", "--upload-pack=touch"),
        /Unsafe Git ref rejected/
    );
});

test("readSkillSource rejects traversal tree URLs at the public entry point", async () => {
    for (const url of ["https://github.com/o/r/tree/main/../../etc", "https://github.com/o/r/tree/main/.git/config"]) {
        await assert.rejects(() => readSkillSource(url, null, {}));
    }
});

test("parseSkillsRegistryUrl rejects owners, repos and slugs with unsafe characters", () => {
    for (const url of [
        "https://skills.sh/o@evil/r/s",
        "https://skills.sh/o/r/../../etc",
        "https://skills.sh/o/r%2F../s"
    ]) {
        assert.equal(parseSkillsRegistryUrl(url), null, `expected null for ${url}`);
    }
});
