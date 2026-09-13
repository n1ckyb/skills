# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-09-13

### Added
- Standardized `createOperationResponse` contract and validation across all public operations (`search`, `trending`, `vet`, `install`, `sync`, `configure`).
- Static analysis and contract test suite enforcing shared response envelope and preventing ad hoc responses.
- Response schema-version migration policy with explicit `v1.x` compatibility window, deprecation metadata, and removal criteria for `2.0.0`.
- Configurable compatibility mode (`compatibilityMode: true` by default for backward compatibility; `compatibilityMode: false` for strict modern envelope).
- Time-window filtering (`--window`, `--hour`, `--day`, `--all`, `--all-windows`) in `npm run diagnostics` with window-scoped alert rates and timestamp metadata.
- Community-ready standalone repository package layout.
- Modular library structure in `extensions/skill-explorer/lib/` (`url.mjs`, `config.mjs`, `github.mjs`, `vetting.mjs`, `review.mjs`, `installer.mjs`, `operation-response.mjs`, `diagnostics.mjs`).
- Strict URL and Git subprocess hardening (`execFile`, `shell: false`, HTTPS github.com validation, rejection of credentials, query, fragments, SSH, local paths).
- Revision pinning (`sourceRevision` 40-char SHA) and deterministic content digest integrity (`contentDigest` sha256).
- Strict file bounds & security scanner (rejection of symlinks, submodules, binary files, files > 1 MiB, total > 5 MiB, > 200 files, path traversal).
- Atomic staging installer with collision handling (`ALREADY_INSTALLED` for matching digest, fail on differing digest).
- Per-rule/per-file finding deduplication in security vetting engine while maintaining conservative blocking.
- Comprehensive `node:test` test suite covering URL validation, path security, vetting, reviews, installer, config loading, response contracts, and diagnostics.
- PowerShell install and uninstall scripts (`scripts/install.ps1`, `scripts/uninstall.ps1`).
- GitHub Actions CI workflow (`.github/workflows/ci.yml`).
