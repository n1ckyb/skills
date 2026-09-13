import { readSkillSource } from "./github.mjs";
import { vetFilesMap } from "./vetting.mjs";
import { installSkillAtomic } from "./installer.mjs";
import { loadInstalledRegistry, recordOperationState } from "./config.mjs";

/**
 * Skill Explorer Installation & Vetting Flow Orchestration Module
 *
 * Responsibilities:
 * - Orchestrating end-to-end skill vetting workflow from repository/folder fetch to risk assessment and receipt generation.
 * - Binding user confirmation explicitly to the vetting receipt (source, scope, expected commit SHA, expected sha256 digest).
 * - Enforcing installation preconditions (confirmation, tracked sync status, non-destructive install policy).
 * - Delegating atomic staging, validation, and rollback to the installer module.
 * - Recording telemetry events for vetting and installation decisions with observability warnings.
 */

function installationKey(source, scope) {
    return `${scope}:${source}`;
}

function confirmationCovers({ confirmationSummary, repoOrUrl, scope, expectedRevision, expectedDigest }) {
    const summary = confirmationSummary?.toLowerCase() || "";
    return summary.includes(repoOrUrl.toLowerCase())
        && summary.includes(scope.toLowerCase())
        && summary.includes(expectedRevision.toLowerCase())
        && summary.includes(expectedDigest.toLowerCase());
}

export async function vetSkillSource(repoOrUrl, config, options = {}) {
    let source;
    try {
        source = await readSkillSource(repoOrUrl, null, options);
    } catch (err) {
        try {
            await recordOperationState("vet", {
                attemptedSources: [repoOrUrl],
                sourceErrors: [{ source: repoOrUrl, error: err.message }],
                installationDecision: "vetting_failed",
                counters: options.budget?.snapshot?.() || {},
                durationMs: options.budget?.snapshot?.().elapsedMs || 0,
                budgetExhausted: /budget exhausted|operation deadline/i.test(err.message),
                origin: options.origin
            });
        } catch (recordErr) {
            console.warn(`[WARNING] Failed to record operation state: ${recordErr.message}`);
        }
        throw err;
    }

    const vetting = vetFilesMap(source.filesMap, repoOrUrl, config);
    const result = {
        source,
        vetting,
        receipt: {
            repoOrUrl,
            sourceRevision: source.sourceRevision,
            contentDigest: source.contentDigest,
            riskScore: vetting.riskScore,
            status: vetting.status
        }
    };

    try {
        await recordOperationState("vet", {
            attemptedSources: [repoOrUrl],
            failures: [],
            vettingReceipt: result.receipt,
            installationDecision: vetting.isBlocked ? "blocked" : "pending",
            counters: options.budget?.snapshot?.() || {},
            durationMs: options.budget?.snapshot?.().elapsedMs || 0,
            budgetExhausted: false,
            origin: options.origin
        });
    } catch (recordErr) {
        const warning = `Failed to persist operation state: ${recordErr.message}`;
        console.warn(`[WARNING] ${warning}`);
        result.observabilityWarning = warning;
        result.receipt.observabilityWarning = warning;
    }

    return result;
}

export async function executeInstallation({
    action = "install",
    repoOrUrl,
    scope,
    userConfirmed,
    confirmationSummary,
    expectedRevision,
    expectedDigest,
    config,
    replaceExisting = false,
    budget,
    options = {}
}) {
    const operationOptions = budget ? { ...options, budget } : options;
    const origin = options.origin;
    if (!["install", "sync"].includes(action)) {
        throw new Error(`Unsupported installation action '${action}'.`);
    }
    if (userConfirmed !== true || !confirmationCovers({
        confirmationSummary, repoOrUrl, scope, expectedRevision, expectedDigest
    })) {
        const result = {
            status: "CONFIRMATION_REQUIRED",
            reason: "Confirmation must explicitly include the source, scope, expected revision, and expected digest from the vetting receipt."
        };
        try {
            await recordOperationState(action, {
                attemptedSources: [repoOrUrl],
                failures: [],
                vettingReceipt: { expectedRevision, expectedDigest },
                installationDecision: result.status,
                counters: budget?.snapshot?.() || {},
                durationMs: budget?.snapshot?.().elapsedMs || 0,
                budgetExhausted: false,
                origin
            });
        } catch (recordErr) {
            const warning = `Failed to persist operation state: ${recordErr.message}`;
            console.warn(`[WARNING] ${warning}`);
            result.observabilityWarning = warning;
        }
        return result;
    }

    if (action === "install" && replaceExisting) {
        throw new Error("Install never replaces existing different content. Use sync for an approved update.");
    }
    if (action === "sync") {
        const registry = await loadInstalledRegistry();
        if (!registry[installationKey(repoOrUrl, scope)] && !registry[repoOrUrl]) {
            throw new Error(`Cannot synchronize '${repoOrUrl}' in ${scope} scope because it is not a tracked installation.`);
        }
    }

    let result;
    try {
        result = await installSkillAtomic({
            repoOrUrl,
            scope,
            userConfirmed,
            confirmationSummary,
            expectedRevision,
            expectedDigest,
            config,
            allowReplace: action === "sync" && replaceExisting,
            action,
            options: operationOptions
        });
    } catch (err) {
        try {
            await recordOperationState(action, {
                attemptedSources: [repoOrUrl],
                failures: [{ source: repoOrUrl, error: err.message }],
                vettingReceipt: { expectedRevision, expectedDigest },
                installationDecision: "failed",
                counters: budget?.snapshot?.() || {},
                durationMs: budget?.snapshot?.().elapsedMs || 0,
                budgetExhausted: /budget exhausted|operation deadline/i.test(err.message),
                origin
            });
        } catch (recordErr) {
            console.warn(`[WARNING] Failed to record operation state: ${recordErr.message}`);
        }
        throw err;
    }

    try {
        await recordOperationState(action, {
            attemptedSources: [repoOrUrl],
            failures: [],
            vettingReceipt: { expectedRevision, expectedDigest },
            installationDecision: result.status,
            counters: budget?.snapshot?.() || {},
            durationMs: budget?.snapshot?.().elapsedMs || 0,
            budgetExhausted: false,
            origin
        });
    } catch (recordErr) {
        const warning = `Failed to persist operation state: ${recordErr.message}`;
        console.warn(`[WARNING] ${warning}`);
        result.observabilityWarning = warning;
    }

    return result;
}
