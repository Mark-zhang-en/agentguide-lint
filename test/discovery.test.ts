import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ConfigurationError,
  findProjectRoot,
  projectDirectories,
  resolveGuides,
} from "../src/discovery.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentguide-discovery-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

test("resolves one non-empty guide per directory with override precedence", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "packages", "app");
  const cwd = path.join(app, "src");
  await mkdir(cwd, { recursive: true });

  await writeFile(path.join(root, "AGENTS.md"), "root standard\n");
  await writeFile(path.join(root, "AGENTS.override.md"), "root override\n");
  await writeFile(path.join(app, "AGENTS.override.md"), "  \n");
  await writeFile(path.join(app, "AGENTS.md"), "app standard\n");

  const resolution = await resolveGuides({ cwd });

  assert.equal(resolution.root, root);
  assert.deepEqual(
    resolution.selected.map((guide) => path.relative(root, guide.path)),
    ["AGENTS.override.md"],
  );
  assert.equal(
    new Set(resolution.selected.map((guide) => guide.directory)).size,
    resolution.selected.length,
  );
  assert.equal(
    resolution.candidates.find(
      (candidate) => candidate.path === path.join(root, "AGENTS.md"),
    )?.status,
    "shadowed",
  );
  assert.deepEqual(
    resolution.candidates
      .filter((candidate) => candidate.directory === root)
      .map((candidate) => path.basename(candidate.path)),
    ["AGENTS.override.md", "AGENTS.md"],
  );
  assert.equal(
    resolution.candidates.find(
      (candidate) => candidate.path === path.join(app, "AGENTS.override.md"),
    )?.status,
    "empty",
  );
  assert.equal(
    resolution.candidates.find(
      (candidate) => candidate.path === path.join(app, "AGENTS.md"),
    )?.status,
    "shadowed",
  );
  assert.deepEqual(
    resolution.diagnostics.map((diagnostic) => diagnostic.ruleId),
    ["empty-guide"],
  );
  assert.equal(
    resolution.totalBytes,
    Buffer.byteLength("root override\n"),
  );
});

test("truncates later project guidance to the combined byte limit", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = path.join(root, "child");
  await mkdir(child);
  await writeFile(path.join(root, "AGENTS.md"), "123456");
  await writeFile(path.join(child, "AGENTS.md"), "abcdef");

  const resolution = await resolveGuides({ cwd: child, maxBytes: 10 });

  assert.equal(resolution.selected.length, 2);
  assert.equal(resolution.selected[1]?.content, "abcd");
  assert.equal(resolution.selected[1]?.bytes, 4);
  assert.equal(resolution.totalBytes, 10);
  assert.equal(
    resolution.diagnostics.at(-1)?.ruleId,
    "guide-truncated",
  );
  assert.equal(resolution.diagnostics.at(-1)?.severity, "warning");
});

test("finds the nearest git project root and validates the root boundary", async (t) => {
  const root = await fixture();
  const outside = await fixture();
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const nested = path.join(root, "a", "b");
  await mkdir(nested, { recursive: true });

  assert.equal(await findProjectRoot(nested), root);
  assert.deepEqual(projectDirectories(root, nested), [
    root,
    path.join(root, "a"),
    nested,
  ]);
  assert.throws(
    () => projectDirectories(root, outside),
    ConfigurationError,
  );
});

test("ignores a directory that happens to use an instruction filename", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "AGENTS.md"));

  const resolution = await resolveGuides({ cwd: root });

  assert.equal(resolution.selected.length, 0);
  assert.equal(resolution.candidates[0]?.status, "unreadable");
  assert.equal(resolution.diagnostics[0]?.ruleId, "guide-read-error");
});

test("does not read a symbolic instruction file", async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentguide-outside-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const outsideGuide = path.join(outside, "private.md");
  await writeFile(outsideGuide, "Do not read this.\n");
  await symlink(outsideGuide, path.join(root, "AGENTS.md"));

  const resolution = await resolveGuides({ cwd: root });

  assert.equal(resolution.selected.length, 0);
  assert.equal(resolution.candidates[0]?.status, "unreadable");
  assert.match(
    resolution.diagnostics[0]?.message ?? "",
    /symbolic instruction files are not read/,
  );
});

test("rejects a working directory that resolves outside the project root", async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentguide-cwd-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  const linkedCwd = path.join(root, "linked-cwd");
  await symlink(outside, linkedCwd);

  await assert.rejects(
    () => resolveGuides({ cwd: linkedCwd, root }),
    /resolves outside the project root/,
  );
});
