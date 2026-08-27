# Maintainer instructions

## Scope

These instructions apply to the whole repository. AgentGuide Lint must remain
offline, deterministic, and read-only for the repository it inspects.

## Development

- Use Node.js 22.18 or newer.
- Run `npm run build` after changing source files and commit the generated dist files.
- Run `npm test` after changing resolver, linter, formatter, or CLI behavior.
- Run `npm run test:dist` after rebuilding the distributable CLI.
- Run `npm run check:self` after changing documentation or package metadata.
- Add a focused fixture for every new diagnostic or discovery rule.
- Do not execute commands extracted from an inspected repository.
- Do not add network transmission to the default check or explain workflows.

## Pull requests

Explain the user-visible behavior, verification performed, and security impact.
Keep changes small enough to review and update README.md when CLI behavior changes.
