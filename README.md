# n1ckyb/skills

Community skills and companion extensions for GitHub Copilot.

## Repository layout

```text
skills/
  <skill-name>/
    SKILL.md
    README.md
extensions/
  <skill-name>/
plugins/
  <plugin-name>/
    plugin.json
    README.md
    assets/
scripts/
tests/
```

Each skill is independently discoverable under `skills/<skill-name>/SKILL.md`. A skill-specific README belongs beside its `SKILL.md`; runtime integrations belong under the matching `extensions/<skill-name>/` directory.

Plugins are declarative manifests under `plugins/<plugin-name>/`. They reference
the source skills and extensions rather than copying or materializing them.

## Available skills

### [skill-explorer](skills/skill-explorer/)

Discover, security-vet, and install Copilot skills and extensions with explicit provenance, integrity, and risk controls.

- Skill instructions: [`skills/skill-explorer/SKILL.md`](skills/skill-explorer/SKILL.md)
- User guide: [`skills/skill-explorer/README.md`](skills/skill-explorer/README.md)
- Companion extension: [`extensions/skill-explorer/`](extensions/skill-explorer/)
- Plugin manifest: [`plugins/skill-explorer/plugin.json`](plugins/skill-explorer/plugin.json)

## Development

Requirements: Node.js 18 or newer, Git, and PowerShell for the optional installation scripts.

```bash
npm run check
npm test
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development and security-testing guidance. See [`SECURITY.md`](SECURITY.md) to report vulnerabilities privately.

Discovery reports partial results explicitly when a source or synchronization check is
unavailable (`complete: false`, `degraded`, `attemptedSources`, and `sourceErrors`);
`complete: true` is emitted only when every attempted source and sync check succeeds.
The same completion state is carried into shortlist cards. Network calls use bounded HTTPS requests,
Per-operation budgets, bounded Git fallback transport, and bounded immutable revision
caching. Operation receipts expose separate HTTP, Git command, child-process,
filesystem-operation, request, and elapsed-time counters and are recorded as bounded JSONL in
`~/.copilot/skill-explorer-operation-state.jsonl`.
If persistence fails, the affected result includes an `observabilityWarning`.

## License

MIT. See [`LICENSE`](LICENSE).
