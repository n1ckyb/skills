# Security Policy

## Threat Model & Security Approach

`skill-explorer` provides static security analysis and controlled installation workflows for Copilot CLI skills and extensions.

### Core Security Controls
1. **Subprocess Isolation**: Uses `execFile`/`spawn` with explicit argument arrays and `shell: false`. Rejects non-HTTPS GitHub URLs, SSH, file paths, credentials, query strings, fragments, and unauthorized hosts.
2. **Revision & Digest Pinning**: Requires 40-character commit SHAs (`expectedRevision`) and sha256 digests (`expectedDigest`). Re-resolves upstream content at exact revision and enforces byte-level equality.
3. **File Scanning Bounds**: Rejects symlinks, submodules (`.git`, `.gitmodules`), binary files, files > 1 MiB, total size > 5 MiB, total files > 200, and path traversal (`..`). Scanned bytes equal installed bytes.
4. **Atomic Staging & Collision Guards**: Installs via staging sibling directories. Fails if target exists unless content digest matches (`ALREADY_INSTALLED`). Staging is cleaned up on failure.
5. **Independent Vetting & Trust Isolation**: Provenance priority (canonical, official, trusted) affects discovery ranking only. It **never** discounts risk scores or bypasses vetting thresholds.

### Limitations
- **Static Analysis**: Cannot detect arbitrary runtime prompt injection, multi-step social engineering, or dynamic network fetch execution outside scanned static files.
- **Dependencies**: External APIs (GitHub API, skills.sh) or downstream dependency updates can change behavior.
- **Environment**: User confirmation and agent adherence to `SKILL.md` workflows are essential layers of defense.

## Reporting a Vulnerability

If you discover a security vulnerability, please do not file a public issue. Report details privately via [GitHub Private Security Advisory](https://github.com/n1ckyb/skills/security/advisories/new) or directly on the [n1ckyb/skills Security Advisories page](https://github.com/n1ckyb/skills/security/advisories).
