# Skill Explorer

[![Repository](https://img.shields.io/badge/GitHub-n1ckyb%2Fskills-blue?logo=github)](https://github.com/n1ckyb/skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

---

## Source Priority Hierarchy

`skill-explorer` categorizes all discovered skills into seven strict priority tiers. Source priority influences discovery ranking and provenance scores; **it never discounts security risk scores or bypasses vetting thresholds**.

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

### Clone & Global Installation (PowerShell)
Clone the repository from GitHub and run the installation script to install the extension and skill into your global profile (`~/.copilot/extensions/skill-explorer` and `~/.agents/skills/skill-explorer`):

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

## Tool Usage Guide

### 1. `skill_explorer_search`
Search for skills across canonical catalogs, AI Hero, skills.sh, and GitHub repositories.

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
  "confirmationSummary": "Install steno-mode from canonical source in user scope",
  "expectedRevision": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "expectedDigest": "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
}
```

### 5. `skill_explorer_configure`
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

`skill-explorer` implements static analysis and strict sandbox controls before installation. To report a security vulnerability, please refer to [SECURITY.md](SECURITY.md) or submit a report via [GitHub Private Security Advisories](https://github.com/n1ckyb/skills/security/advisories).

### Security Boundaries
1. **Command Injection Prevention**: Git operations use `execFile` with explicit argument arrays and `shell: false`. Non-HTTPS URLs, SSH endpoints (`git@`), local paths, and shell metacharacters are rejected.
2. **Byte Integrity**: Exact scanned bytes equal installed bytes. Installation verifies `expectedRevision` and `expectedDigest` against re-resolved upstream sources.
3. **Boundary Enforcer**: Rejects binary files, symlinks, submodules, path traversal (`..`), files > 1 MiB, total content > 5 MiB, or total files > 200.
4. **Collision Protection**: Atomic staging prevents directory corruption. Rejects installation if target exists with a differing digest.

### Static Analysis Limitations
- **No Runtime Guarantee**: Static analysis cannot detect dynamic network requests, runtime prompt injection in complex contexts, or external dependency changes after installation.
- **No Claim of Absolute Safety**: Skills are reported as `no suspicious static patterns detected`, never as "proven safe".
