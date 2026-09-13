import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { readSkillSource } from "./github.mjs";
import { vetFilesMap, calculateContentDigest, validateFileBounds } from "./vetting.mjs";
import { saveInstalledRecord } from "./config.mjs";

export async function scanDirectoryFiles(dirPath) {
    const filesMap = {};
    async function scan(currentDir, base = "") {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = base ? `${base}/${entry.name}` : entry.name;
            const lstat = await fs.lstat(fullPath);
            if (lstat.isSymbolicLink()) {
                throw new Error(`Symlink detected in directory: '${relPath}'`);
            }
            if (entry.isDirectory()) {
                if (entry.name === ".git" || entry.name === ".gitmodules") continue;
                await scan(fullPath, relPath);
            } else if (entry.isFile()) {
                const content = await fs.readFile(fullPath);
                filesMap[relPath] = content;
            }
        }
    }
    await scan(dirPath);
    return filesMap;
}

export async function installSkillAtomic({
    repoOrUrl,
    scope,
    userConfirmed,
    confirmationSummary,
    expectedRevision,
    expectedDigest,
    config,
    targetDirOverride = null,
    sourceOverride = null
}) {
    if (userConfirmed !== true || !confirmationSummary?.trim()) {
        return {
            status: "CONFIRMATION_REQUIRED",
            reason: "Ask the user an explicit installation confirmation question containing the skill, source, scope, expectedRevision, expectedDigest, and vetting result before calling this tool."
        };
    }

    if (!expectedRevision || !/^[a-f0-9]{40}$/i.test(expectedRevision.trim())) {
        throw new Error("Invalid or missing expectedRevision. A 40-character commit SHA is required.");
    }

    if (!expectedDigest || !/^sha256:[a-f0-9]{64}$/i.test(expectedDigest.trim())) {
        throw new Error("Invalid or missing expectedDigest. A valid sha256:64-hex digest is required.");
    }

    const cleanExpectedSha = expectedRevision.trim().toLowerCase();
    const cleanExpectedDigest = expectedDigest.trim().toLowerCase();

    let source = sourceOverride;
    if (!source) {
        try {
            source = await readSkillSource(repoOrUrl, cleanExpectedSha);
        } catch (err) {
            throw new Error(`Failed to resolve upstream skill source at revision '${cleanExpectedSha}': ${err.message}`);
        }
    }

    try {
        const actualRevision = (source.sourceRevision || "").toLowerCase();
        if (actualRevision && actualRevision !== cleanExpectedSha) {
            throw new Error(`Revision mismatch: expected '${cleanExpectedSha}', but resolved '${actualRevision}'`);
        }

        validateFileBounds(source.filesMap);
        const actualDigest = (source.contentDigest || calculateContentDigest(source.filesMap)).toLowerCase();

        if (actualDigest !== cleanExpectedDigest) {
            throw new Error(`Content digest mismatch: expected '${cleanExpectedDigest}', but calculated '${actualDigest}'. Upstream content may have changed.`);
        }

        const vetResult = vetFilesMap(source.filesMap, repoOrUrl, config);
        if (vetResult.isBlocked) {
            return {
                status: "INSTALLATION_BLOCKED",
                reason: `Skill risk score (${vetResult.riskScore}/100) exceeds threshold (${config.maxRiskThreshold}).`,
                provenance: source.provenance,
                vetScope: source.vetScope,
                vettingSummary: vetResult,
                actionRequired: "Installation aborted. Suspicious skills cannot be installed."
            };
        }

        const rawName = source.skillName || (repoOrUrl.match(/([^\/]+)\/([^\/]+)$/)?.[2]?.replace(/\.git$/, "") || "custom-skill");
        const skillName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

        let targetDir = targetDirOverride;
        if (!targetDir) {
            const isSkillFolder = ["canonical", "github-folder", "skills-registry"].includes(source.provenance);
            if (isSkillFolder && scope === "user") {
                targetDir = path.join(os.homedir(), ".agents", "skills", skillName);
            } else if (isSkillFolder) {
                targetDir = path.join(process.cwd(), ".github", "skills", skillName);
            } else if (scope === "user") {
                targetDir = path.join(os.homedir(), ".copilot", "extensions", skillName);
            } else {
                targetDir = path.join(process.cwd(), ".github", "extensions", skillName);
            }
        }

        // Check destination collision
        let targetExists = false;
        try {
            const stat = await fs.stat(targetDir);
            targetExists = stat.isDirectory();
        } catch (e) {
            if (e.code !== "ENOENT") throw e;
        }

        if (targetExists) {
            const existingFiles = await scanDirectoryFiles(targetDir);
            const existingDigest = calculateContentDigest(existingFiles).toLowerCase();
            if (existingDigest === cleanExpectedDigest) {
                await saveInstalledRecord({
                    name: skillName,
                    source: repoOrUrl,
                    sourceRevision: cleanExpectedSha,
                    contentDigest: actualDigest,
                    scope,
                    targetDirectory: targetDir
                });
                return {
                    status: "ALREADY_INSTALLED",
                    skillName,
                    scope,
                    targetDirectory: targetDir,
                    sourceRevision: cleanExpectedSha,
                    contentDigest: actualDigest,
                    message: `Skill is already installed at ${targetDir} with identical content digest.`
                };
            } else {
                throw new Error(`Destination directory '${targetDir}' already exists with a different content digest (${existingDigest}). Installation aborted to prevent accidental overwrite.`);
            }
        }

        // Staging atomic setup
        const parentDir = path.dirname(targetDir);
        await fs.mkdir(parentDir, { recursive: true });
        const stagingDir = `${targetDir}.staging-${crypto.randomUUID()}`;

        try {
            await fs.mkdir(stagingDir, { recursive: true });

            for (const [relPath, content] of Object.entries(source.filesMap)) {
                const destPath = path.join(stagingDir, relPath);
                await fs.mkdir(path.dirname(destPath), { recursive: true });
                const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
                await fs.writeFile(destPath, buf);
            }

            const stagedFiles = await scanDirectoryFiles(stagingDir);
            const stagedDigest = calculateContentDigest(stagedFiles).toLowerCase();
            if (stagedDigest !== cleanExpectedDigest) {
                throw new Error(`Staged content digest verification failed: expected '${cleanExpectedDigest}', got '${stagedDigest}'`);
            }

            await fs.rename(stagingDir, targetDir);
            await saveInstalledRecord({
                name: skillName,
                source: repoOrUrl,
                sourceRevision: cleanExpectedSha,
                contentDigest: actualDigest,
                scope,
                targetDirectory: targetDir
            });
            return {
                status: "INSTALLED_SUCCESSFULLY",
                skillName,
                scope,
                targetDirectory: targetDir,
                sourceRevision: cleanExpectedSha,
                contentDigest: actualDigest,
                vettingResult: {
                    riskScore: vetResult.riskScore,
                    status: vetResult.status,
                    provenance: source.provenance,
                    vetScope: source.vetScope,
                    securityVettingBypassed: false
                },
                nextStep: "Run extensions_reload to activate the newly installed extension/skill."
            };
        } catch (err) {
            await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
            throw err;
        }
    } finally {
        if (source?.tempDir) {
            await fs.rm(source.tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}
