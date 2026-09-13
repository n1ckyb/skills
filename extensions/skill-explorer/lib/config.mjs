import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const CONFIG_PATH = path.join(os.homedir(), ".copilot", "skill-explorer-config.json");
export const INSTALLED_REGISTRY_PATH = path.join(os.homedir(), ".copilot", "skill-explorer-installed.json");
export const CANONICAL_SKILLS_REPO = "github/awesome-copilot";
export const CANONICAL_SKILLS_ROOT = "skills";
export const CANONICAL_SKILLS_SITE = "https://awesome-copilot.github.com/skills/";
export const AI_HERO_SKILLS_REPO = "mattpocock/skills";
export const AI_HERO_SKILLS_SITE = "https://www.aihero.dev/skills";
export const SKILLS_DIRECTORY_SITE = "https://www.skills.sh";

export const DEFAULT_CONFIG = {
    canonicalSkillsRepo: CANONICAL_SKILLS_REPO,
    agentSkillsDirectory: SKILLS_DIRECTORY_SITE,
    trustedOrgs: ["github", "copilot-extensions", "microsoft", "azure", "actions"],
    trustedRepos: [
        CANONICAL_SKILLS_REPO,
        AI_HERO_SKILLS_REPO,
        "github/copilot-cli",
        "copilot-extensions/community-skills",
        "microsoft/copilot-skills"
    ],
    maxRiskThreshold: 50,
    autoVetBeforeInstall: true
};

export async function loadConfig(targetConfigPath = CONFIG_PATH) {
    try {
        const data = await fs.readFile(targetConfigPath, "utf8");
        try {
            const parsed = JSON.parse(data);
            return { ...DEFAULT_CONFIG, ...parsed };
        } catch (jsonErr) {
            throw new Error(`Malformed configuration JSON in '${targetConfigPath}': ${jsonErr.message}`);
        }
    } catch (err) {
        if (err.code === "ENOENT") {
            try {
                await saveConfig(DEFAULT_CONFIG, targetConfigPath);
            } catch {
                // Return default config even if writing default file fails
            }
            return { ...DEFAULT_CONFIG };
        }
        throw new Error(`Unreadable configuration file at '${targetConfigPath}': ${err.message}`);
    }
}

export async function saveConfig(cfg, targetConfigPath = CONFIG_PATH) {
    try {
        await fs.mkdir(path.dirname(targetConfigPath), { recursive: true });
        await fs.writeFile(targetConfigPath, JSON.stringify(cfg, null, 2), "utf8");
    } catch (err) {
        throw new Error(`Failed to save configuration to '${targetConfigPath}': ${err.message}`);
    }
}

export async function loadInstalledRegistry(registryPath = INSTALLED_REGISTRY_PATH) {
    try {
        const data = await fs.readFile(registryPath, "utf8");
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        if (err.code === "ENOENT") return {};
        throw new Error(`Unreadable installed-skill registry at '${registryPath}': ${err.message}`);
    }
}

export async function saveInstalledRecord(record, registryPath = INSTALLED_REGISTRY_PATH) {
    const registry = await loadInstalledRegistry(registryPath);
    const key = `${record.scope}:${record.source}`;
    registry[key] = {
        sourceRevision: record.sourceRevision,
        contentDigest: record.contentDigest,
        targetDirectory: record.targetDirectory,
        updatedAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8");
}
