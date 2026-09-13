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
scripts/
tests/
```

Each skill is independently discoverable under `skills/<skill-name>/SKILL.md`. A skill-specific README belongs beside its `SKILL.md`; runtime integrations belong under the matching `extensions/<skill-name>/` directory.

## Available skills

### [skill-explorer](skills/skill-explorer/)

Discover, security-vet, and install Copilot skills and extensions with explicit provenance, integrity, and risk controls.

- Skill instructions: [`skills/skill-explorer/SKILL.md`](skills/skill-explorer/SKILL.md)
- User guide: [`skills/skill-explorer/README.md`](skills/skill-explorer/README.md)
- Companion extension: [`extensions/skill-explorer/`](extensions/skill-explorer/)

## Development

Requirements: Node.js 18 or newer, Git, and PowerShell for the optional installation scripts.

```bash
npm run check
npm test
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development and security-testing guidance. See [`SECURITY.md`](SECURITY.md) to report vulnerabilities privately.

## License

MIT. See [`LICENSE`](LICENSE).
