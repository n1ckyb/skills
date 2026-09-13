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

Discovery reports partial results explicitly when a source is unavailable (`degraded`,
`attemptedSources`, and `sourceErrors`). Network calls use bounded HTTPS requests,
per-operation budgets, and bounded immutable revision caching; operation receipts are
recorded in `~/.copilot/skill-explorer-operation-state.json`.

## License

MIT. See [`LICENSE`](LICENSE).
