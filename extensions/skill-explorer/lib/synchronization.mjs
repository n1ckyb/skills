import { loadInstalledRegistry } from "./config.mjs";
import { readSkillSource } from "./github.mjs";

export async function filterSynchronizedResults(results, options = {}) {
    const registry = await (options.loadInstalledRegistry || loadInstalledRegistry)();
    const readSource = options.readSkillSource || readSkillSource;
    const visible = [];
    const sourceErrors = [];
    const attemptedSources = [];

    for (const result of results) {
        const source = result.fullName || result.sourceRepository || result.url;
        const installed = registry[`user:${source}`] || registry[`project:${source}`] || registry[source];
        if (!installed) {
            visible.push(result);
            continue;
        }

        const syncSource = `sync:${source}`;
        attemptedSources.push(syncSource);
        try {
            const current = await readSource(source, null, options);
            if (current.sourceRevision !== installed.sourceRevision || current.contentDigest !== installed.contentDigest) {
                visible.push({ ...result, syncStatus: "Update available" });
            }
        } catch (error) {
            sourceErrors.push({
                source: syncSource,
                error: error.message,
                statusCode: error.statusCode || null
            });
            visible.push({ ...result, syncStatus: "Sync check unavailable" });
        }
    }
    return { results: visible, sourceErrors, attemptedSources, complete: sourceErrors.length === 0 };
}
