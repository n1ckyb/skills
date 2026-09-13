import { readSkillSource } from "./github.mjs";
import { vetFilesMap } from "./vetting.mjs";
import { installSkillAtomic } from "./installer.mjs";
import { loadInstalledRegistry } from "./config.mjs";

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

export async function vetSkillSource(repoOrUrl, config) {
    const source = await readSkillSource(repoOrUrl);
    const vetting = vetFilesMap(source.filesMap, repoOrUrl, config);
    return {
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
    replaceExisting = false
}) {
    if (!["install", "sync"].includes(action)) {
        throw new Error(`Unsupported installation action '${action}'.`);
    }
    if (userConfirmed !== true || !confirmationCovers({
        confirmationSummary, repoOrUrl, scope, expectedRevision, expectedDigest
    })) {
        return {
            status: "CONFIRMATION_REQUIRED",
            reason: "Confirmation must explicitly include the source, scope, expected revision, and expected digest from the vetting receipt."
        };
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

    return installSkillAtomic({
        repoOrUrl,
        scope,
        userConfirmed,
        confirmationSummary,
        expectedRevision,
        expectedDigest,
        config,
        allowReplace: action === "sync" && replaceExisting,
        action
    });
}
