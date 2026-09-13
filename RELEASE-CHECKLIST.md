# Release Checklist

Complete these checks before tagging a new release of `skill-explorer`:

- [ ] Run `npm run check` to verify syntax across all ESM files.
- [ ] Run `npm test` to pass all unit test suites.
- [ ] Verify `SKILL.md` matches extension tool parameter schemas (`expectedRevision`, `expectedDigest`).
- [ ] Test PowerShell installation (`scripts/install.ps1`) on a clean environment.
- [ ] Test PowerShell uninstallation (`scripts/uninstall.ps1`) with and without `-RemoveConfig`.
- [ ] Verify `README.md` threat model and limitations sections are up to date.
- [ ] Ensure no console output or unhandled promise rejections exist in production code paths.
