# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-09-13

### Security
- Made the risk threshold fail closed. `isBlocked` compared `riskScore >= config.maxRiskThreshold` directly, so a non-numeric threshold (for example `"abc"` or `NaN` from a corrupted or hand-edited `~/.copilot/skill-explorer-config.json`) evaluated to `false` for every score and silently disabled installation blocking entirely. Thresholds are now resolved through `resolveRiskThreshold`, which falls back to the default for any non-finite or out-of-range value.
- Sanitized persisted configuration on load. `loadConfig` previously merged user JSON straight over the defaults with no validation, so `trustedOrgs` could be a bare string, turning the `.includes(owner)` trust check into a substring match in which an entry of `corp` would trust `evilcorp`. Trust lists, the risk threshold and `autoVetBeforeInstall` are now validated, with a warning emitted for each replaced field.
- Restricted HTTP redirects to an explicit host allowlist. Only the protocol was previously checked, so any upstream could redirect to an arbitrary HTTPS host and serve skill content under trusted-looking provenance.
- Credential-bearing headers (`Authorization`, `Cookie`, `Proxy-Authorization`, `X-*-Token`/`Key`/`Auth`) are now dropped on cross-origin redirects rather than being replayed to the new host.
- Validated every field parsed out of a GitHub tree URL before it reaches the filesystem or Git. `parseGitHubTreeUrl` previously performed no validation at all, so a crafted source such as `.../tree/main/../../etc` escaped the temporary clone directory during the Git clone fallback (which triggers routinely on API rate limits) and could read arbitrary local files. Owner, repo, ref and folder are now each validated, and the parser returns `null` on any failure.
- Added `isSafeGitRef`, rejecting option-like refs (`--upload-pack=...`), `..` sequences, `.lock` suffixes and other malformed refs before they are passed as arguments to `git ls-remote`.
- Enforced containment at both skill-folder read sites: a resolved folder that is not inside its checkout root is rejected, so a caller that forgets to validate cannot turn a traversal sequence into a local file disclosure.
- Validated owner, repo and slug in `parseSkillsRegistryUrl`.
- Inverted static-vetting polarity so every line of every file is scanned by default, including unfenced documentation prose. Suppression is now the narrow exception: a finding is dropped only when a negation directly governs that specific match within its own clause, and clause boundaries (sentence end, comma, contrastive conjunction, list/table delimiter) end that protection. This closes an evasion where an unrelated negation word anywhere on the line (for example `never`, `without`, or `detects`) zeroed the risk score and allowed a payload such as a piped remote install to install cleanly.
- Removed phrasing-based directive detection, which only recognized an allowlist of instruction verbs and missed most realistic attacker phrasings.
- Suppressed matches no longer mask a live payload later in the same line; all matches of a rule are evaluated.
- Exempted bare `node:` module specifiers, which name a module rather than perform an operation; call sites are still flagged.
- Hardened the static response-contract check so ad hoc `JSON.stringify` returns (object literals and bare identifiers) can no longer be masked by a valid factory return elsewhere in the same handler.

### Fixed
- Operation state logging now survives a corrupted line. A single truncated JSONL record (a process killed mid-append, or a concurrent writer in another process) previously made `loadOperationState` throw, which permanently broke every subsequent append and compaction attempt with no way to self-heal. Malformed lines are now skipped, counted into the observability warning, and removed from disk on the next compaction.
- `skill_explorer_vet` now forwards the origin-classification `observabilityWarning` and the vetting receipt into its response envelope instead of silently dropping them.

### Added
- Standardized `createOperationResponse` contract and validation across all public operations (`search`, `trending`, `vet`, `install`, `sync`, `configure`).
- Static analysis and contract test suite enforcing shared response envelope and preventing ad hoc responses.
- Response schema-version migration policy with explicit `v1.x` compatibility window, deprecation metadata, and removal criteria for `2.0.0`.
- Configurable compatibility mode (`compatibilityMode: true` by default for backward compatibility; `compatibilityMode: false` for strict modern envelope).
- Telemetry origin/environment markers (`origin`, `environment`) in persisted operation records with deterministic resolution precedence (`options.origin`, `SKILL_EXPLORER_ORIGIN`, `SKILL_EXPLORER_ENV`, `COPILOT_ENVIRONMENT`, `NODE_ENV`, defaulting safely to `production`).
- Origin and environment filtering in diagnostics engine (`filterRecordsByOrigin`, `normalizeOriginFilter`, `recordsByOrigin` breakdown, origin-scoped threshold alerts).
- Diagnostics CLI enhancements supporting origin flags (`--origin`, `-o`, `--prod`, `--dev`, `--test`, `--all-origins`) and cross-matrices with time windows (`--all-windows`, `--window`).
- Modular library boundaries with detailed JSDoc architecture contracts across `operation-response.mjs`, `installation-flow.mjs`, `installer.mjs`, `synchronization.mjs`, `review.mjs`, `vetting.mjs`, `config.mjs`, `diagnostics.mjs`, `http.mjs`, `url.mjs`, and `github.mjs`.
- Export of structured `VETTING_RULES` with documented rule classifications, false-positive analysis, and static analysis limitations.
- Time-window filtering (`--window`, `--hour`, `--day`, `--all`, `--all-windows`) in `npm run diagnostics` with window-scoped alert rates and timestamp metadata.
- Community-ready standalone repository package layout.
- Modular library structure in `extensions/skill-explorer/lib/` (`url.mjs`, `config.mjs`, `github.mjs`, `vetting.mjs`, `review.mjs`, `installer.mjs`, `operation-response.mjs`, `diagnostics.mjs`).
- Strict URL and Git subprocess hardening (`execFile`, `shell: false`, HTTPS github.com validation, rejection of credentials, query, fragments, SSH, local paths).
- Revision pinning (`sourceRevision` 40-char SHA) and deterministic content digest integrity (`contentDigest` sha256).
- Strict file bounds & security scanner (rejection of symlinks, submodules, binary files, files > 1 MiB, total > 5 MiB, > 200 files, path traversal).
- Atomic staging installer with collision handling (`ALREADY_INSTALLED` for matching digest, fail on differing digest).
- Per-rule/per-file finding deduplication in security vetting engine while maintaining conservative blocking.
- Comprehensive `node:test` test suite covering URL validation, path security, vetting, reviews, installer, config loading, response contracts, origin markers, and diagnostics.
- PowerShell install and uninstall scripts (`scripts/install.ps1`, `scripts/uninstall.ps1`).
- GitHub Actions CI workflow (`.github/workflows/ci.yml`).
