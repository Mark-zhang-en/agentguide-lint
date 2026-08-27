# AgentGuide Lint

Make repository instructions reliable for human and AI-assisted contributors.

AgentGuide Lint is an experimental, offline-first CLI that explains how scoped
`AGENTS.md` instructions resolve and flags evidence-backed problems before they
reach contributors or CI.

> AgentGuide Lint is an independent open-source project and is not affiliated
> with or endorsed by OpenAI.

## Why this exists

Large repositories often layer instructions at the root and inside individual
services. A stale path, a missing script, or an unexpected override can silently
give an AI coding agent the wrong guidance. AgentGuide Lint makes that resolution
chain visible and reviewable.

The default workflow is deterministic, read-only, local, and API-free. It never
executes commands from the repository it checks.

## Quick start from source

Building from source requires Node.js 22.18 or newer and has no third-party
runtime dependencies.

```bash
git clone https://github.com/Mark-zhang-en/agentguide-lint.git
cd agentguide-lint
npm run build
node dist/cli.js check .
node dist/cli.js explain --cwd services/payments
```

Machine-readable output is available for automation:

```bash
node dist/cli.js check . --format json
node dist/cli.js check . --format sarif > agentguide.sarif
```

## GitHub Action

Pin a release tag when using the action in another repository:

```yaml
name: Agent guide checks
on: [pull_request, push]

jobs:
  agentguide:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Mark-zhang-en/agentguide-lint@v0.1.0
        with:
          path: .
          format: text
```

## What the MVP checks

- Instruction discovery from the repository root to the selected working
  directory.
- `AGENTS.override.md` precedence over `AGENTS.md` in the same directory.
- Empty instruction files and the default 32 KiB combined instruction limit.
- Unclosed Markdown code fences.
- Relative Markdown links and repository paths that no longer exist.
- Referenced package scripts that are absent from `package.json`.
- Text, JSON, and SARIF output for local use and CI.

The resolver models the documented Codex project-instruction behavior. See
[OpenAI's AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
for the upstream behavior that inspired the project.

## Commands

### `check`

Scan the applicable instruction files, report findings, and exit non-zero when
errors are found.

```bash
agentguide check [path] [--format text|json|sarif]
```

Use `--cwd directory` instead of the positional path when that is more
convenient; do not provide both.

### `explain`

Show the ordered instruction chain that applies to a directory, including files
ignored because a same-directory override won.

```bash
agentguide explain --cwd services/payments
```

## Privacy and security

AgentGuide Lint reads repository metadata and instruction files only. It does not
execute discovered commands, modify the target repository, or transmit its
contents. A future semantic-analysis layer may use an AI API only after explicit
maintainer opt-in, with visible inputs and per-repository budgets. The offline
linter will remain the default.

The linter intentionally refuses symbolic instruction files and Markdown targets
that resolve outside the selected project root. Codex itself allows symbolic
`AGENTS.md` files when its filesystem permissions permit them; AgentGuide Lint is
stricter because a standalone linter has no equivalent sandbox. Repositories that
depend on symbolic instruction files should treat the resulting diagnostic as an
intentional safety limitation.

Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Project status

This repository is newly launched and the API may change before `1.0`. Adoption
metrics are not yet available. The immediate goal is to validate the resolution
model against real monorepo layouts and expand the fixture suite across Node.js,
Python, Go, and Rust projects.

See the [roadmap](ROADMAP.md), [contribution guide](CONTRIBUTING.md), and
[code of conduct](CODE_OF_CONDUCT.md) to get involved.

## License

[MIT](LICENSE) © 2026 En Zhang.
