# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-09-13

### Security
- Closed a vetting evasion path where actionable instructions written as unfenced documentation prose (for example, telling the agent to pipe a remote script into a shell, or to delete credential files) scored zero and installed cleanly. Code-execution, credential, network, and destructive-operation rules now scan actionable prose in skill documents and in files without a recognized extension, while descriptive and defensive references remain suppressed.
- Hardened the static response-contract check so ad hoc `JSON.stringify` returns (object literals and bare identifiers) can no longer be masked by a valid factory return elsewhere in the same handler.

### Fixed
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
