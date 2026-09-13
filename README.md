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
    lib/
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

### Skill Explorer module boundaries

`extension.mjs` registers public tools and translates their results to the shared response envelope; it does not own transport, policy, or filesystem behavior. The `lib/` modules remain deliberately narrow: `config.mjs` owns local state and origin classification, `github.mjs`/`http.mjs` own bounded remote transport, `vetting.mjs` owns static analysis and immutable digests, `installation-flow.mjs` enforces approval and pinning policy, `installer.mjs` makes filesystem changes atomically, and `diagnostics.mjs` only summarizes recorded local state. This separation keeps the security gates centralized without a broad rewrite.

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
npm run diagnostics
```

Development and test runs should set `SKILL_EXPLORER_ORIGIN` explicitly. `npm test` sets it to `test`; use `npm run diagnostics:prod`, `npm run diagnostics:dev`, or `npm run diagnostics:test` for intentionally separated local diagnostic views.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development and security-testing guidance. See [`SECURITY.md`](SECURITY.md) to report vulnerabilities privately.

Discovery reports partial results explicitly when a source or synchronization check is
unavailable (`complete: false`, `degraded`, `attemptedSources`, and `sourceErrors`);
`complete: true` is emitted only when every attempted source and sync check succeeds.
The same completion state is carried into shortlist cards. Network calls use bounded HTTPS requests,
per-operation budgets, bounded Git fallback transport, and bounded immutable revision
caching. Operation receipts expose separate HTTP, Git command, child-process,
filesystem-operation, request, and elapsed-time counters and are recorded as bounded JSONL in
`~/.copilot/skill-explorer-operation-state.jsonl`.
If persistence fails, the affected result includes an `observabilityWarning`.

### Standardized Response Envelope & Migration Policy

Search, trending, vet, install, sync, configure, failure, and confirmation responses share one
standardized envelope (`schemaVersion: "1.0.0"`) with `operation`, `schemaVersion`, `complete`,
`degraded`, `counters`, bounded diagnostics (`sourceErrors`, `attemptedSources`, `diagnosticCounts`), `warnings`,
`budgetExhausted`, `operationReceipt`, and `deprecationGuidance` for legacy operation-specific fields.

- **Compatibility Window**: Backward compatibility is preserved by default throughout all `1.x` releases (minimum 6-month deprecation lifecycle).
- **Migration Policy**: Legacy top-level fields (`searchQuery`, `totalCount`, `canonicalSource`, `secondarySource`, `directorySource`, `priorityOrdering`, `source`, `period`, `rankingNote`, `findingsCount`, `recommendation`) are scheduled for removal in `2.0.0`. Their replacement targets are documented in `deprecationGuidance` and `operationReceipt.migrationPolicy`.
- **Compatibility Mode**: Handlers support `compatibilityMode: false` for strict modern envelope consumers, omitting legacy fields while retaining standard envelope fields and receipts.

### Telemetry Origin Markers & Environment Resolution

Operation state entries persist explicit `origin` and `environment` markers (`production`, `development`, `test`), ensuring test and development telemetry do not pollute production reliability metrics:

1. Explicit operation option (`options.origin`).
2. `SKILL_EXPLORER_ORIGIN` or `SKILL_EXPLORER_ENV` environment variable.
3. `COPILOT_ENVIRONMENT` environment variable.
4. `NODE_ENV` heuristic mapping (`test` -> `test`, `dev`/`development` -> `development`, other -> `production`).
5. Safe fallback default: `"production"`.

When this final fallback is used, the receipt and stored record include `originResolution` metadata and an `observabilityWarning`; diagnostics surface the count so implicit production classification is visible rather than silent.

### Local Diagnostics, Origin Filtering & Time Windows

Run `npm run diagnostics` to summarize local operation durations, exhausted budgets,
source availability, state compaction, fallback frequency, and automated threshold alerts (for rising
budget exhaustion, high source failure rates, Git fallback usage, or state compaction drops).

- **Default**: Evaluates all retained local JSONL history across all origins.
- **Time Windows**: Use `--window <1h|24h|7d|all>` (or shorthand flags `--hour`, `--day`, `--all`, or matrix view `--all-windows`) to scope alert rates and counts to recent operational windows.
- **Origin Scoping**: Use `--origin <production|development|test|all>` (or shorthand flags `--prod`, `--dev`, `--test`, `--all-origins`) to filter operational metrics by origin/environment.
- **Cross-Matrix**: Combine `--all-windows` with `--origin` or `--all-origins` with `--window` to produce multi-dimensional diagnostic reports.
- The diagnostic command reads local JSONL state only and sends no remote telemetry.

## License

MIT. See [`LICENSE`](LICENSE).
