# Skill Explorer plugin

The `skill-explorer` plugin bundles the Skill Explorer agent skill with its
companion Copilot extension.

## Contents

- `../../skills/skill-explorer/` - agent skill instructions and user guide
- `../../extensions/skill-explorer/` - extension source and tool handlers
- `assets/preview.png` - plugin marketplace preview asset

The plugin manifest is intentionally declarative. Source files remain in the
repository-level `skills/` and `extensions/` directories so they can be
validated and reused by other plugins.

The extension includes a `skill-shortlist` canvas. It provides `View source`,
`Request details`, `Request vetting`, and `Request install` controls for
discovered candidates. An install request does not install directly: it sends
the candidate back through the revision-pinned vetting and confirmation flow.
