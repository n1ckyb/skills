# Contributing to Skill Explorer

Thank you for your interest in contributing to `skill-explorer`!

## Development Guidelines

1. **No External Dependencies**: Use Node.js built-in modules (`node:fs/promises`, `node:path`, `node:crypto`, `node:child_process`, `node:https`, `node:test`, `node:assert`).
2. **Code Structure**:
   - `extensions/skill-explorer/extension.mjs`: Extension registration, tool handlers, and canvas wiring.
   - `extensions/skill-explorer/skill-shortlist-canvas.mjs`: Interactive shortlist canvas renderer and request actions.
   - `extensions/skill-explorer/lib/`: Reusable runtime modules. Keep the handler layer thin: `config.mjs` owns local configuration and telemetry state; `github.mjs` owns bounded GitHub/Git transport; `vetting.mjs` owns static analysis and digesting; `installer.mjs` owns atomic filesystem changes; `installation-flow.mjs` composes the pinned vet/install gates; `operation-response.mjs` owns public envelopes; `diagnostics.mjs` reads telemetry summaries; `review.mjs`, `synchronization.mjs`, `http.mjs`, and `url.mjs` provide focused support functions.
   - `skills/skill-explorer/SKILL.md`: Declarative agent skill instructions.
   - `tests/`: Unit tests using `node:test`.
3. **Response Schema Governance**:
   - Every public tool and operation must use `createOperationResponse` or `operationFailure`.
   - The mandatory static contract test requires a one-to-one match between registered handlers and `SUPPORTED_OPERATIONS`, and rejects any handler JSON response that bypasses these factories. Run `npm run contract:validate` when changing public operations.
   - Follow the response schema migration policy documented in `operation-response.mjs`.
4. **Testing & Diagnostics**: Run all validation steps before submitting changes:
   ```bash
   npm run check
   npm run skill:validate
   npm run plugin:validate
   npm test
   npm run contract:validate
   npm run origin:validate
   npm run diagnostics
   ```
5. **Telemetry Origins**: Configure `SKILL_EXPLORER_ORIGIN` explicitly as `production`, `development`, or `test` in CI, scripts, and harnesses. The production fallback remains safe for legacy callers but produces origin-resolution metadata and a warning.
6. **Security Focus**: Any change affecting URL parsing, git execution, file bounds, or vetting rules must include corresponding unit tests in `tests/`. Vetting must retain all revision, digest, risk threshold, confirmation, and atomic-install gates; false-positive reductions need both benign and malicious regression coverage.

## Plugin and extension conventions

This repository follows the official Awesome GitHub Copilot contribution model:

- Skills live in `skills/<skill-name>/` and contain `SKILL.md` frontmatter with
  a matching lowercase hyphenated `name`.
- Reusable extension source lives in `extensions/<extension-id>/`.
- Plugins live in `plugins/<plugin-id>/plugin.json` and reference source paths
  under `skills/` and `extensions/`.
- Plugin manifests must include `name`, `description`, semantic `version`,
  `author.name`, `repository`, and `license`.
- Extension plugins must include
  `extensions.com.github.copilot.logo: "assets/preview.png"` and a matching
  `assets/preview.png`.
- Do not add `canvas.json`; plugin manifests provide extension website metadata.
- Canvas controls must not bypass tool-level security gates. The shortlist
  canvas may request vetting or installation, but the extension remains
  responsible for revision, digest, risk-threshold, and confirmation checks.
- Validate plugin manifests with the upstream repository's
  `npm run plugin:validate` when contributing this package there.
- Run the local equivalents before submitting changes:
  `npm run skill:validate` and `npm run plugin:validate`.
