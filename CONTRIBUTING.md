# Contributing

Thanks for helping make repository instructions more dependable.

## Before opening a change

- Check existing issues and open a focused issue for substantial behavior
  changes.
- Keep the default workflow offline, deterministic, and read-only.
- Never execute commands discovered in a repository fixture.
- Add or update a fixture for every resolver or diagnostic change.

## Development

Requires Node.js 22.18 or newer.

```bash
npm run build
npm test
npm run check:self
npm run test:dist
```

Pull requests should explain the user-visible behavior, include tests, and note
any security or compatibility implications. Small, reviewable changes are
preferred.

## Reporting diagnostics

When proposing a new rule, include:

1. A minimal repository layout that triggers the issue.
2. Why the finding is actionable for a maintainer.
3. The intended severity and a false-positive example.
4. A deterministic remediation suggestion.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
