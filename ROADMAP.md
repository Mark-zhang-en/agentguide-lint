# Roadmap

## 0.1 — Deterministic foundation

- Resolve scoped `AGENTS.md` and `AGENTS.override.md` files.
- Explain effective instruction chains.
- Validate links, paths, Markdown fences, and package scripts.
- Emit text, JSON, and SARIF results.
- Test nested and monorepo fixtures.

## 0.2 — CI and ecosystem coverage

- Publish a reusable GitHub Action.
- Add project-fact detectors for Python, Go, Rust, and common monorepo tools.
- Add configuration for fallback instruction filenames and size limits.
- Add an explicit, opt-in policy for trusted symbolic instruction files.
- Establish a public false-positive and performance benchmark.

## 0.3 — Opt-in semantic analysis

- Detect contradictory or ambiguous instructions across scopes.
- Propose concise patches for maintainer review.
- Show the exact content sent to an AI provider before transmission.
- Enforce repository budgets, redaction rules, and auditable evaluation runs.

The offline linter will remain the default. Roadmap items are proposals, not
commitments, and will be shaped by maintainer and contributor feedback.
