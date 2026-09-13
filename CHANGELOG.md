# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-09-13

### Added
- Community-ready standalone repository package layout.
- Modular library structure in `extension/lib/` (`url.mjs`, `config.mjs`, `github.mjs`, `vetting.mjs`, `review.mjs`, `installer.mjs`).
- Strict URL and Git subprocess hardening (`execFile`, `shell: false`, HTTPS github.com validation, rejection of credentials, query, fragments, SSH, local paths).
- Revision pinning (`sourceRevision` 40-char SHA) and deterministic content digest integrity (`contentDigest` sha256).
- Strict file bounds & security scanner (rejection of symlinks, submodules, binary files, files > 1 MiB, total > 5 MiB, > 200 files, path traversal).
- Atomic staging installer with collision handling (`ALREADY_INSTALLED` for matching digest, fail on differing digest).
- Per-rule/per-file finding deduplication in security vetting engine while maintaining conservative blocking.
- Comprehensive `node:test` test suite covering URL validation, path security, vetting, reviews, installer, and config loading.
- PowerShell install and uninstall scripts (`scripts/install.ps1`, `scripts/uninstall.ps1`).
- GitHub Actions CI workflow (`.github/workflows/ci.yml`).
