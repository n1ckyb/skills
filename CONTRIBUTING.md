# Contributing to Skill Explorer

Thank you for your interest in contributing to `skill-explorer`!

## Development Guidelines

1. **No External Dependencies**: Use Node.js built-in modules (`node:fs/promises`, `node:path`, `node:crypto`, `node:child_process`, `node:https`, `node:test`, `node:assert`).
2. **Code Structure**:
   - `extensions/skill-explorer/extension.mjs`: Extension registration & tool handlers.
   - `extensions/skill-explorer/lib/`: Reusable runtime & vetting modules (`url.mjs`, `config.mjs`, `github.mjs`, `vetting.mjs`, `review.mjs`, `installer.mjs`).
   - `skills/skill-explorer/SKILL.md`: Declarative agent skill instructions.
   - `tests/`: Unit tests using `node:test`.
3. **Testing**: Run tests before submitting pull requests:
   ```bash
   npm run check
   npm test
   ```
4. **Security Focus**: Any change affecting URL parsing, git execution, file bounds, or vetting rules must include corresponding unit tests in `tests/`.

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
- Validate plugin manifests with the upstream repository's
  `npm run plugin:validate` when contributing this package there.
- Run the local equivalents before submitting changes:
  `npm run skill:validate` and `npm run plugin:validate`.
