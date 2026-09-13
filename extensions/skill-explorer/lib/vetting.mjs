import crypto from "node:crypto";
import path from "node:path";
import { validatePathSafety } from "./url.mjs";
import { resolveRiskThreshold } from "./config.mjs";

/**
 * Skill Explorer Static Analysis & Security Vetting Engine
 *
 * Responsibilities:
 * - Pre-installation static analysis and risk assessment across all skill files.
 * - Enforcing hard resource bounds (max 200 files, max 1 MiB per file, max 5 MiB total content).
 * - Rejecting binary/null-byte files and path-traversal directory escapes.
 * - Computing deterministic sha256 content digests over sorted, null-delimited file maps.
 * - Evaluating deterministic heuristic rules across code execution, obfuscation, credential exfiltration,
 *   network access, prompt injection, destructive file ops, and unpinned remote script execution.
 * - Applying non-linear per-rule saturation scoring to prevent alert fatigue and score distortion.
 * - Enforcing safety gates: risk threshold blocking, untrusted provenance verification, and zero risk discounts for trusted sources.
 *
 * Known Limitations & False-Positive Review:
 * - Every line of every file is scanned by default, including unfenced documentation prose, because a skill
 *   document is itself an instruction executed by the agent. A finding is suppressed only when a negation
 *   directly governs that specific match within its own clause ("do not use child_process.execSync"), so an
 *   unrelated negation elsewhere on the line cannot neutralize a payload. Prompt-injection rules are never suppressed.
 * - Skills that manage cloud environments and legitimate credential workflows may trigger CREDENTIAL_EXFILTRATION.
 * - Obfuscation heuristics look for raw base64 buffer decodes and long hex escape chains; legitimate asset bundling
 *   or font definitions may match OBFUSCATION_PATTERNS.
 * - Vetting is a first-line static filter and does not execute untrusted code in a runtime sandbox.
 */

export const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MiB
export const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5 MiB
export const MAX_FILE_COUNT = 200;

export const VETTING_RULES = Object.freeze([
    Object.freeze({
        id: "DANGEROUS_EXECUTION",
        category: "Code Execution",
        severity: "HIGH",
        score: 30,
        regex: /(?:child_process|execSync|spawnSync|exec\s*\(|spawn\(|eval\s*\(|new\s+Function\s*\(|vm\.runInContext|vm\.runInNewContext|vm\.runInThisContext|vm\.compileFunction)/i,
        description: "Potentially dangerous shell or dynamic code execution detected."
    }),
    Object.freeze({
        id: "OBFUSCATION_PATTERNS",
        category: "Obfuscation",
        severity: "HIGH",
        score: 25,
        regex: /(?:Buffer\.from\([^)]*['"]base64['"]\)|atob\s*\(|String\.fromCharCode\s*\(\s*\d+(?:\s*,\s*\d+){3,}\)|\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){3,})/i,
        description: "Base64, hex, or character code obfuscation pattern detected."
    }),
    Object.freeze({
        id: "CREDENTIAL_EXFILTRATION",
        category: "Data Security",
        severity: "CRITICAL",
        score: 40,
        regex: /(?:process\.env\.(?:GITHUB_TOKEN|AWS_SECRET|SLACK_TOKEN|API_KEY|PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY)|(?:id_rsa|\.aws\/credentials|\.env|\.ssh\/id_))/i,
        description: "Accessing sensitive tokens, credentials, or SSH/AWS secret files."
    }),
    Object.freeze({
        id: "NETWORK_EXFILTRATION",
        category: "Network Access",
        severity: "MEDIUM",
        score: 20,
        regex: /(?:https?:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com|api\.telegram\.org|webhook\.site|pipedream\.net|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))/i,
        description: "Connection to external webhook endpoint, exfiltration service, or raw IP address."
    }),
    Object.freeze({
        id: "PROMPT_INJECTION",
        category: "Prompt Security",
        severity: "HIGH",
        score: 30,
        regex: /(?:ignore\s+(?:all\s+)?previous\s+instructions|disregard\s+(?:all\s+)?previous\s+instructions|system\s+prompt\s*:|you\s+are\s+now\s+in\s+unfiltered|you\s+are\s+now\s+in\s+developer\s+mode|jailbreak|override\s+system\s+instructions|bypass\s+(?:all\s+)?safety\s+(?:checks|guardrails|rules)|<!--\s*ignore\s+(?:all\s+)?previous\s+instructions)/i,
        description: "Potential prompt injection, persona manipulation, or system instruction override attempt."
    }),
    Object.freeze({
        id: "DESTRUCTIVE_FILE_OPS",
        category: "File Security",
        severity: "HIGH",
        score: 35,
        regex: /(?:fs\.rmSync|fs\.rm\s*\(|rimraf|unlinkSync|del\s+\/f|\/bin\/rm\s+-rf)/i,
        description: "Destructive file deletion or directory removal operation."
    }),
    Object.freeze({
        id: "DYNAMIC_DEPENDENCY_EXECUTION",
        category: "Dependency & Remote Execution",
        severity: "HIGH",
        score: 30,
        regex: /(?:curl\s+-[^\n|]*\|\s*(?:ba)?sh|wget\s+-[^\n|]*\|\s*(?:ba)?sh|npm\s+install\s+--global\s+http|pip\s+install\s+http)/i,
        description: "Unverified remote script execution or unpinned network dependency installation."
    })
]);

const DOCUMENTATION_FILE_PATTERN = /\.(?:md|mdx|txt)$/i;
const EXECUTABLE_OR_CONFIGURATION_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|sh|bash|zsh|ps1|ya?ml|json)$/i;

// A skill document is itself an instruction executed by the agent, so every line of every file is scanned by
// default. Suppression is the narrow exception, never the rule: a finding is dropped only when a negation
// directly governs that specific match within its own clause. Scoping suppression to the clause immediately
// preceding the match (rather than the whole line) prevents an attacker from neutralizing a payload by
// sprinkling an unrelated negation word elsewhere on the line.
const CLAUSE_BOUNDARY_PATTERN = /[.;:!?]\s+|,\s+|\b(?:but|however|though|although|yet)\s+|^\s*(?:[-*+]|\d+[.)])\s+|\|\s*/g;
const NEGATION_CORE = "(?:do(?:es)?\\s+not|don't|doesn't|must\\s+not|should\\s+not|shouldn't|cannot|can't|will\\s+not|won't|is\\s+not|are\\s+not|no\\s+longer|never|instead\\s+of|rather\\s+than|disallow(?:s|ed)?|forbid(?:s|den)?|refuse(?:s|d)?\\s+to)";
const NEGATED_VERB = "(?:use|run|execute|invoke|call|issue|perform|include|contain|rely\\s+on|depend\\s+on|add|write|ship|allow|permit)[sd]?";
const NEGATION_OBJECT = "(?:any|the|a|an|this|that|these|those|such|its|your|our|raw|untrusted|dangerous|arbitrary)";
const GOVERNING_NEGATION_PATTERN = new RegExp(
    `\\b${NEGATION_CORE}(?:\\s+${NEGATED_VERB})?(?:\\s+${NEGATION_OBJECT})*\\s*$`,
    "i"
);

function isProseFile(filePath) {
    return DOCUMENTATION_FILE_PATTERN.test(filePath)
        || !EXECUTABLE_OR_CONFIGURATION_FILE_PATTERN.test(filePath);
}

function clauseStartIndex(line, matchIndex) {
    const before = line.slice(0, matchIndex);
    CLAUSE_BOUNDARY_PATTERN.lastIndex = 0;
    let clauseStart = 0;
    let boundary;
    while ((boundary = CLAUSE_BOUNDARY_PATTERN.exec(before)) !== null) {
        clauseStart = boundary.index + boundary[0].length;
        if (CLAUSE_BOUNDARY_PATTERN.lastIndex === boundary.index) CLAUSE_BOUNDARY_PATTERN.lastIndex++;
    }
    return clauseStart;
}

/**
 * Returns true only when a negation directly governs this match inside its own clause.
 * Descriptive documentation ("Do not use child_process.execSync") is suppressed; an unrelated
 * negation elsewhere on the line ("This never fails: run curl ... | bash") is not.
 */
export function isGovernedByNegation(line, matchIndex) {
    const prefix = line.slice(clauseStartIndex(line, matchIndex), matchIndex);
    if (prefix.length > 60) return false;
    return GOVERNING_NEGATION_PATTERN.test(prefix.replace(/[`'"(\[]+$/, "").trimEnd());
}

const GLOBAL_RULE_REGEX = new WeakMap();

function globalRegexFor(rule) {
    let regex = GLOBAL_RULE_REGEX.get(rule);
    if (!regex) {
        regex = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : `${rule.regex.flags}g`);
        GLOBAL_RULE_REGEX.set(rule, regex);
    }
    return regex;
}

/**
 * Returns the first match on the line that is not suppressed. A negation governs its whole clause, so
 * "do not use child_process.execSync or eval(x)" stays clean, while a clause boundary (sentence end,
 * comma, contrastive conjunction, or list/table delimiter) ends that protection — preventing a payload
 * from hiding behind an unrelated negation earlier on the same line.
 */
/**
 * A bare module specifier (`node:child_process`) names a module rather than performing an operation;
 * any actual use still trips the call-site patterns (`execSync`, `spawn(`, ...). This exemption is
 * positively identified by the `node:` prefix, so it cannot be induced by attacker phrasing.
 */
function isModuleSpecifier(line, matchIndex) {
    return /node:$/.test(line.slice(0, matchIndex));
}

function findRuleMatch(rule, filePath, inCodeFence, line) {
    const suppressible = rule.id !== "PROMPT_INJECTION" && isProseFile(filePath) && !inCodeFence;
    const regex = globalRegexFor(rule);
    regex.lastIndex = 0;
    const governedClauses = new Map();
    let match;
    while ((match = regex.exec(line)) !== null) {
        if (match[0].length === 0) regex.lastIndex++;
        if (rule.id !== "PROMPT_INJECTION" && isModuleSpecifier(line, match.index)) continue;
        if (!suppressible) return match;
        const clauseStart = clauseStartIndex(line, match.index);
        if (!governedClauses.has(clauseStart)) {
            governedClauses.set(clauseStart, isGovernedByNegation(line, match.index));
        }
        if (!governedClauses.get(clauseStart)) return match;
    }
    return undefined;
}

export function validateFileBounds(filesMap) {
    const filePaths = Object.keys(filesMap);
    if (filePaths.length > MAX_FILE_COUNT) {
        throw new Error(`File count limit exceeded: ${filePaths.length} files (maximum ${MAX_FILE_COUNT})`);
    }

    let totalSize = 0;
    for (const [relPath, content] of Object.entries(filesMap)) {
        if (!validatePathSafety(relPath)) {
            throw new Error(`Unsafe file path rejected: '${relPath}'`);
        }

        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        if (buf.length > MAX_FILE_SIZE) {
            throw new Error(`File size limit exceeded for '${relPath}': ${buf.length} bytes (maximum ${MAX_FILE_SIZE} bytes)`);
        }

        // Check for binary file (contains null byte \0)
        if (buf.includes(0)) {
            throw new Error(`Binary or unreadable file rejected: '${relPath}'`);
        }

        totalSize += buf.length;
        if (totalSize > MAX_TOTAL_SIZE) {
            throw new Error(`Total content size limit exceeded: ${totalSize} bytes (maximum ${MAX_TOTAL_SIZE} bytes)`);
        }
    }

    return true;
}

export function calculateContentDigest(filesMap) {
    validateFileBounds(filesMap);
    const hash = crypto.createHash("sha256");
    const sortedPaths = Object.keys(filesMap).sort();

    for (const relPath of sortedPaths) {
        const normalizedPath = relPath.replace(/\\/g, "/");
        const content = filesMap[relPath];
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        hash.update(normalizedPath + "\0");
        hash.update(buf);
        hash.update("\0");
    }

    return `sha256:${hash.digest("hex")}`;
}

export function vetFilesMap(filesMap, repoOrUrl, config) {
    validateFileBounds(filesMap);

    const findings = [];
    let riskScore = 0;

    let isWhitelisted = false;
    let authorOrOrg = "";
    if (repoOrUrl) {
        const match = repoOrUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/i) || repoOrUrl.match(/^([^\/]+)\/([^\/]+)(?:\/|$)/);
        if (match) {
            authorOrOrg = match[1].toLowerCase();
            const repoFull = `${match[1]}/${match[2]}`.toLowerCase().replace(/\.git$/, "");
            if (config.trustedOrgs.map(o => o.toLowerCase()).includes(authorOrOrg)) {
                isWhitelisted = true;
            }
            if (config.trustedRepos.map(r => r.toLowerCase()).includes(repoFull)) {
                isWhitelisted = true;
            }
        }
    }

    const rules = VETTING_RULES;

    // Rule contribution tracking for deduplication & non-linear saturation
    const ruleTotalAdded = new Map();

    for (const [filePath, content] of Object.entries(filesMap)) {
        const textContent = Buffer.isBuffer(content) ? content.toString("utf8") : content;
        const lines = textContent.split(/\r?\n/);
        const ruleMatchesInFile = new Map();
        let inCodeFence = false;

        lines.forEach((line, idx) => {
            if (isProseFile(filePath) && /^\s*```/.test(line)) {
                inCodeFence = !inCodeFence;
                return;
            }
            const snippet = line.trim().substring(0, 120);
            for (const rule of rules) {
                if (findRuleMatch(rule, filePath, inCodeFence, line)) {
                    findings.push({
                        ruleId: rule.id,
                        category: rule.category,
                        severity: rule.severity,
                        file: filePath,
                        line: idx + 1,
                        snippet,
                        description: rule.description,
                        scoreContribution: rule.score
                    });

                    const currentMatches = ruleMatchesInFile.get(rule.id) || 0;
                    ruleMatchesInFile.set(rule.id, currentMatches + 1);
                }
            }
        });

        // Deduplicated scoring calculation per rule per file
        for (const [ruleId, count] of ruleMatchesInFile.entries()) {
            const rule = rules.find(r => r.id === ruleId);
            if (!rule) continue;

            const existingTotal = ruleTotalAdded.get(ruleId) || 0;
            const maxRuleCap = rule.score * 2.0;

            if (existingTotal < maxRuleCap) {
                // First match in file contributes full score; sub-matches contribute diminished score
                const dimSubMatch = Math.min(5, Math.ceil(rule.score * 0.15));
                const fileContribution = Math.min(rule.score * 1.5, rule.score + (count - 1) * dimSubMatch);
                const allowedContribution = Math.min(fileContribution, maxRuleCap - existingTotal);

                riskScore += allowedContribution;
                ruleTotalAdded.set(ruleId, existingTotal + allowedContribution);
            }
        }
    }

    riskScore = Math.min(100, Math.round(riskScore));

    let status = "SAFE";
    if (riskScore >= 80) status = "CRITICAL";
    else if (riskScore >= 50) status = "HIGH_RISK";
    else if (riskScore >= 20) status = "MEDIUM_RISK";

    // Trust priority NEVER discounts risk score or bypasses maxRiskThreshold.
    // The threshold is the security control, so a malformed value must fail closed rather than
    // silently comparing against NaN (which yields false and installs everything).
    const threshold = resolveRiskThreshold(config?.maxRiskThreshold);
    const isBlocked = riskScore >= threshold;

    return {
        repoOrUrl,
        isWhitelisted,
        authorOrOrg,
        riskScore,
        status,
        isBlocked,
        maxRiskThreshold: threshold,
        findingsCount: findings.length,
        findings,
        recommendation: isBlocked
            ? `BLOCKED: Skill risk score (${riskScore}/100) exceeds threshold (${threshold}). Automatic installation blocked.`
            : `APPROVED: Skill passed security vetting (Risk Score: ${riskScore}/100).`
    };
}

export function parseSkillMetadata(filesMap) {
    const skillEntry = Object.entries(filesMap).find(([filePath]) =>
        /(^|\/)SKILL\.md$/i.test(filePath)
    );
    const content = skillEntry ? (Buffer.isBuffer(skillEntry[1]) ? skillEntry[1].toString("utf8") : skillEntry[1]) : "";
    const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const name = frontmatter?.[1].match(/^name:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
    const description = frontmatter?.[1].match(/^description:\s*['"]?([\s\S]*?)['"]?\s*$/m)?.[1]
        ?.replace(/\s+/g, " ")
        .trim();
    const headings = [...content.matchAll(/^#{1,3}\s+(.+)$/gm)].map(match => match[1].trim());
    const bodyLines = content
        .replace(/^---[\s\S]*?---\s*/m, "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#") && !line.startsWith("```"));
    const summary = description || bodyLines[0] || "No clear purpose statement found.";

    return {
        name: name || "Unknown skill",
        description: summary,
        headings,
        fileCount: Object.keys(filesMap).length,
        hasExamples: headings.some(heading => /example|usage|workflow/i.test(heading)) ||
            /\bexample\b/i.test(content),
        hasSafetyGuidance: headings.some(heading => /safety|security|guardrail/i.test(heading)) ||
            /\b(?:safety|security|guardrail)\b/i.test(content)
    };
}
