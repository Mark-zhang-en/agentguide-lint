import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("GitHub Action passes inputs through environment variables", async () => {
  const action = await readFile(path.join(projectRoot, "action.yml"), "utf8");
  const runIndex = action.indexOf("      run: >-");

  assert.notEqual(runIndex, -1);
  assert.match(action, /AGENTGUIDE_INPUT_PATH: \$\{\{ inputs\.path \}\}/);
  assert.match(action, /AGENTGUIDE_INPUT_FORMAT: \$\{\{ inputs\.format \}\}/);
  assert.match(
    action,
    /AGENTGUIDE_INPUT_MAX_BYTES: \$\{\{ inputs\.max_bytes \}\}/,
  );
  assert.doesNotMatch(action.slice(runIndex), /\$\{\{ inputs\./);
  assert.match(action.slice(runIndex), /"\$AGENTGUIDE_INPUT_PATH"/);
});

test("GitHub Action runs the committed JavaScript distribution", async () => {
  const action = await readFile(path.join(projectRoot, "action.yml"), "utf8");
  const distribution = await readFile(
    path.join(projectRoot, "dist", "cli.js"),
    "utf8",
  );

  assert.match(action, /\$GITHUB_ACTION_PATH\/dist\/cli\.js/);
  assert.match(distribution, /^#!\/usr\/bin\/env node/);
});
