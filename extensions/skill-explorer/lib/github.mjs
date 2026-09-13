import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    parseAndValidateGitHubUrl,
    parseGitHubTreeUrl,
    parseGitHubFolderSpec,
    parseSkillsRegistryUrl,
    getCanonicalSkillSlug,
    validatePathSafety
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

const execFileAsync = promisify(execFile);

export function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                "User-Agent": "Copilot-Skill-Explorer",
                "Accept": "application/vnd.github.v3+json"
            }
        };
        https.get(url, options, (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error(`JSON parse error: ${e.message}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                }
            });
        }).on("error", (err) => reject(err));
    });
}

export function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                "User-Agent": "Copilot-Skill-Explorer",
                "Accept": "text/plain"
            }
        }, (res) => {
            let body = "";
            res.on("data", chunk => { body += chunk; });
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                }
            });
        }).on("error", reject);
    });
}

export async function resolveCommitSha(owner, repo, ref = "main") {
    try {
        const data = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
        if (data.sha && /^[a-f0-9]{40}$/i.test(data.sha)) {
            return data.sha.toLowerCase();
        }
    } catch {
        // Fallback to commit object if direct sha is nested
    }
    try {
        const commitData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1&sha=${encodeURIComponent(ref)}`);
        if (Array.isArray(commitData) && commitData[0]?.sha) {
            return commitData[0].sha.toLowerCase();
        }
    } catch {
        // Fall back to Git transport when the GitHub API is rate-limited.
    }
    const validated = parseAndValidateGitHubUrl(`${owner}/${repo}`);
    const { stdout } = await execFileAsync("git", ["ls-remote", validated.cloneUrl, `refs/heads/${ref}`, `refs/tags/${ref}`], {
        timeout: 40000,
        shell: false,
        windowsHide: true
    });
    const match = stdout.split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .find(parts => parts.length === 2 && /^[a-f0-9]{40}$/i.test(parts[0]))?.[0];
    if (match) {
        return match.toLowerCase();
    }
    throw new Error(`Unable to resolve 40-character commit SHA for ${owner}/${repo} at ref '${ref}'`);
}

export async function cloneRepoSecurely(cloneUrl, targetDir, ref = null) {
    const validated = parseAndValidateGitHubUrl(cloneUrl);
    const args = ["clone", "--depth", "1", "--single-branch"];
    if (ref) {
        args.push("--branch", ref);
    }
    args.push(validated.cloneUrl, targetDir);

    await execFileAsync("git", args, {
        timeout: 40000,
        shell: false,
        windowsHide: true
    });
}

export async function cloneAndReadRepo(repoUrl, targetRevision = null) {
    const validated = parseAndValidateGitHubUrl(repoUrl);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-vet-"));
    try {
        await cloneRepoSecurely(validated.cloneUrl, tempDir, targetRevision);

        // Extract exact HEAD commit SHA
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
            cwd: tempDir,
            shell: false,
            windowsHide: true
        });
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

export async function readCanonicalSkill(slug, targetRevision = null) {
    const [owner, repo] = CANONICAL_SKILLS_REPO.split("/");
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, "main");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
    const data = await fetchJson(treeUrl);

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
        const contentText = await fetchText(rawUrl);
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

export async function searchCanonicalSkills(query) {
    const [owner, repo] = CANONICAL_SKILLS_REPO.split("/");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const data = await fetchJson(treeUrl);
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

export async function searchAiHeroSkills(query) {
    const [owner, repo] = AI_HERO_SKILLS_REPO.split("/");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const data = await fetchJson(treeUrl);
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

export async function listTrendingSkills(period, limit, config) {
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
    const html = await fetchText(`${SKILLS_DIRECTORY_SITE}${pagePath}`);
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

export async function searchSkillsDirectory(query, config) {
    const terms = query.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
    const collections = await Promise.all([
        listTrendingSkills("alltime", 50, config).catch(() => []),
        listTrendingSkills("hot", 50, config).catch(() => []),
        listTrendingSkills("trending24h", 50, config).catch(() => [])
    ]);
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

    return results.slice(0, 20);
}

export async function readGitHubSkillFolder({ owner, repo, ref, folder }, targetRevision = null) {
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, ref || "main");
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
    let data;
    try {
        data = await fetchJson(treeUrl);
    } catch (error) {
        if (!/HTTP 403|HTTP 429/i.test(error.message)) throw error;
        return readGitHubSkillFolderFromClone({ owner, repo, folder }, commitSha);
    }
    const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");
    const prefix = `${normalizedFolder}/`;

    const files = (data.tree || []).filter(item =>
        item.type === "blob" && item.path.startsWith(prefix)
    );

    if (!files.some(item => item.path === `${prefix}SKILL.md`)) {
        throw new Error(`GitHub folder '${owner}/${repo}/${normalizedFolder}' does not contain SKILL.md`);
    }

    async function readGitHubSkillFolderFromClone({ owner, repo, folder }, commitSha) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-folder-vet-"));
        try {
            const validated = parseAndValidateGitHubUrl(`${owner}/${repo}`);
            await cloneRepoSecurely(validated.cloneUrl, tempDir);
            await execFileAsync("git", ["fetch", "--depth", "1", "origin", commitSha], {
                cwd: tempDir,
                timeout: 40000,
                shell: false,
                windowsHide: true
            });
            await execFileAsync("git", ["checkout", "--detach", commitSha], {
                cwd: tempDir,
                timeout: 40000,
                shell: false,
                windowsHide: true
            });
            const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");
            const folderDir = path.join(tempDir, ...normalizedFolder.split("/"));
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
        const contentText = await fetchText(rawUrl);
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

export async function readRegistrySkill({ owner, repo, slug }, targetRevision = null) {
    const commitSha = targetRevision || await resolveCommitSha(owner, repo, "main");
    let data;
    try {
        data = await fetchJson(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`
        );
    } catch (error) {
        if (!/HTTP 403|HTTP 429/i.test(error.message)) throw error;
        return readRegistrySkillFromClone({ owner, repo, slug }, commitSha);
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

    async function readRegistrySkillFromClone({ owner, repo, slug }, commitSha) {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-registry-vet-"));
        try {
            const validated = parseAndValidateGitHubUrl(`${owner}/${repo}`);
            await cloneRepoSecurely(validated.cloneUrl, tempDir);
            await execFileAsync("git", ["fetch", "--depth", "1", "origin", commitSha], {
                cwd: tempDir,
                timeout: 40000,
                shell: false,
                windowsHide: true
            });
            await execFileAsync("git", ["checkout", "--detach", commitSha], {
                cwd: tempDir,
                timeout: 40000,
                shell: false,
                windowsHide: true
            });
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

    async function readSkillFolderFromWorkingTree(rootDir, normalizedFolder, owner, repo, commitSha, provenance) {
        const folderDir = path.join(rootDir, ...normalizedFolder.split("/"));
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

    const result = await readGitHubSkillFolder({ owner, repo, ref: commitSha, folder }, commitSha);
    return {
        ...result,
        provenance: "skills-registry"
    };
}

export async function readSkillSource(repoOrUrl, targetRevision = null) {
    const canonicalSlug = getCanonicalSkillSlug(repoOrUrl);
    if (canonicalSlug) {
        return readCanonicalSkill(canonicalSlug, targetRevision);
    }

    const registrySkill = parseSkillsRegistryUrl(repoOrUrl);
    if (registrySkill) {
        return readRegistrySkill(registrySkill, targetRevision);
    }

    const githubFolder = parseGitHubTreeUrl(repoOrUrl);
    if (githubFolder) {
        return readGitHubSkillFolder(githubFolder, targetRevision);
    }

    const shorthandFolder = parseGitHubFolderSpec(repoOrUrl);
    if (shorthandFolder) {
        const parts = repoOrUrl.trim().replace(/\/+$/, "").split("/");
        if (parts.length === 3) {
            return readRegistrySkill({
                owner: shorthandFolder.owner,
                repo: shorthandFolder.repo,
                slug: parts[2]
            }, targetRevision);
        }
        return readGitHubSkillFolder({
            ...shorthandFolder,
            ref: "main"
        }, targetRevision);
    }

    const cloneResult = await cloneAndReadRepo(repoOrUrl, targetRevision);
    return {
        ...cloneResult,
        skillName: null,
        vetScope: repoOrUrl,
        provenance: "repository"
    };
}
