import path from "node:path";

/**
 * Skill Explorer URL Parsing & Path Safety Validation Module
 *
 * Responsibilities:
 * - Parsing and strictly validating GitHub repository URLs, shorthand paths, tree links, and registry URLs.
 * - Restricting allowed protocols to HTTPS and rejecting file://, http://, and git@ protocols.
 * - Enforcing input sanitation against shell command injection and control characters.
 * - Enforcing relative filesystem path safety (rejecting absolute paths, directory traversal "../", and .git paths).
 */

export function parseAndValidateGitHubUrl(inputUrl) {
    if (typeof inputUrl !== "string") {
        throw new Error("URL or repository input must be a string");
    }
    const trimmed = inputUrl.trim();
    if (!trimmed) {
        throw new Error("URL or repository input cannot be empty");
    }

    // Explicitly reject prohibited schemes, protocols, local paths, and injection characters
    if (/^git@/i.test(trimmed)) {
        throw new Error("SSH URLs (git@) are not permitted; use HTTPS or 'owner/repo'");
    }
    if (/^http:\/\//i.test(trimmed)) {
        throw new Error("Insecure HTTP URLs are not permitted; use HTTPS");
    }
    if (/^file:\/\//i.test(trimmed)) {
        throw new Error("File URLs (file://) are not permitted");
    }
    if (/^[a-zA-Z]:\\/i.test(trimmed) || /^\//.test(trimmed) || /^\.\.?[/\\]/.test(trimmed)) {
        throw new Error("Local directory paths are not permitted");
    }

    // Check for shell injection characters or control characters
    if (/[\s;`$|&><\0]/.test(trimmed)) {
        throw new Error("Input contains unsafe shell or control characters");
    }

    if (/^https:\/\//i.test(trimmed)) {
        let parsed;
        try {
            parsed = new URL(trimmed);
        } catch (e) {
            throw new Error(`Invalid URL structure: ${e.message}`);
        }

        if (parsed.protocol !== "https:") {
            throw new Error("Only HTTPS scheme is permitted");
        }
        if (parsed.hostname.toLowerCase() !== "github.com") {
            throw new Error(`Host '${parsed.hostname}' is not permitted. Only github.com is allowed`);
        }
        if (parsed.username || parsed.password) {
            throw new Error("URL credentials (user:pass) are not permitted");
        }
        if (parsed.search) {
            throw new Error("URL query parameters are not permitted");
        }
        if (parsed.hash) {
            throw new Error("URL fragments are not permitted");
        }
        if (parsed.port && parsed.port !== "443") {
            throw new Error("Non-standard ports are not permitted");
        }

        const pathname = parsed.pathname.replace(/\/+$/, "");
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length < 2) {
            throw new Error("GitHub URL must include both owner and repository name");
        }

        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, "");

        if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
            throw new Error("Invalid owner or repository name characters");
        }

        return {
            owner,
            repo,
            cloneUrl: `https://github.com/${owner}/${repo}.git`,
            canonicalUrl: `https://github.com/${owner}/${repo}`
        };
    }

    // Validate shorthand owner/repo format
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        const [owner, rawRepo] = trimmed.split("/");
        const repo = rawRepo.replace(/\.git$/i, "");
        return {
            owner,
            repo,
            cloneUrl: `https://github.com/${owner}/${repo}.git`,
            canonicalUrl: `https://github.com/${owner}/${repo}`
        };
    }

    throw new Error("Invalid GitHub repository specification. Expected 'owner/repo' or 'https://github.com/owner/repo'");
}

const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Parses a GitHub tree URL into its owner, repo, ref, and folder.
 *
 * Every component is validated here rather than at the call site: the folder flows into filesystem
 * joins during the Git clone fallback, and the ref flows into `git ls-remote` arguments. Returns null
 * on any unsafe component so callers fall through to their next resolution strategy.
 */
export function parseGitHubTreeUrl(repoOrUrl) {
    if (typeof repoOrUrl !== "string") return null;
    const trimmed = repoOrUrl.trim().replace(/\/+$/, "");
    const match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/i);
    if (!match) return null;
    const [, owner, rawRepo, ref, folder] = match;
    const repo = rawRepo.replace(/\.git$/i, "");
    if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) return null;
    if (!isSafeGitRef(ref)) return null;
    if (!validatePathSafety(folder)) return null;
    return { owner, repo, ref, folder };
}

/**
 * A Git ref must never be mistaken for a command-line option by `git ls-remote`, and must not contain
 * path traversal or characters that Git itself rejects.
 */
export function isSafeGitRef(ref) {
    if (typeof ref !== "string" || !ref) return false;
    if (ref.startsWith("-")) return false;
    if (!/^[a-zA-Z0-9_.\-/]+$/.test(ref)) return false;
    if (ref.includes("..") || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".lock")) return false;
    return true;
}

export function parseGitHubFolderSpec(repoOrUrl) {
    const value = repoOrUrl.trim().replace(/\/+$/, "");
    const parts = value.split("/");
    if (parts.length < 3 || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part))) return null;
    const folder = parts.slice(2).join("/");
    if (!validatePathSafety(folder)) return null;
    return {
        owner: parts[0],
        repo: parts[1].replace(/\.git$/i, ""),
        folder
    };
}

export function parseSkillsRegistryUrl(repoOrUrl) {
    if (typeof repoOrUrl !== "string") return null;
    const trimmed = repoOrUrl.trim().replace(/\/+$/, "");
    const match = trimmed.match(/^https:\/\/(?:www\.)?skills\.sh\/([^/]+)\/([^/]+)\/([^/]+)$/i);
    if (!match) return null;
    const [, owner, rawRepo, slug] = match;
    const repo = rawRepo.replace(/\.git$/i, "");
    if (![owner, repo, slug].every(part => GITHUB_NAME_PATTERN.test(part))) return null;
    return { owner, repo, slug };
}

export function getCanonicalSkillSlug(repoOrUrl) {
    const value = repoOrUrl.trim().replace(/\/+$/, "");
    const patterns = [
        /^github\/awesome-copilot\/skills\/([a-z0-9._-]+)$/i,
        /^https:\/\/github\.com\/github\/awesome-copilot\/tree\/[a-z0-9._-]+\/skills\/([a-z0-9._-]+)$/i,
        /^https:\/\/awesome-copilot\.github\.com\/skill\/([a-z0-9._-]+)$/i,
        /^https:\/\/raw\.githubusercontent\.com\/github\/awesome-copilot\/[a-z0-9._-]+\/skills\/([a-z0-9._-]+)\/SKILL\.md$/i
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return match[1];
    }
    return null;
}

export function validatePathSafety(relPath) {
    if (typeof relPath !== "string") return false;
    if (path.win32.isAbsolute(relPath) || path.posix.isAbsolute(relPath)) return false;
    const normalized = relPath.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) return false;
    if (normalized === ".." || normalized.endsWith("/..")) return false;
    if (normalized === ".git" || normalized.startsWith(".git/") || normalized === ".gitmodules" || normalized.includes("/.git/")) return false;
    return true;
}
