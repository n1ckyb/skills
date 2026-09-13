import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const CONFIG_PATH = path.join(os.homedir(), ".copilot", "skill-explorer-config.json");
export const INSTALLED_REGISTRY_PATH = path.join(os.homedir(), ".copilot", "skill-explorer-installed.json");
export const OPERATION_STATE_PATH = path.join(os.homedir(), ".copilot", "skill-explorer-operation-state.jsonl");
export const OPERATION_STATE_RETENTION = Object.freeze({
    maxBytes: 256 * 1024,
    maxRecords: 200
});
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
            } catch (saveErr) {
                console.warn(`[WARNING] Failed to save default configuration to '${targetConfigPath}': ${saveErr.message}`);
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

const stateWriteQueues = new Map();

function enqueueStateWrite(statePath, operation) {
    const previous = stateWriteQueues.get(statePath) || Promise.resolve();
    const next = previous.then(operation, operation);
    const queued = next.finally(() => {
        if (stateWriteQueues.get(statePath) === queued) stateWriteQueues.delete(statePath);
    });
    stateWriteQueues.set(statePath, queued);
    return queued;
}

async function compactOperationState(statePath, retention) {
    const records = await loadOperationState(statePath);
    const kept = [];
    let bytes = 0;
    for (const record of records.slice(-retention.maxRecords).reverse()) {
        const recordBytes = Buffer.byteLength(`${JSON.stringify(record)}\n`, "utf8");
        if (kept.length > 0 && bytes + recordBytes > retention.maxBytes) break;
        kept.push(record);
        bytes += recordBytes;
    }
    kept.reverse();
    const droppedRecordCount = records.length - kept.length;
    if (droppedRecordCount === 0) return { droppedRecordCount: 0 };

    const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(tempPath, kept.map(record => `${JSON.stringify(record)}\n`).join(""), "utf8");
        await fs.rename(tempPath, statePath);
    } finally {
        await fs.rm(tempPath, { force: true }).catch(() => {});
    }
    return { droppedRecordCount };
}

export async function recordOperationState(operation, state, statePath = OPERATION_STATE_PATH, retention = OPERATION_STATE_RETENTION) {
    const entry = { operation, ...state, recordedAt: new Date().toISOString() };
    const line = `${JSON.stringify(entry)}\n`;
    return enqueueStateWrite(statePath, async () => {
        try {
            await fs.mkdir(path.dirname(statePath), { recursive: true });
            await fs.appendFile(statePath, line, "utf8");
            const { droppedRecordCount } = await compactOperationState(statePath, retention);
            return droppedRecordCount > 0
                ? { ...entry, droppedRecordCount, observabilityWarning: `Operation state retention dropped ${droppedRecordCount} older record(s).` }
                : entry;
        } catch (err) {
            throw new Error(`Failed to record operation state in '${statePath}': ${err.message}`);
        }
    });
}

export async function loadOperationState(statePath = OPERATION_STATE_PATH) {
    try {
        const content = await fs.readFile(statePath, "utf8");
        const trimmed = content.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith("[")) {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        }
        return trimmed
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => JSON.parse(line));
    } catch (err) {
        if (err.code === "ENOENT") return [];
        throw new Error(`Failed to load operation state from '${statePath}': ${err.message}`);
    }
}
