# Skill Explorer

[![Repository](https://img.shields.io/badge/GitHub-n1ckyb%2Fskills-blue?logo=github)](https://github.com/n1ckyb/skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

`skill-explorer` is a community-ready global extension and agent skill for discovering, security-vetting, and safely installing GitHub Copilot CLI skills and extensions from canonical catalogs, official repositories, and community sources.

**Repository Target**: [https://github.com/n1ckyb/skills](https://github.com/n1ckyb/skills)

---

## Key Features

- **Multi-Tiered Source Priority**: Automatically prioritizes canonical and high-trust catalogs before querying broader registries.
- **Static Security Vetting**: Scans candidate skill definitions and source code for execution risks, credential exfiltration, prompt injection, and obfuscation.
- **Immutable Revision & Digest Pinning**: Pins vetting and installation to 40-character commit SHAs (`sourceRevision`) and deterministic SHA-256 byte hashes (`contentDigest`).
- **Strict Boundary Checks**: Enforces limits on file count (<=200), single file size (<=1 MiB), total size (<=5 MiB), path safety (no `..` or absolute paths), and rejects symlinks, submodules, and binary files.
- **Atomic Staging Installer**: Installs via temporary staging directories, prevents overwriting existing installs unless digests match (`ALREADY_INSTALLED`), and cleans staging on failure.
- **Interactive Chat UX**: Renders search and trending results using native `inbox` card widgets with clear trust and status labels.
- **Interactive Shortlist**: Opens a `skill-shortlist` canvas with source, details, vetting, and install-request controls; “Fetch more skills” appends deduplicated results to the open shortlist; install requests still require review and explicit confirmation.
- **Open Skills Ecosystem Discovery**: Uses the skills.sh leaderboard and `npx skills find` for broad discovery metadata before independently vetting a candidate.
- **Standardized Response Envelope**: All public operations return a structured envelope with schema versioning, completion state, bounded diagnostics, and migration metadata.
- **Time-Windowed Reliability Diagnostics**: Local diagnostic reporting with configurable time windows (`1h`, `24h`, `7d`, `all`) and threshold alerts.

---

## Source Priority Hierarchy

`skill-explorer` categorizes all discovered skills into seven strict priority tiers. Source priority influences discovery ranking and provenance scores; **it never discounts security risk scores or bypasses vetting thresholds**. Skills.sh install counts and leaderboard ranks are discovery metadata, not approval.

| Tier | Priority Label | Source Description |
| :--- | :--- | :--- |
| **P0** | Priority 0: Canonical Awesome GitHub Copilot Skill | `github/awesome-copilot` catalog (`skills/`) |
| **P1** | Priority 1: AI Hero Skills | `mattpocock/skills` repository |
| **P2** | Priority 2: The Agent Skills Directory | `skills.sh` public indexes (all-time, hot, 24h) |
| **P3** | Priority 3: Official Source | GitHub, Microsoft, Azure organization repos |
| **P4** | Priority 4: Configured Trusted Source | Repositories/orgs listed in user config whitelist |
| **P5** | Priority 5: Verified Community | Community repos with > 50 stars or `copilot-skill` topic |
| **P6** | Priority 6: Unverified Community | General public GitHub search results |

---

## Interactive Card Behavior (Textual Representation)

When searching or listing trending skills, `skill-explorer` renders interactive native cards in the chat UI:

Results that were previously installed by Skill Explorer are compared with their recorded source revision and content digest. Unchanged skills are omitted from discovery; changed skills remain visible with an update status. Legacy installs without Skill Explorer metadata remain visible so they are not incorrectly treated as synchronized.

Use `skill_explorer_sync` to update explicitly selected tracked installations. Synchronization re-vets each exact upstream folder and requires explicit approval before replacing different local content.

```
+-----------------------------------------------------------------------+
| [Card] steno-mode                                                     |
| Priority 0: Canonical Awesome GitHub Copilot Skill                    |
| https://github.com/github/awesome-copilot/tree/main/skills/steno-mode |
|                                                                       |
| Status Badges: [Canonical] [Not Vetted]                                |
| Description: Shorthand-first response compression skill for Copilot.  |
+-----------------------------------------------------------------------+
```

When a skill is vetted, the card status updates dynamically:
- **Vetted & Safe**: `[Status: Safe]` (Green status indicator)
- **Review Needed**: `[Status: Review]` (Yellow status indicator)
- **Blocked by Policy**: `[Status: Blocked]` (Red status indicator)

---

## Installation & Setup

### Requirements
- Node.js 18.0.0 or higher.
- GitHub Copilot CLI environment.
- Git CLI (`git`) for repository cloning.
- Optional `npx skills` CLI for open agent skills discovery.

### Clone & Global Installation (PowerShell)
Clone the repository from GitHub and run the installation script to install the `skill-explorer` extension and skill into your global profile (`~/.copilot/extensions/skill-explorer` and `~/.agents/skills/skill-explorer`):

The repository uses a multi-skill layout: each skill lives under `skills/<skill-name>/` and each companion extension under `extensions/<skill-name>/`.

```powershell
git clone https://github.com/n1ckyb/skills.git
cd skills
.\scripts\install.ps1
```

### Uninstallation (PowerShell)
To uninstall the global extension and skill:

```powershell
.\scripts\uninstall.ps1
```

To also delete your configuration file (`~/.copilot/skill-explorer-config.json`):

```powershell
.\scripts\uninstall.ps1 -RemoveConfig
```

---

## Response Schema Versioning & Migration Policy

All operation responses use `schemaVersion: "1.0.0"`.

### Migration Policy
- **Compatibility Window**: Backward compatibility is guaranteed throughout the `v1.x` lifecycle (minimum 6 months deprecation window before `2.0.0`).
- **Compatibility Mode**: Handlers default to `compatibilityMode: true` to preserve legacy fields. Strict modern consumers can specify `compatibilityMode: false` to omit legacy fields.
- **Legacy Field Deprecations**:
  - `searchQuery` -> Migrate to `operationReceipt.query` or tool input parameters.
  - `totalCount` -> Migrate to `resultCount` and `operationReceipt.resultCount`.
  - `canonicalSource`, `secondarySource`, `directorySource`, `source` -> Migrate to `attemptedSources` and `sourceAvailability`.
  - `priorityOrdering` -> Migrate to item `trustTierLabel` and schema documentation.
  - `period`, `rankingNote` -> Migrate to individual card badges and `chatUx` metadata.
  - `findingsCount` -> Migrate to `findings.length` or vetting receipt summary.
  - `recommendation` -> Migrate to `verdict`, `isBlocked`, and structured review.
- **Removal Criteria for v2.0.0**:
  1. Completion of the `v1.x` compatibility window.
  2. Telemetry and test coverage confirming zero dependency on legacy top-level fields.
  3. Formal major semver bump to `2.0.0` with migration documentation.

---

## Local Diagnostics & Window Filtering

Run `npm run diagnostics` to inspect local duration, budget exhaustion, source availability, state compaction, fallback frequency, and automated threshold alerts.

```powershell
# Default: all retained local JSONL history
npm run diagnostics

# Scope to recent 1 hour
npm run diagnostics -- --window 1h

# Scope to recent 24 hours
npm run diagnostics -- --window 24h

# Matrix view across standard windows
npm run diagnostics -- --all-windows
```

The report includes window timestamps (`startTime`, `endTime`), total vs. filtered record counts, alert rates per window, and threshold alerts without sending any remote telemetry.

---

## Tool Usage Guide

### 1. `skill_explorer_search`
Search for skills across canonical catalogs, AI Hero, the open agent skills ecosystem, and GitHub repositories.

```json
{
  "query": "docker",
  "source": "all"
}
```

### 2. `skill_explorer_trending`
Retrieve top trending skills from `skills.sh`.

```json
{
  "period": "trending24h",
  "limit": 20
}
```

### 3. `skill_explorer_vet`
Perform static security analysis and return structured review, `sourceRevision` (40-char SHA), and `contentDigest` (`sha256`).

```json
{
  "repoOrUrl": "github/awesome-copilot/skills/steno-mode"
}
```

### 4. `skill_explorer_install`
Atomically install a vetted skill after explicit user confirmation.

```json
{
  "repoOrUrl": "github/awesome-copilot/skills/steno-mode",
  "scope": "user",
  "userConfirmed": true,
  "confirmationSummary": "Install github/awesome-copilot/skills/steno-mode in user scope at a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 with digest sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
  "expectedRevision": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "expectedDigest": "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
}
```

### 5. `skill_explorer_sync`
Re-vet and synchronize tracked installations.

```json
{
  "skills": [
    {
      "repoOrUrl": "mattpocock/skills/skills/engineering/code-review",
      "scope": "user",
      "expectedRevision": "3cca18b368ae95cdbdebbff572ccafa662551015",
      "expectedDigest": "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
    }
  ],
  "userConfirmed": true,
  "confirmationSummary": "Sync code-review to latest vetted upstream revision",
  "replaceExisting": true
}
```

### 6. `skill_explorer_configure`
View or update user configurations.

```json
{
  "action": "set_risk_threshold",
  "value": "40"
}
```

---

## Configuration

Configuration is stored at `~/.copilot/skill-explorer-config.json`:

```json
{
  "canonicalSkillsRepo": "github/awesome-copilot",
  "agentSkillsDirectory": "https://www.skills.sh",
  "trustedOrgs": ["github", "copilot-extensions", "microsoft", "azure", "actions"],
  "trustedRepos": [
    "github/awesome-copilot",
    "mattpocock/skills",
    "github/copilot-cli"
  ],
  "maxRiskThreshold": 50,
  "autoVetBeforeInstall": true
}
```

---

## Review & Rating Methodology

The structured review engine calculates an overall quality score out of 10 based on weighted metrics:

$$\text{Overall Score} = (\text{Utility} \times 0.30) + (\text{Clarity} \times 0.25) + (\text{Safety} \times 0.35) + (\text{Provenance} \times 0.10)$$

- **Utility (30%)**: Purpose clarity, file structure, and workflow examples.
- **Clarity (25%)**: Structural headings, documentation completeness, and safety guidance.
- **Safety (35%)**: Inversed static risk score ($100 - \text{RiskScore}$).
- **Provenance (10%)**: Trust hierarchy of the source repository.
- **Popularity**: Explicitly excluded from ratings calculation.

---

## Threat Model & Security Policy

`skill-explorer` implements static analysis and strict sandbox controls before installation. To report a security vulnerability, please refer to [SECURITY.md](../../SECURITY.md) or submit a report via [GitHub Private Security Advisories](https://github.com/n1ckyb/skills/security/advisories).

### Security Boundaries
1. **Command Injection Prevention**: Git operations use `execFile` with explicit argument arrays and `shell: false`. Non-HTTPS URLs, SSH endpoints (`git@`), local paths, and shell metacharacters are rejected.
2. **Byte Integrity**: Exact scanned bytes equal installed bytes. Installation verifies `expectedRevision` and `expectedDigest` against re-resolved upstream sources.
3. **Boundary Enforcer**: Rejects binary files, symlinks, submodules, path traversal (`..`), files > 1 MiB, total content > 5 MiB, or total files > 200.
4. **Collision Protection**: Atomic staging prevents directory corruption. Rejects installation if target exists with a differing digest.

### Static Analysis Limitations
- **No Runtime Guarantee**: Static analysis cannot detect dynamic network requests, runtime prompt injection in complex contexts, or external dependency changes after installation.
- **No Claim of Absolute Safety**: Skills are reported as `no suspicious static patterns detected`, never as "proven safe".
