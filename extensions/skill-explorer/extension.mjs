import { joinSession } from "@github/copilot-sdk/extension";
import fs from "node:fs/promises";
import { createSkillShortlistCanvas, publishAssessment, publishCandidates } from "./skill-shortlist-canvas.mjs";
import {
    loadConfig,
    saveConfig,
    CONFIG_PATH,
    CANONICAL_SKILLS_REPO,
    CANONICAL_SKILLS_SITE,
    AI_HERO_SKILLS_REPO,
    AI_HERO_SKILLS_SITE,
    SKILLS_DIRECTORY_SITE
} from "./lib/config.mjs";
import {
    searchCanonicalSkills,
    searchAiHeroSkills,
    listTrendingSkills,
    searchSkillsDirectory,
    fetchJson,
    readSkillSource
} from "./lib/github.mjs";
import { vetFilesMap } from "./lib/vetting.mjs";
import { reviewSkill, toSkillCard } from "./lib/review.mjs";
import { installSkillAtomic } from "./lib/installer.mjs";

let session;
session = await joinSession({
    canvases: [createSkillShortlistCanvas({
        send: options => session.send(options)
    })],
    tools: [
        {
            name: "skill_explorer_search",
            description: "Search trusted and public repositories for available Copilot skills and extensions.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Keyword or topic to search for (e.g. 'jira', 'docker', 'database')" },
                    source: {
                        type: "string",
                        enum: ["all", "official", "trusted_orgs", "community"],
                        description: "Filter search sources (default: 'all')"
                    }
                },
                required: ["query"]
            },
            handler: async (args) => {
                const config = await loadConfig();
                const source = args.source || "all";
                const q = args.query;

                await session.log(`Searching canonical skills first, then ${AI_HERO_SKILLS_REPO}, for '${q}'...`);

                const officialOrgs = ["github", "copilot-extensions", "microsoft", "azure-samples"];

                let rawItems = [];
                try {
                    const canonicalResults = source === "community"
                        ? []
                        : await searchCanonicalSkills(q).catch(() => []);
                    const aiHeroResults = source === "community"
                        ? []
                        : await searchAiHeroSkills(q).catch(() => []);
                    const directoryResults = source === "community"
                        ? []
                        : (await searchSkillsDirectory(q, config).catch(() => []))
                            .filter(item => ![CANONICAL_SKILLS_REPO, AI_HERO_SKILLS_REPO]
                                .includes(item.sourceRepository.toLowerCase()));

                    const primaryQuery = `${q} (topic:copilot-skill OR topic:copilot-extension OR topic:skill OR copilot)`;
                    const urlPrimary = `https://api.github.com/search/repositories?q=${encodeURIComponent(primaryQuery)}&sort=stars&per_page=20`;
                    const dataPrimary = await fetchJson(urlPrimary).catch(() => ({ items: [] }));
                    rawItems = dataPrimary.items || [];

                    if (rawItems.length === 0) {
                        const fallbackQuery = `${q} (skill OR copilot OR extension)`;
                        const urlFallback = `https://api.github.com/search/repositories?q=${encodeURIComponent(fallbackQuery)}&sort=stars&per_page=15`;
                        const dataFallback = await fetchJson(urlFallback).catch(() => ({ items: [] }));
                        rawItems = dataFallback.items || [];
                    }

                    let mapped = rawItems
                        .filter(item => ![CANONICAL_SKILLS_REPO, AI_HERO_SKILLS_REPO].includes(item.full_name.toLowerCase()))
                        .map(item => {
                            const org = item.owner.login.toLowerCase();
                            const repo = item.full_name.toLowerCase();

                            let priorityTier = 6;
                            let trustTierLabel = "Priority 6: Unverified Community";

                            if (officialOrgs.includes(org)) {
                                priorityTier = 3;
                                trustTierLabel = "Priority 3: Official Source (GitHub/Microsoft)";
                            } else if (config.trustedOrgs.map(o => o.toLowerCase()).includes(org) || config.trustedRepos.map(r => r.toLowerCase()).includes(repo)) {
                                priorityTier = 4;
                                trustTierLabel = "Priority 4: Configured Trusted Source";
                            } else if (item.stargazers_count > 50 || (item.topics && item.topics.includes("copilot-skill"))) {
                                priorityTier = 5;
                                trustTierLabel = "Priority 5: Verified Community";
                            }

                            return {
                                priorityTier,
                                trustTierLabel,
                                name: item.name,
                                fullName: item.full_name,
                                description: (item.description || "No description provided").slice(0, 300),
                                stars: item.stargazers_count,
                                url: item.html_url,
                                cloneUrl: item.clone_url,
                                author: item.owner.login
                            };
                        });

                    if (source === "official") {
                        mapped = mapped.filter(item => item.priorityTier === 3);
                    } else if (source === "trusted_orgs") {
                        mapped = mapped.filter(item => item.priorityTier <= 4);
                    } else if (source === "community") {
                        mapped = mapped.filter(item => item.priorityTier >= 5);
                    }

                    mapped.sort((a, b) => {
                        if (a.priorityTier !== b.priorityTier) {
                            return a.priorityTier - b.priorityTier;
                        }
                        return b.stars - a.stars;
                    });

                    const results = [...canonicalResults, ...aiHeroResults, ...directoryResults, ...mapped];
                    publishCandidates(q, results.map(result => ({
                        name: result.name,
                        source: result.fullName || result.sourceRepository || result.url,
                        description: result.description,
                        url: result.url,
                        trustTier: result.trustTierLabel,
                        status: "Not vetted"
                    })));
                    return JSON.stringify({
                        searchQuery: q,
                        canonicalSource: {
                            repository: CANONICAL_SKILLS_REPO,
                            catalog: CANONICAL_SKILLS_SITE,
                            searchedFirst: true
                        },
                        secondarySource: {
                            repository: AI_HERO_SKILLS_REPO,
                            catalog: AI_HERO_SKILLS_SITE,
                            searchedSecond: true
                        },
                        directorySource: {
                            catalog: SKILLS_DIRECTORY_SITE,
                            searchedThird: true,
                            method: "Public all-time, hot, and 24-hour indexes; authenticated API credentials are not requested."
                        },
                        totalCount: results.length,
                        priorityOrdering: [
                            "Priority 0: Canonical Awesome GitHub Copilot Skill",
                            "Priority 1: AI Hero Skills by Matt Pocock",
                            "Priority 2: The Agent Skills Directory",
                            "Priority 3: Official Source (GitHub/Microsoft)",
                            "Priority 4: Configured Trusted Source",
                            "Priority 5: Verified Community",
                            "Priority 6: Unverified Community"
                        ],
                        results,
                        chatUx: {
                            widgetType: "inbox",
                            title: `Skills matching "${q}"`,
                            items: results.map(toSkillCard),
                            shortlistCanvas: {
                                canvasId: "skill-shortlist",
                                input: {
                                    query: q,
                                    candidates: results.map(result => ({
                                        name: result.name,
                                        source: result.fullName || result.sourceRepository || result.url,
                                        description: result.description,
                                        url: result.url,
                                        trustTier: result.trustTierLabel,
                                        status: "Not vetted"
                                    }))
                                }
                            },
                            nextAction: "Render inbox cards, open the skill-shortlist canvas with shortlistCanvas.input, then ask the user which skill to vet. Do not install directly from search results."
                        }
                    }, null, 2);
                } catch (err) {
                    return JSON.stringify({ error: `Error searching GitHub for skills: ${err.message}` });
                }
            }
        },
        {
            name: "skill_explorer_trending",
            description: "List trending installable agent skills from skills.sh, with trend rank and source trust shown separately. Every result remains unvetted until skill_explorer_vet is run.",
            parameters: {
                type: "object",
                properties: {
                    period: {
                        type: "string",
                        enum: ["trending24h", "hot", "alltime"],
                        description: "Ranking window: 24-hour trending, hot, or all-time installs."
                    },
                    limit: {
                        type: "integer",
                        minimum: 1,
                        maximum: 50,
                        description: "Maximum number of skills to return (default: 20)."
                    }
                }
            },
            handler: async (args) => {
                const config = await loadConfig();
                const period = args.period || "trending24h";
                const limit = args.limit || 20;
                await session.log(`Loading ${period} skills from skills.sh...`);

                try {
                    const results = await listTrendingSkills(period, limit, config);
                    const items = results.map(result => {
                        const card = toSkillCard(result);
                        card.description = `#${result.trendRank} ${result.rankingPeriod}. ${result.description}`;
                        card.labels = [
                            {
                                kind: "status",
                                value: `Trend #${result.trendRank}`,
                                variant: "status-default"
                            },
                            {
                                kind: "status",
                                value: `${card.labels[0].value} · Not vetted`,
                                variant: card.labels[0].variant
                            }
                        ];
                        return card;
                    });
                    return JSON.stringify({
                        source: SKILLS_DIRECTORY_SITE,
                        period,
                        rankingNote: "Trend rank comes from skills.sh. Source priority is displayed separately and does not replace trend rank.",
                        totalCount: results.length,
                        results,
                        chatUx: {
                            widgetType: "inbox",
                            title: `Trending skills — ${results[0]?.rankingPeriod || period}`,
                            items,
                            nextAction: "Render these cards, then ask which skill to vet. Trending status never bypasses vetting."
                        }
                    }, null, 2);
                } catch (err) {
                    return JSON.stringify({ error: `Error loading trending skills: ${err.message}` });
                }
            }
        },
        {
            name: "skill_explorer_vet",
            description: "Analyze an exact canonical skill folder or a skill repository for security vulnerabilities, malicious code execution, credential access, or prompt injection risks. Output includes immutable sourceRevision and contentDigest.",
            parameters: {
                type: "object",
                properties: {
                    repoOrUrl: {
                        type: "string",
                        description: "Canonical skill path/URL, GitHub repository in 'owner/repo' format, or full Git clone URL"
                    }
                },
                required: ["repoOrUrl"]
            },
            handler: async (args) => {
                const config = await loadConfig();
                await session.log(`Loading and security-vetting skill '${args.repoOrUrl}'...`);

                let source;
                try {
                    source = await readSkillSource(args.repoOrUrl);
                    const vetResult = vetFilesMap(source.filesMap, args.repoOrUrl, config);
                    const result = {
                        ...vetResult,
                        sourceRevision: source.sourceRevision,
                        contentDigest: source.contentDigest,
                        provenance: source.provenance,
                        vetScope: source.vetScope,
                        provenanceTrusted: source.provenance === "canonical",
                        securityVettingBypassed: false,
                        review: reviewSkill(source.filesMap, vetResult, source)
                    };
                    publishAssessment(args.repoOrUrl, result);
                    return JSON.stringify(result, null, 2);
                } catch (err) {
                    return JSON.stringify({ error: `Vetting failed: ${err.message}` });
                } finally {
                    if (source?.tempDir) {
                        await fs.rm(source.tempDir, { recursive: true, force: true }).catch(() => {});
                    }
                }
            }
        },
        {
            name: "skill_explorer_install",
            description: "Vet and atomically install a skill or extension into global or project scope. Requires explicit user confirmation, expectedRevision (40-char SHA), and expectedDigest (sha256).",
            parameters: {
                type: "object",
                properties: {
                    repoOrUrl: {
                        type: "string",
                        description: "GitHub repository in 'owner/repo' format or full Git clone URL"
                    },
                    scope: {
                        type: "string",
                        enum: ["user", "project"],
                        description: "Installation location: 'user' for global (all repos) or 'project' for current workspace"
                    },
                    userConfirmed: {
                        type: "boolean",
                        description: "Must be true only after the user explicitly approves the exact skill and scope in a question prompt."
                    },
                    confirmationSummary: {
                        type: "string",
                        description: "Exact skill, source, scope, expectedRevision, expectedDigest, and vetting result shown in the confirmation question."
                    },
                    expectedRevision: {
                        type: "string",
                        description: "The 40-character commit SHA returned by skill_explorer_vet."
                    },
                    expectedDigest: {
                        type: "string",
                        description: "The sha256 content digest string returned by skill_explorer_vet."
                    }
                },
                required: ["repoOrUrl", "scope", "userConfirmed", "confirmationSummary", "expectedRevision", "expectedDigest"]
            },
            handler: async (args) => {
                const config = await loadConfig();
                await session.log(`Preparing installation for '${args.repoOrUrl}' in ${args.scope} scope...`);

                try {
                    const result = await installSkillAtomic({
                        repoOrUrl: args.repoOrUrl,
                        scope: args.scope,
                        userConfirmed: args.userConfirmed,
                        confirmationSummary: args.confirmationSummary,
                        expectedRevision: args.expectedRevision,
                        expectedDigest: args.expectedDigest,
                        config
                    });
                    return JSON.stringify(result, null, 2);
                } catch (err) {
                    return JSON.stringify({ error: `Installation failed: ${err.message}` });
                }
            }
        },
        {
            name: "skill_explorer_configure",
            description: "View or update skill explorer trusted organizations, repositories, and risk threshold configurations.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["view", "add_trusted_org", "remove_trusted_org", "add_trusted_repo", "remove_trusted_repo", "set_risk_threshold"],
                        description: "Configuration action to perform"
                    },
                    value: {
                        type: "string",
                        description: "Org name, repo name ('owner/repo'), or numerical threshold (0-100)"
                    }
                },
                required: ["action"]
            },
            handler: async (args) => {
                const config = await loadConfig();

                switch (args.action) {
                    case "view":
                        return JSON.stringify({ configPath: CONFIG_PATH, config }, null, 2);

                    case "add_trusted_org":
                        if (!args.value) return JSON.stringify({ error: "Value required for add_trusted_org" });
                        if (!config.trustedOrgs.map(o => o.toLowerCase()).includes(args.value.toLowerCase())) {
                            config.trustedOrgs.push(args.value.toLowerCase());
                            await saveConfig(config);
                        }
                        return JSON.stringify({ message: `Added trusted org '${args.value}'` });

                    case "remove_trusted_org":
                        if (!args.value) return JSON.stringify({ error: "Value required for remove_trusted_org" });
                        config.trustedOrgs = config.trustedOrgs.filter(o => o.toLowerCase() !== args.value.toLowerCase());
                        await saveConfig(config);
                        return JSON.stringify({ message: `Removed trusted org '${args.value}'` });

                    case "add_trusted_repo":
                        if (!args.value) return JSON.stringify({ error: "Value required for add_trusted_repo" });
                        if (!config.trustedRepos.map(r => r.toLowerCase()).includes(args.value.toLowerCase())) {
                            config.trustedRepos.push(args.value.toLowerCase());
                            await saveConfig(config);
                        }
                        return JSON.stringify({ message: `Added trusted repo '${args.value}'` });

                    case "remove_trusted_repo":
                        if (!args.value) return JSON.stringify({ error: "Value required for remove_trusted_repo" });
                        config.trustedRepos = config.trustedRepos.filter(r => r.toLowerCase() !== args.value.toLowerCase());
                        await saveConfig(config);
                        return JSON.stringify({ message: `Removed trusted repo '${args.value}'` });

                    case "set_risk_threshold":
                        const val = parseInt(args.value, 10);
                        if (isNaN(val) || val < 0 || val > 100) return JSON.stringify({ error: "Value must be a number between 0 and 100" });
                        config.maxRiskThreshold = val;
                        await saveConfig(config);
                        return JSON.stringify({ message: `Updated risk threshold to ${val}` });

                    default:
                        return JSON.stringify({ error: "Invalid configuration action" });
                }
            }
        }
    ]
});
