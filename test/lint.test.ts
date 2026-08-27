import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkProject } from "../src/lint.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentguide-lint-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

test("checks relative inline and reference Markdown targets", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "existing file.md"), "ok\n");
  await writeFile(
    path.join(root, "AGENTS.md"),
    [
      "[good](<docs/existing%20file.md>)",
      "[bad](docs/missing.md#section)",
      "[external](https://example.com/file.md)",
      "[anchor](#local)",
      "`[inline sample](docs/not-real.md)`",
      "[reference]: docs/also-missing.md",
      "```md",
      "[fenced sample](docs/not-real-either.md)",
      "```",
    ].join("\n"),
  );

  const { diagnostics } = await checkProject({ cwd: root });
  const missing = diagnostics.filter(
    (diagnostic) => diagnostic.ruleId === "missing-relative-path",
  );

  assert.deepEqual(
    missing.map((diagnostic) => diagnostic.line),
    [2, 6],
  );
  assert.match(missing[0]?.message ?? "", /docs\/missing\.md/);
});

test("reports the opening line of an unclosed Markdown fence", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "AGENTS.md"),
    "# Commands\n\n~~~sh\nnpm test\n",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );

  const { diagnostics } = await checkProject({ cwd: root });
  const fence = diagnostics.find(
    (diagnostic) => diagnostic.ruleId === "unclosed-code-fence",
  );

  assert.equal(fence?.line, 3);
  assert.equal(fence?.column, 1);
  assert.equal(
    diagnostics.some((diagnostic) =>
      diagnostic.ruleId.includes("package-script"),
    ),
    false,
  );
});

test("validates npm, pnpm and yarn script references", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", build: "node build.js" } }),
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    [
      "Run `npm test` before sending a change.",
      "Then use `pnpm build`.",
      "The release task is `npm run release`.",
      "Formatting uses `yarn lint`.",
      "Installing dependencies with `npm install` is not a script reference.",
    ].join("\n"),
  );

  const { diagnostics } = await checkProject({ cwd: root });
  const missing = diagnostics.filter(
    (diagnostic) => diagnostic.ruleId === "missing-package-script",
  );

  assert.deepEqual(
    missing.map((diagnostic) => [diagnostic.line, diagnostic.message]),
    [
      [3, 'npm references missing package.json script "release".'],
      [4, 'yarn references missing package.json script "lint".'],
    ],
  );
});

test("does not treat sentence punctuation as part of a package script", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { build: "node build.js", "test.unit": "node --test" },
    }),
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Run npm run build. Then run pnpm test.unit.\n",
  );

  const { diagnostics } = await checkProject({ cwd: root });

  assert.equal(
    diagnostics.some(
      (diagnostic) => diagnostic.ruleId === "missing-package-script",
    ),
    false,
  );
});

test("reports a command when no package.json can be found", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "AGENTS.md"), "Run npm test.\n");

  const { diagnostics } = await checkProject({ cwd: root });

  assert.equal(diagnostics[0]?.ruleId, "package-json-missing");
});

test("does not lint content shadowed by a same-directory override", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "AGENTS.override.md"), "Use local checks.\n");
  await writeFile(
    path.join(root, "AGENTS.md"),
    "[broken](missing.md)\n```\n",
  );

  const { resolution, diagnostics } = await checkProject({ cwd: root });

  assert.equal(path.basename(resolution.selected[0]?.path ?? ""), "AGENTS.override.md");
  assert.deepEqual(diagnostics, []);
});

test("does not follow Markdown targets outside the project root", async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentguide-target-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  await writeFile(path.join(outside, "private.md"), "private\n");
  await symlink(outside, path.join(root, "linked-docs"));
  await writeFile(
    path.join(root, "AGENTS.md"),
    [
      "[lexical escape](../outside.md)",
      "[symlink escape](linked-docs/private.md)",
    ].join("\n"),
  );

  const { diagnostics } = await checkProject({ cwd: root });
  const escapes = diagnostics.filter(
    (diagnostic) => diagnostic.ruleId === "relative-path-outside-root",
  );

  assert.equal(escapes.length, 2);
});

test("does not read a symbolic package.json", async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentguide-package-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const outsidePackage = path.join(outside, "package.json");
  await writeFile(outsidePackage, JSON.stringify({ scripts: { test: "secret" } }));
  await symlink(outsidePackage, path.join(root, "package.json"));
  await writeFile(path.join(root, "AGENTS.md"), "Run npm test.\n");

  const { diagnostics } = await checkProject({ cwd: root });

  assert.equal(diagnostics[0]?.ruleId, "package-json-error");
  assert.match(diagnostics[0]?.message ?? "", /Symbolic package\.json/);
});
