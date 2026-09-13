# Contributing to Skill Explorer

Thank you for your interest in contributing to `skill-explorer`!

## Development Guidelines

1. **No External Dependencies**: Use Node.js built-in modules (`node:fs/promises`, `node:path`, `node:crypto`, `node:child_process`, `node:https`, `node:test`, `node:assert`).
2. **Code Structure**:
   - `extension/extension.mjs`: Extension registration & tool handlers.
   - `extension/lib/`: Reusable runtime & vetting modules (`url.mjs`, `config.mjs`, `github.mjs`, `vetting.mjs`, `review.mjs`, `installer.mjs`).
   - `skill/SKILL.md`: Declarative agent skill instructions.
   - `tests/`: Unit tests using `node:test`.
3. **Testing**: Run tests before submitting pull requests:
   ```bash
   npm run check
   npm test
   ```
4. **Security Focus**: Any change affecting URL parsing, git execution, file bounds, or vetting rules must include corresponding unit tests in `tests/`.
