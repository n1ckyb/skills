/**
 * Skill Explorer GitHub & Remote Transport Module
 *
 * Responsibilities:
 * - Upstream catalog discovery and searching across canonical, AI hero, and directory registries.
 * - Secure GitHub Trees API and pinned Git transport cloning with SHA-1 validation.
 * - Enforcing bounds checks and calculating deterministic SHA-256 content digests for all skill sources.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    parseAndValidateGitHubUrl,
    parseGitHubTreeUrl,
    parseGitHubFolderSpec,
    parseSkillsRegistryUrl,
    getCanonicalSkillSlug,
    validatePathSafety,
    isSafeGitRef
} from "./url.mjs";
import {
    CANONICAL_SKILLS_REPO,
    CANONICAL_SKILLS_ROOT,
    CANONICAL_SKILLS_SITE,
    AI_HERO_SKILLS_REPO,
    AI_HERO_SKILLS_SITE,
    SKILLS_DIRECTORY_SITE
} from "./config.mjs";
import { validateFileBounds, calculateContentDigest } from "./vetting.mjs";
import { fetchJson, fetchText, createRequestBudget } from "./http.mjs";

/**
 * Resolves a skill folder inside a checkout and asserts it stays within that checkout.
 *
 * Callers already validate folder inputs, but this is the last gate before arbitrary filesystem reads,
 * so containment is enforced here unconditionally: a future caller that forgets to validate cannot turn
 * a traversal sequence into a local file disclosure.
 */
export function resolveContainedFolder(rootDir, folder) {
    const normalizedFolder = String(folder ?? "").replace(/^\/+|\/+$/g, "");
    if (!validatePathSafety(normalizedFolder)) {
        throw new Error(`Unsafe skill folder path rejected: '${folder}'`);
    }
    const rootResolved = path.resolve(rootDir);
    const folderDir = path.resolve(rootResolved, ...normalizedFolder.split("/"));
    if (folderDir !== rootResolved && !folderDir.startsWith(rootResolved + path.sep)) {
        throw new Error(`Skill folder '${folder}' escapes the checkout directory`);
    }
    return { normalizedFolder, folderDir };
}

const execFileAsync = promisify(execFile);

export { fetchJson, fetchText, createRequestBudget };

const revisionCache = new Map();
const REVISION_CACHE_TTL = 5 * 60 * 1000;
const REVISION_CACHE_MAX = 128;

export async function runGitCommand(args, options = {}) {
    options.budget?.take("gitCommands");
    options.budget?.count("childProcesses");
    const remainingMs = (options.budget?.deadline || Date.now() + 40_000) - Date.now();
    if (remainingMs <= 0) throw new Error("Operation request budget exhausted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
        const execute = options.executeGit || ((commandArgs, commandOptions) =>
            execFileAsync("git", commandArgs, commandOptions));
        return await execute(args, {
            timeout: remainingMs,
            signal: controller.signal,
            shell: false,
            windowsHide: true
        });
    } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") {
            throw new Error("Git transport exceeded the operation deadline");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export async function resolveCommitSha(owner, repo, ref = "main", options = {}) {
    if (/^[a-f0-9]{40}$/i.test(ref)) return ref.toLowerCase();
    // owner/repo and ref are interpolated into API paths and passed as git arguments below, so both are
    // validated here rather than relying on any particular caller having done it.
    const validatedRepo = parseAndValidateGitHubUrl(`${owner}/${repo}`);
    if (ref !== "HEAD" && !isSafeGitRef(ref)) {
        throw new Error(`Unsafe Git ref rejected: '${ref}'`);
    }
    const cacheKey = `${owner}/${repo}@${ref}`;
    const cached = revisionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.sha;
    try {
        const data = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, options);
        if (data.sha && /^[a-f0-9]{40}$/i.test(data.sha)) {
                const sha = data.sha.toLowerCase();
                revisionCache.set(cacheKey, { sha, expiresAt: Date.now() + REVISION_CACHE_TTL });
                while (revisionCache.size > REVISION_CACHE_MAX) revisionCache.delete(revisionCache.keys().next().value);
                return sha;
        }
    } catch {
        // Fallback to commit object if direct sha is nested
    }
    try {
        const commitData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1&sha=${encodeURIComponent(ref)}`, options);
        if (Array.isArray(commitData) && commitData[0]?.sha) {
            const sha = commitData[0].sha.toLowerCase();
            revisionCache.set(cacheKey, { sha, expiresAt: Date.now() + REVISION_CACHE_TTL });
            while (revisionCache.size > REVISION_CACHE_MAX) revisionCache.delete(revisionCache.keys().next().value);
            return sha;
        }
    } catch (err) {
        if (err?.message?.includes("budget") || err?.message?.includes("deadline")) {
            throw err;
        }
        // Fall back to Git transport when the GitHub API is rate-limited.
    }
    const validated = validatedRepo;
    const refs = ref === "HEAD" ? ["HEAD"] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
    const { stdout } = await runGitCommand(["ls-remote", validated.cloneUrl, ...refs], options);
    const match = stdout.split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .find(parts => parts.length === 2 && /^[a-f0-9]{40}$/i.test(parts[0]))?.[0];
    if (match) {
        return match.toLowerCase();
    }
    throw new Error(`Unable to resolve 40-character commit SHA for ${owner}/${repo} at ref '${ref}'`);
}

export async function cloneRepoSecurely(cloneUrl, targetDir, ref = null, options = {}) {
    const validated = parseAndValidateGitHubUrl(cloneUrl);
    if (!ref || !/^[a-f0-9]{40}$/i.test(ref)) {
        throw new Error("A resolved 40-character commit SHA is required before Git transport can fetch repository content.");
    }
    const commitSha = ref.toLowerCase();
    const gitOptions = ["-c", "protocol.version=2", "-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true"];
    await runGitCommand([...gitOptions, "init", "--quiet", targetDir], options);
    await runGitCommand([...gitOptions, "-C", targetDir, "remote", "add", "origin", validated.cloneUrl], options);
    await runGitCommand([...gitOptions, "-C", targetDir, "fetch", "--depth=1", "--no-tags", "origin", commitSha], options);
    await runGitCommand([...gitOptions, "-C", targetDir, "checkout", "--detach", "--quiet", "FETCH_HEAD"], options);

    const { stdout } = await runGitCommand(["-C", targetDir, "rev-parse", "HEAD"], options);
    if (stdout.trim().toLowerCase() !== commitSha) {
        throw new Error(`Pinned Git checkout mismatch: expected '${commitSha}', got '${stdout.trim().toLowerCase()}'.`);
    }
    return commitSha;
}

export async function cloneAndReadRepo(repoUrl, targetRevision = null, options = {}) {
    const validated = parseAndValidateGitHubUrl(repoUrl);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-vet-"));
    try {
        const commitSha = targetRevision || await resolveCommitSha(validated.owner, validated.repo, "HEAD", options);
        await cloneRepoSecurely(validated.cloneUrl, tempDir, commitSha, options);

        // Extract exact HEAD commit SHA
        const { stdout } = await runGitCommand(["-C", tempDir, "rev-parse", "HEAD"], options);
        const sourceRevision = stdout.trim().toLowerCase();

        const filesMap = {};
        async function readDir(dir, base = "") {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === ".git" || entry.name === ".gitmodules") continue;

                const fullPath = path.join(dir, entry.name);
                const relPath = base ? `${base}/${entry.name}` : entry.name;

                const lstat = await fs.lstat(fullPath);
                if (lstat.isSymbolicLink()) {
                    throw new Error(`Symlink detected and rejected: '${relPath}'`);
                }

                if (entry.isDirectory()) {
                    await readDir(fullPath, relPath);
                } else if (entry.isFile()) {
                    if (lstat.size > 1024 * 1024) {
                        throw new Error(`File size limit exceeded for '${relPath}': ${lstat.size} bytes (maximum 1 MiB)`);
                    }
                    const content = await fs.readFile(fullPath);
                    filesMap[relPath] = content;
                }
            }
        }

        await readDir(tempDir);
        validateFileBounds(filesMap);
        const contentDigest = calculateContentDigest(filesMap);

        return { tempDir, filesMap, sourceRevision, contentDigest };
    } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Failed to clone and read repository '${repoUrl}': ${err.message}`);
    }
}

export async function readCanonicalSkill(slug, targetRevision = null, options = {}) {
    const [owner, repo] = CANONICAL_SKILLS_REPO.split("/");
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, "main", options);
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
    const data = await fetchJson(treeUrl, options);

    const prefix = `${CANONICAL_SKILLS_ROOT}/${slug}/`;
    const treeItems = (data.tree || []).filter(item =>
        item.type === "blob" && item.path.startsWith(prefix)
    );

    if (!treeItems.some(item => item.path === `${prefix}SKILL.md`)) {
        throw new Error(`Canonical skill '${slug}' does not contain SKILL.md`);
    }

    const filesMap = {};
    await Promise.all(treeItems.map(async item => {
        const relativePath = item.path.slice(prefix.length);
        if (!validatePathSafety(relativePath)) {
            throw new Error(`Unsafe relative path '${relativePath}' in canonical skill`);
        }
        const rawUrl = `https://raw.githubusercontent.com/${CANONICAL_SKILLS_REPO}/${commitSha}/${item.path}`;
        const contentText = await fetchText(rawUrl, options);
        filesMap[relativePath] = Buffer.from(contentText, "utf8");
    }));

    validateFileBounds(filesMap);
    const contentDigest = calculateContentDigest(filesMap);

    return {
        filesMap,
        skillName: slug,
        vetScope: `${CANONICAL_SKILLS_REPO}/${prefix}`,
        provenance: "canonical",
        sourceRevision: commitSha,
        contentDigest
    };
}

export async function searchCanonicalSkills(query, options = {}) {
    const [owner, repo] = CANONICAL_SKILLS_REPO.split("/");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const data = await fetchJson(treeUrl, options);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    return (data.tree || [])
        .filter(item => item.type === "blob" && /^skills\/[^/]+\/SKILL\.md$/i.test(item.path))
        .map(item => {
            const slug = item.path.split("/")[1];
            const searchable = `${slug} ${item.path}`.toLowerCase();
            return { item, slug, searchable };
        })
        .filter(entry => terms.every(term => entry.searchable.includes(term)))
        .slice(0, 20)
        .map(({ item, slug }) => ({
            priorityTier: 0,
            trustTierLabel: "Priority 0: Canonical Awesome GitHub Copilot Skill",
            name: slug,
            fullName: `${CANONICAL_SKILLS_REPO}/${CANONICAL_SKILLS_ROOT}/${slug}`,
            description: `Official skill from ${CANONICAL_SKILLS_REPO}`,
            stars: null,
            url: `https://github.com/${CANONICAL_SKILLS_REPO}/tree/main/${CANONICAL_SKILLS_ROOT}/${slug}`,
            skillPageUrl: `https://awesome-copilot.github.com/skill/${slug}/`,
            rawSkillUrl: `https://raw.githubusercontent.com/${CANONICAL_SKILLS_REPO}/main/${item.path}`,
            sourceRepository: CANONICAL_SKILLS_REPO,
            vettingRequired: true,
            author: "github"
        }));
}

export async function searchAiHeroSkills(query, options = {}) {
    const [owner, repo] = AI_HERO_SKILLS_REPO.split("/");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const data = await fetchJson(treeUrl, options);
    const normalizedQuery = query.toLowerCase().trim();
    const sourceQuery = /^(?:ai[\s-]*hero|matt\s*pocock|mattpocock)(?:\s+skills?)?$/.test(normalizedQuery);
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return (data.tree || [])
        .filter(item =>
            item.type === "blob" &&
            /^skills\/(?:engineering|productivity|misc)\/[^/]+\/SKILL\.md$/i.test(item.path)
        )
        .map(item => {
            const segments = item.path.split("/");
            const category = segments[1];
            const slug = segments[2];
            return { item, category, slug, searchable: `${slug} ${category}`.toLowerCase() };
        })
        .filter(entry => sourceQuery || terms.every(term => entry.searchable.includes(term)))
        .slice(0, 20)
        .map(({ category, slug }) => ({
            priorityTier: 1,
            trustTierLabel: "Priority 1: AI Hero Skills by Matt Pocock",
            name: slug,
            fullName: `${AI_HERO_SKILLS_REPO}/skills/${category}/${slug}`,
            description: `AI Hero ${category} skill by Matt Pocock`,
            stars: null,
            url: `https://github.com/${AI_HERO_SKILLS_REPO}/tree/main/skills/${category}/${slug}`,
            skillPageUrl: AI_HERO_SKILLS_SITE,
            sourceRepository: AI_HERO_SKILLS_REPO,
            vettingRequired: true,
            author: "mattpocock"
        }));
}

export async function listTrendingSkills(period, limit, config, options = {}) {
    const paths = {
        trending24h: "/trending",
        hot: "/hot",
        alltime: "/"
    };
    const labels = {
        trending24h: "Trending (24h)",
        hot: "Hot",
        alltime: "All-time installs"
    };
    const pagePath = paths[period] || paths.trending24h;
    const html = await fetchText(`${SKILLS_DIRECTORY_SITE}${pagePath}`, options);
    const pattern = /<a\b[^>]*href="\/([^"?#/]+\/[^"?#/]+\/[^"?#/]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<p[^>]*>([^<]+)<\/p>[\s\S]*?<\/a>/gi;
    const results = [];
    const seen = new Set();
    let match;

    function decodeHtml(value) {
        return value
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, "\"")
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }

    while ((match = pattern.exec(html)) && results.length < limit) {
        const registryPath = decodeHtml(match[1]);
        if (seen.has(registryPath)) continue;
        seen.add(registryPath);

        const [owner, repo, slug] = registryPath.split("/");
        const repository = `${owner}/${repo}`;
        const org = owner.toLowerCase();
        const normalizedRepo = repository.toLowerCase();

        let sourcePriority = 5;
        let trustTierLabel = "Priority 5: Unverified Community";

        if (normalizedRepo === CANONICAL_SKILLS_REPO) {
            sourcePriority = 0;
            trustTierLabel = "Priority 0: Canonical Awesome GitHub Copilot Skill";
        } else if (normalizedRepo === AI_HERO_SKILLS_REPO) {
            sourcePriority = 1;
            trustTierLabel = "Priority 1: AI Hero Skills by Matt Pocock";
        } else if (["github", "copilot-extensions", "microsoft", "azure-samples"].includes(org)) {
            sourcePriority = 3;
            trustTierLabel = "Priority 3: Official Source (GitHub/Microsoft)";
        } else if (
            config.trustedOrgs.map(v => v.toLowerCase()).includes(org) ||
            config.trustedRepos.map(v => v.toLowerCase()).includes(normalizedRepo)
        ) {
            sourcePriority = 4;
            trustTierLabel = "Priority 4: Configured Trusted Source";
        }

        results.push({
            trendRank: results.length + 1,
            rankingPeriod: labels[period] || labels.trending24h,
            priorityTier: sourcePriority,
            trustTierLabel,
            name: decodeHtml(match[2]).trim() || slug,
            fullName: `${repository}/${slug}`,
            description: `${labels[period] || labels.trending24h} skill from ${repository}`,
            stars: null,
            url: `${SKILLS_DIRECTORY_SITE}/${registryPath}`,
            sourceRepository: repository,
            vettingRequired: true,
            author: owner
        });
    }

    if (results.length === 0) {
        throw new Error("The skills registry returned no parseable trending entries");
    }
    return results;
}

export async function searchSkillsDirectory(query, config, options = {}) {
    const terms = query.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
    const periods = ["alltime", "hot", "trending24h"];
    const settled = await Promise.allSettled(
        periods.map(period => listTrendingSkills(period, 50, config, options))
    );
    const sourceErrors = settled
        .map((result, index) => result.status === "rejected"
            ? {
                source: `${SKILLS_DIRECTORY_SITE}/${periods[index]}`,
                error: result.reason?.message || String(result.reason),
                statusCode: result.reason?.statusCode || null
            }
            : null)
        .filter(Boolean);
    const collections = settled
        .filter(result => result.status === "fulfilled")
        .map(result => result.value);
    if (collections.length === 0 && sourceErrors.length > 0) {
        const error = new Error("All skills directory sources failed.");
        error.sourceErrors = sourceErrors;
        throw error;
    }
    const seen = new Set();
    const results = [];

    for (const result of collections.flat()) {
        if (seen.has(result.fullName)) continue;
        seen.add(result.fullName);
        const searchable = `${result.name} ${result.fullName} ${result.description}`
            .toLowerCase()
            .replace(/[-_]+/g, " ");
        if (!terms.every(term => searchable.includes(term))) continue;
        results.push({
            ...result,
            priorityTier: 2,
            trustTierLabel: "Priority 2: The Agent Skills Directory",
            description: `Listed in The Agent Skills Directory; ${result.description}`,
            discoverySource: "skills.sh"
        });
    }

    const output = results.slice(0, 20);
    output.sourceErrors = sourceErrors;
    return output;
}

export async function readGitHubSkillFolder({ owner, repo, ref, folder }, targetRevision = null, options = {}) {
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, ref || "main", options);
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
    let data;
    try {
        data = await fetchJson(treeUrl, options);
    } catch (error) {
        if (!/HTTP 403|HTTP 429/i.test(error.message)) throw error;
        return readGitHubSkillFolderFromClone({ owner, repo, folder }, commitSha, options);
    }
    const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");
    const prefix = `${normalizedFolder}/`;

    const files = (data.tree || []).filter(item =>
        item.type === "blob" && item.path.startsWith(prefix)
    );

    if (!files.some(item => item.path === `${prefix}SKILL.md`)) {
        throw new Error(`GitHub folder '${owner}/${repo}/${normalizedFolder}' does not contain SKILL.md`);
    }

    async function readGitHubSkillFolderFromClone({ owner, repo, folder }, commitSha, options = {}) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-folder-vet-"));
        try {
            const validated = parseAndValidateGitHubUrl(`${owner}/${repo}`);
            await cloneRepoSecurely(validated.cloneUrl, tempDir, commitSha, options);
            const { normalizedFolder, folderDir } = resolveContainedFolder(tempDir, folder);
            const filesMap = {};
            async function readDir(dir, base = "") {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === ".git" || entry.name === ".gitmodules") continue;
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = base ? `${base}/${entry.name}` : entry.name;
                    const lstat = await fs.lstat(fullPath);
                    if (lstat.isSymbolicLink()) throw new Error(`Symlink detected and rejected: '${relativePath}'`);
                    if (entry.isDirectory()) await readDir(fullPath, relativePath);
                    else if (entry.isFile()) filesMap[relativePath] = await fs.readFile(fullPath);
                }
            }
            await readDir(folderDir);
            if (!filesMap["SKILL.md"]) {
                throw new Error(`GitHub folder '${owner}/${repo}/${normalizedFolder}' does not contain SKILL.md`);
            }
            validateFileBounds(filesMap);
            return {
                filesMap,
                skillName: normalizedFolder.split("/").at(-1),
                vetScope: `${owner}/${repo}/${normalizedFolder}/`,
                provenance: "github-folder",
                sourceRevision: commitSha,
                contentDigest: calculateContentDigest(filesMap)
            };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    const filesMap = {};
    await Promise.all(files.map(async item => {
        const relativePath = item.path.slice(prefix.length);
        if (!validatePathSafety(relativePath)) {
            throw new Error(`Unsafe relative path '${relativePath}' in GitHub skill folder`);
        }
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${item.path}`;
        const contentText = await fetchText(rawUrl, options);
        filesMap[relativePath] = Buffer.from(contentText, "utf8");
    }));

    validateFileBounds(filesMap);
    const contentDigest = calculateContentDigest(filesMap);

    return {
        filesMap,
        skillName: normalizedFolder.split("/").at(-1),
        vetScope: `${owner}/${repo}/${normalizedFolder}/`,
        provenance: "github-folder",
        sourceRevision: commitSha,
        contentDigest
    };
}

export async function readRegistrySkill({ owner, repo, slug }, targetRevision = null, options = {}) {
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, "main", options);
    let data;
    try {
        data = await fetchJson(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
            options
        );
    } catch (error) {
        if (!/HTTP 403|HTTP 429/i.test(error.message)) throw error;
        return readRegistrySkillFromClone({ owner, repo, slug }, commitSha, options);
    }

    const suffix = `/${slug}/SKILL.md`.toLowerCase();
    const candidates = (data.tree || [])
        .filter(item => item.type === "blob" && (`/${item.path.toLowerCase()}`).endsWith(suffix))
        .sort((a, b) => {
            const preferredRoots = ["skills/", ".agents/skills/", ".claude/skills/"];
            const aRank = preferredRoots.findIndex(root => a.path.toLowerCase().startsWith(root));
            const bRank = preferredRoots.findIndex(root => b.path.toLowerCase().startsWith(root));
            const normA = aRank === -1 ? preferredRoots.length : aRank;
            const normB = bRank === -1 ? preferredRoots.length : bRank;
            return normA - normB || a.path.length - b.path.length;
        });

    if (candidates.length === 0) {
        throw new Error(`Could not locate the '${slug}' SKILL.md in ${owner}/${repo}`);
    }

    async function readRegistrySkillFromClone({ owner, repo, slug }, commitSha, options = {}) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-registry-vet-"));
        try {
            const validated = parseAndValidateGitHubUrl(`${owner}/${repo}`);
            await cloneRepoSecurely(validated.cloneUrl, tempDir, commitSha, options);
            const matches = [];
            async function findSkillFiles(dir, relative = "") {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === ".git" || entry.name === ".gitmodules") continue;
                    const fullPath = path.join(dir, entry.name);
                    const next = relative ? `${relative}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        await findSkillFiles(fullPath, next);
                    } else if (entry.isFile() && entry.name === "SKILL.md" && path.posix.basename(relative).toLowerCase() === slug.toLowerCase()) {
                        matches.push(relative);
                    }
                }
            }
            await findSkillFiles(tempDir);
            const preferredRoots = ["skills/", ".agents/skills/", ".claude/skills/"];
            const folder = matches.sort((a, b) => {
                const rank = value => {
                    const index = preferredRoots.findIndex(root => value.toLowerCase().startsWith(root));
                    return index === -1 ? preferredRoots.length : index;
                };
                return rank(a) - rank(b) || a.length - b.length;
            })[0];
            if (!folder) throw new Error(`Could not locate the '${slug}' SKILL.md in ${owner}/${repo}`);
            return readSkillFolderFromWorkingTree(tempDir, folder, owner, repo, commitSha, "skills-registry");
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    async function readSkillFolderFromWorkingTree(rootDir, requestedFolder, owner, repo, commitSha, provenance) {
        const { normalizedFolder, folderDir } = resolveContainedFolder(rootDir, requestedFolder);
        const filesMap = {};
        async function readDir(dir, base = "") {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = base ? `${base}/${entry.name}` : entry.name;
                const lstat = await fs.lstat(fullPath);
                if (lstat.isSymbolicLink()) throw new Error(`Symlink detected and rejected: '${relativePath}'`);
                if (entry.isDirectory()) await readDir(fullPath, relativePath);
                else if (entry.isFile()) filesMap[relativePath] = await fs.readFile(fullPath);
            }
        }
        await readDir(folderDir);
        if (!filesMap["SKILL.md"]) throw new Error(`GitHub folder '${owner}/${repo}/${normalizedFolder}' does not contain SKILL.md`);
        validateFileBounds(filesMap);
        return {
            filesMap,
            skillName: normalizedFolder.split("/").at(-1),
            vetScope: `${owner}/${repo}/${normalizedFolder}/`,
            provenance,
            sourceRevision: commitSha,
            contentDigest: calculateContentDigest(filesMap)
        };
    }

    const skillFile = candidates[0].path;
    const folder = skillFile.slice(0, -"/SKILL.md".length);

    const result = await readGitHubSkillFolder({ owner, repo, ref: commitSha, folder }, commitSha, options);
    return {
        ...result,
        provenance: "skills-registry"
    };
}

export async function readSkillSource(repoOrUrl, targetRevision = null, options = {}) {
    if (targetRevision && typeof targetRevision === "object" && typeof options === "object" && Object.keys(options).length === 0) {
        options = targetRevision;
        targetRevision = null;
    }
    const canonicalSlug = getCanonicalSkillSlug(repoOrUrl);
    if (canonicalSlug) {
        return readCanonicalSkill(canonicalSlug, targetRevision, options);
    }

    const registrySkill = parseSkillsRegistryUrl(repoOrUrl);
    if (registrySkill) {
        return readRegistrySkill(registrySkill, targetRevision, options);
    }

    const githubFolder = parseGitHubTreeUrl(repoOrUrl);
    if (githubFolder) {
        return readGitHubSkillFolder(githubFolder, targetRevision, options);
    }

    const shorthandFolder = parseGitHubFolderSpec(repoOrUrl);
    if (shorthandFolder) {
        const parts = repoOrUrl.trim().replace(/\/+$/, "").split("/");
        if (parts.length === 3) {
            return readRegistrySkill({
                owner: shorthandFolder.owner,
                repo: shorthandFolder.repo,
                slug: parts[2]
            }, targetRevision, options);
        }
        return readGitHubSkillFolder({
            ...shorthandFolder,
            ref: "main"
        }, targetRevision, options);
    }

    const cloneResult = await cloneAndReadRepo(repoOrUrl, targetRevision, options);
    return {
        ...cloneResult,
        skillName: null,
        vetScope: repoOrUrl,
        provenance: "repository"
    };
}
