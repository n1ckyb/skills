#!/usr/bin/env node
import readline from "node:readline/promises";
import process from "node:process";
import { executeInstallation, vetSkillSource } from "../extensions/skill-explorer/lib/installation-flow.mjs";
import { loadConfig } from "../extensions/skill-explorer/lib/config.mjs";

function usage() {
    console.error("Usage: gh skills install <owner/repo> <skill> [--scope user|project]");
    process.exitCode = 2;
}

const [, , command, repository, skillName, ...options] = process.argv;
if (command !== "install" || !repository || !skillName) {
    usage();
} else {
    const scopeIndex = options.indexOf("--scope");
    const scope = scopeIndex >= 0 ? options[scopeIndex + 1] : "user";
    if (!["user", "project"].includes(scope)) {
        console.error("Scope must be 'user' or 'project'.");
        process.exitCode = 2;
    } else {
        const sourceSpec = `${repository}/skills/${skillName}`;
        try {
            const config = await loadConfig();
            const { source, vetting: vetResult } = await vetSkillSource(sourceSpec, config);
            const revision = source.sourceRevision;
            const digest = source.contentDigest;

            console.log(`Skill: ${skillName}`);
            console.log(`Source: ${sourceSpec}`);
            console.log(`Scope: ${scope}`);
            console.log(`Revision: ${revision}`);
            console.log(`Digest: ${digest}`);
            console.log(`Risk: ${vetResult.riskScore}/100 (${vetResult.status})`);
            console.log(`Findings: ${vetResult.findings.length}`);

            if (vetResult.isBlocked) {
                throw new Error(`Installation blocked because risk exceeds ${config.maxRiskThreshold}/100.`);
            }

            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await rl.question("Install this exact vetted source? Type 'yes' to continue: ");
            rl.close();
            if (answer.trim().toLowerCase() !== "yes") {
                console.log("Installation cancelled.");
                process.exitCode = 1;
            } else {
                const result = await executeInstallation({
                    action: "install",
                    repoOrUrl: sourceSpec,
                    scope,
                    userConfirmed: true,
                    confirmationSummary: `Install ${skillName} from ${sourceSpec} at ${revision} with digest ${digest}; vetting result ${vetResult.status}, risk ${vetResult.riskScore}/100.`,
                    expectedRevision: revision,
                    expectedDigest: digest,
                    config
                });
                console.log(JSON.stringify(result, null, 2));
            }
        } catch (err) {
            console.error(`Installation failed: ${err.message}`);
            process.exitCode = 1;
        }
    }
}
