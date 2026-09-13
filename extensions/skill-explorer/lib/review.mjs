import { parseSkillMetadata } from "./vetting.mjs";
import { AI_HERO_SKILLS_REPO } from "./config.mjs";

export function toSkillCard(result) {
    const sourceStatus = result.priorityTier === 0
        ? "Canonical"
        : result.sourceRepository === AI_HERO_SKILLS_REPO
            ? "AI Hero"
            : result.discoverySource === "skills.sh"
                ? "Skills Directory"
                : result.priorityTier === 3
            ? "Official"
            : result.priorityTier === 4
                ? "Trusted"
                : result.priorityTier === 5
                    ? "Community"
                    : "Unverified";

    const sourceVariant = result.priorityTier <= 3
        ? "status-success"
        : result.priorityTier === 4
            ? "status-default"
            : result.priorityTier === 5
                ? "status-attention"
                : "status-danger";

    return {
        id: result.fullName,
        title: result.name,
        description: result.description,
        url: result.url,
        labels: [
            { kind: "status", value: sourceStatus, variant: sourceVariant },
            { kind: "status", value: "Not vetted", variant: "status-attention" }
        ],
        metadata: {
            source: result.fullName,
            priorityTier: result.priorityTier,
            stars: result.stars,
            vettingRequired: true
        }
    };
}

export function reviewSkill(filesMap, vetResult, source) {
    const metadata = parseSkillMetadata(filesMap);
    const allContent = Object.values(filesMap)
        .map(c => (Buffer.isBuffer(c) ? c.toString("utf8") : c))
        .join("\n");

    const capabilities = [
        ["Shell or process execution", /(?:child_process|execSync|spawnSync|exec\s*\(|spawn\(|(?:^|\n)\s*(?:bash|sh|pwsh|powershell|cmd)\s+)/i],
        ["Network or external service access", /(?:fetch\s*\(|axios\.|Invoke-WebRequest|Invoke-RestMethod|(?:^|\n)\s*(?:curl|wget)\s+)/i],
        ["Environment or credential access", /(?:process\.env|GITHUB_TOKEN|AWS_SECRET|SLACK_TOKEN|API_KEY|PASSWORD|\.env\b)/i],
        ["Filesystem modification", /(?:writeFile|appendFile|unlink|rmSync|fs\.rm|\bdelete\b|\bcreate file\b|\bedit file\b)/i],
        ["Git or repository modification", /(?:git\s+(?:commit|push|merge|rebase|reset|checkout)|\bcommit\b|\bpull request\b)/i]
    ]
        .filter(([, pattern]) => pattern.test(allContent))
        .map(([name]) => name);

    const suspiciousIndicators = vetResult.findings.map(finding => {
        const defensiveContext = /(?:\bno\b|\bnot\b|\bnever\b|\bavoid\b|\bforbid|\bwithout\b)/i.test(finding.snippet);
        return {
            severity: finding.severity,
            indicator: finding.description,
            location: `${finding.file}:${finding.line}`,
            evidence: finding.snippet,
            assessment: defensiveContext
                ? "Likely contextual or defensive guidance; manually verify."
                : "Potentially suspicious capability or instruction; review before installation."
        };
    });

    const provenanceScore = source.provenance === "canonical"
        ? 10
        : (source.vetScope || "").toLowerCase().startsWith(`${AI_HERO_SKILLS_REPO}/`)
            ? 9
            : vetResult.isWhitelisted
                ? 8
                : 5;

    const safetyScore = Math.max(0, Math.round((100 - vetResult.riskScore) / 10));
    const clarityScore = Math.min(10,
        4 +
        (metadata.description !== "No clear purpose statement found." ? 2 : 0) +
        (metadata.headings.length >= 3 ? 2 : metadata.headings.length > 0 ? 1 : 0) +
        (metadata.hasExamples ? 1 : 0) +
        (metadata.hasSafetyGuidance ? 1 : 0)
    );
    const utilityScore = Math.min(10,
        4 +
        (metadata.description.length >= 40 ? 2 : 1) +
        (metadata.headings.length >= 2 ? 2 : 0) +
        (metadata.hasExamples ? 1 : 0) +
        (metadata.fileCount > 1 ? 1 : 0)
    );

    const overallScore = Number((
        utilityScore * 0.30 +
        clarityScore * 0.25 +
        safetyScore * 0.35 +
        provenanceScore * 0.10
    ).toFixed(1));

    const verdict = vetResult.isBlocked
        ? "Do not install"
        : vetResult.riskScore >= 20
            ? "Promising, but review flagged context before installing"
            : overallScore >= 8
                ? "Recommended after normal user confirmation"
                : overallScore >= 6
                    ? "Worth considering for a matching use case"
                    : "Limited confidence; inspect manually";

    return {
        title: metadata.name,
        sourceRevision: source.sourceRevision || "uncommitted",
        contentDigest: source.contentDigest || "unknown",
        whatItDoes: metadata.description,
        beneficialBecause: [
            "Provides reusable, task-specific instructions instead of relying on ad hoc prompting.",
            metadata.hasExamples
                ? "Includes examples or workflow guidance that can improve consistency."
                : "May reduce repeated setup, but examples or workflow detail appear limited.",
            metadata.fileCount > 1
                ? `Packages ${metadata.fileCount} reviewed files for a broader workflow.`
                : "Uses a small, inspectable single-file skill definition."
        ],
        capabilitiesRequiringTrust: capabilities.length > 0
            ? capabilities
            : ["No elevated capabilities detected by static text analysis."],
        suspiciousOrMaliciousIndicators: suspiciousIndicators.length > 0
            ? suspiciousIndicators
            : [{
                severity: "NONE",
                indicator: "No suspicious static-analysis patterns detected.",
                assessment: "This is not proof of safety; semantic abuse and dependency behavior may evade static checks."
            }],
        ratings: {
            overall: `${overallScore}/10`,
            utility: `${utilityScore}/10`,
            clarity: `${clarityScore}/10`,
            safety: `${safetyScore}/10`,
            provenance: `${provenanceScore}/10`,
            methodology: "Overall = utility 30% + clarity 25% + safety 35% + provenance 10%. Popularity is excluded."
        },
        verdict,
        reviewLimitations: [
            "Static review cannot prove a skill is safe or detect every prompt-level behavior.",
            "Referenced dependencies, remote content, and future upstream changes may introduce risk.",
            "The installer re-runs vetting and requires matching content digests before installation."
        ]
    };
}
