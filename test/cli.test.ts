import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseArgs, runCli } from "../src/cli.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentguide-cli-"));
  await mkdir(path.join(root, ".git"));
  return root;
}

function capture(): {
  io: { stdout: (value: string) => void; stderr: (value: string) => void };
  output: () => string;
  error: () => string;
} {
  let output = "";
  let error = "";
  return {
    io: {
      stdout: (value) => {
        output += value;
      },
      stderr: (value) => {
        error += value;
      },
    },
    output: () => output,
    error: () => error,
  };
}

test("check emits stable JSON and succeeds for a valid project", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "AGENTS.md"), "Run `npm test`.\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  const sink = capture();

  const exitCode = await runCli(
    ["check", root, "--format", "json"],
    sink.io,
  );
  const report = JSON.parse(sink.output());

  assert.equal(exitCode, 0);
  assert.equal(sink.error(), "");
  assert.equal(report.command, "check");
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, notes: 0 });
  assert.deepEqual(report.limit, {
    usedBytes: Buffer.byteLength("Run `npm test`.\n"),
    maxBytes: 32768,
    truncated: false,
    exhausted: false,
  });
  assert.deepEqual(report.effectiveFiles.map((file: { path: string }) => file.path), [
    "AGENTS.md",
  ]);
});

test("check emits SARIF and fails when a path is missing", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "AGENTS.md"), "See [guide](docs/guide.md).\n");
  const sink = capture();

  const exitCode = await runCli(
    ["check", "--cwd", root, "--format=sarif"],
    sink.io,
  );
  const report = JSON.parse(sink.output());

  assert.equal(exitCode, 1);
  assert.equal(report.version, "2.1.0");
  assert.equal(report.runs[0].results[0].ruleId, "missing-relative-path");
  assert.equal(
    report.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
    "AGENTS.md",
  );
});

test("explain describes shadowing but only runs resolution checks", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "AGENTS.override.md"), "Override.\n");
  await writeFile(path.join(root, "AGENTS.md"), "[broken](missing.md)\n");
  const sink = capture();

  const exitCode = await runCli(["explain", root], sink.io);

  assert.equal(exitCode, 0);
  assert.match(sink.output(), /AGENTS\.override\.md — effective/);
  assert.match(sink.output(), /AGENTS\.md — ignored: AGENTS\.override\.md/);
  assert.doesNotMatch(sink.output(), /missing-relative-path/);
});

test("rejects conflicting cwd arguments and invalid byte limits", () => {
  assert.throws(
    () => parseArgs(["check", ".", "--cwd", "src"]),
    /either a positional directory or --cwd/,
  );
  assert.throws(
    () => parseArgs(["check", "--max-bytes", "0"]),
    /positive integer/,
  );
});

test("runs when invoked through a symbolic package-bin style path", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentguide-bin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const linkedCli = path.join(directory, "agentguide");
  await symlink(path.join(projectRoot, "src", "cli.ts"), linkedCli);

  const result = spawnSync(process.execPath, [linkedCli, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "0.1.0\n");
});
