import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";

import { resolveGuides } from "./discovery.ts";
import type {
  Diagnostic,
  GuideFile,
  Resolution,
  ResolveOptions,
} from "./types.ts";

interface FenceAnalysis {
  fencedLines: Set<number>;
  unclosed?: {
    line: number;
    column: number;
    marker: string;
  };
}

interface LinkTarget {
  raw: string;
  line: number;
  column: number;
}

interface ScriptReference {
  manager: string;
  script: string;
  line: number;
  column: number;
}

interface PackageLookup {
  path?: string;
  scripts?: Record<string, unknown>;
  error?: string;
}

const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function linesOf(content: string): string[] {
  return content.split(/\r?\n/);
}

function analyseFences(content: string): FenceAnalysis {
  const lines = linesOf(content);
  const fencedLines = new Set<number>();
  let open:
    | { line: number; column: number; character: "`" | "~"; length: number }
    | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    if (open) {
      fencedLines.add(lineNumber);
      const candidate = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        candidate &&
        candidate[1]?.[0] === open.character &&
        candidate[1].length >= open.length
      ) {
        open = undefined;
      }
      continue;
    }

    const candidate = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!candidate?.[1]) {
      continue;
    }

    const character = candidate[1][0] as "`" | "~";
    if (character === "`" && (candidate[2] ?? "").includes("`")) {
      continue;
    }

    fencedLines.add(lineNumber);
    open = {
      line: lineNumber,
      column: line.indexOf(candidate[1]) + 1,
      character,
      length: candidate[1].length,
    };
  }

  return {
    fencedLines,
    unclosed: open
      ? {
          line: open.line,
          column: open.column,
          marker: open.character.repeat(open.length),
        }
      : undefined,
  };
}

function maskInlineCode(line: string): string {
  const characters = [...line];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }

    let length = 1;
    while (line[index + length] === "`") {
      length += 1;
    }
    const marker = "`".repeat(length);
    const close = line.indexOf(marker, index + length);
    if (close < 0) {
      index += length;
      continue;
    }

    for (let cursor = index; cursor < close + length; cursor += 1) {
      characters[cursor] = " ";
    }
    index = close + length;
  }
  return characters.join("");
}

function parseInlineDestination(line: string, start: number): string | undefined {
  let cursor = start;
  while (cursor < line.length && /\s/.test(line[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor >= line.length) {
    return undefined;
  }

  if (line[cursor] === "<") {
    const close = line.indexOf(">", cursor + 1);
    return close < 0 ? undefined : line.slice(cursor, close + 1);
  }

  const targetStart = cursor;
  let nestedParentheses = 0;
  while (cursor < line.length) {
    const character = line[cursor] ?? "";
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "(") {
      nestedParentheses += 1;
      cursor += 1;
      continue;
    }
    if (character === ")") {
      if (nestedParentheses === 0) {
        break;
      }
      nestedParentheses -= 1;
      cursor += 1;
      continue;
    }
    if (/\s/.test(character) && nestedParentheses === 0) {
      break;
    }
    cursor += 1;
  }

  return cursor === targetStart ? undefined : line.slice(targetStart, cursor);
}

function findLinkTargets(content: string, fencedLines: Set<number>): LinkTarget[] {
  const targets: LinkTarget[] = [];
  const lines = linesOf(content);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (fencedLines.has(lineNumber)) {
      continue;
    }

    const line = lines[index] ?? "";
    const searchable = maskInlineCode(line);
    const inline = /!?\[[^\]\n]*\]\(/g;
    let match;
    while ((match = inline.exec(searchable)) !== null) {
      const targetStart = match.index + match[0].length;
      const raw = parseInlineDestination(line, targetStart);
      if (raw) {
        const offset = line.indexOf(raw, targetStart);
        targets.push({ raw, line: lineNumber, column: offset + 1 });
      }
    }

    const definition = searchable.match(/^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/);
    if (definition?.[1]) {
      const raw = line.slice(
        definition.index! + definition[0].lastIndexOf(definition[1]),
        definition.index! + definition[0].lastIndexOf(definition[1]) +
          definition[1].length,
      );
      targets.push({
        raw,
        line: lineNumber,
        column: line.indexOf(raw) + 1,
      });
    }
  }

  return targets;
}

function relativePathFromTarget(rawTarget: string): string | undefined {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  target = target.replace(/\\([\\()[\]<> ])/g, "$1");

  if (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    path.isAbsolute(target) ||
    /^[A-Za-z]:[\\/]/.test(target) ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)
  ) {
    return undefined;
  }

  target = target.replace(/[?#].*$/, "");
  if (target === "") {
    return undefined;
  }

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

async function checkRelativeLinks(
  guide: GuideFile,
  fencedLines: Set<number>,
  root: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const targets = findLinkTargets(guide.content, fencedLines);
  const canonicalRoot = await realpath(root);

  for (const target of targets) {
    const relative = relativePathFromTarget(target.raw);
    if (!relative) {
      continue;
    }

    const resolved = path.resolve(guide.directory, relative);
    const lexicalRelative = path.relative(root, resolved);
    if (
      lexicalRelative === ".." ||
      lexicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexicalRelative)
    ) {
      diagnostics.push({
        ruleId: "relative-path-outside-root",
        severity: "error",
        message: `Relative Markdown target escapes the project root: ${target.raw}`,
        file: guide.path,
        line: target.line,
        column: target.column,
        target: resolved,
      });
      continue;
    }

    try {
      const canonicalTarget = await realpath(resolved);
      const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
      if (
        canonicalRelative === ".." ||
        canonicalRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(canonicalRelative)
      ) {
        diagnostics.push({
          ruleId: "relative-path-outside-root",
          severity: "error",
          message: `Relative Markdown target resolves outside the project root: ${target.raw}`,
          file: guide.path,
          line: target.line,
          column: target.column,
          target: canonicalTarget,
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      diagnostics.push({
        ruleId:
          code === "ENOENT" || code === "ENOTDIR"
            ? "missing-relative-path"
            : "path-check-error",
        severity: "error",
        message:
          code === "ENOENT" || code === "ENOTDIR"
            ? `Relative Markdown target does not exist: ${target.raw}`
            : `Cannot inspect relative Markdown target ${target.raw}: ${(error as Error).message}`,
        file: guide.path,
        line: target.line,
        column: target.column,
        target: resolved,
      });
    }
  }

  return diagnostics;
}

const DIRECT_SCRIPT_BUILTINS: Record<string, Set<string>> = {
  pnpm: new Set([
    "add",
    "audit",
    "config",
    "create",
    "deploy",
    "dlx",
    "exec",
    "fetch",
    "import",
    "init",
    "install",
    "link",
    "list",
    "outdated",
    "pack",
    "patch",
    "publish",
    "rebuild",
    "remove",
    "root",
    "run",
    "server",
    "setup",
    "store",
    "uninstall",
    "update",
    "version",
    "why",
  ]),
  yarn: new Set([
    "add",
    "bin",
    "cache",
    "config",
    "create",
    "dlx",
    "exec",
    "info",
    "init",
    "install",
    "link",
    "npm",
    "pack",
    "plugin",
    "remove",
    "run",
    "set",
    "stage",
    "unlink",
    "up",
    "version",
    "why",
    "workspace",
    "workspaces",
  ]),
};

function offsetToPosition(content: string, offset: number): [number, number] {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return [lines.length, (lines.at(-1)?.length ?? 0) + 1];
}

function findScriptReferences(content: string): ScriptReference[] {
  const references: ScriptReference[] = [];
  const seen = new Set<string>();

  const add = (manager: string, script: string, offset: number): void => {
    const key = `${offset}:${manager}:${script}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const [line, column] = offsetToPosition(content, offset);
    references.push({ manager, script, line, column });
  };

  const explicit = /\b(npm|pnpm|yarn|bun)\s+run(?:-script)?\s+([A-Za-z\d_.:@/-]+)/g;
  let match;
  while ((match = explicit.exec(content)) !== null) {
    if (match[1] && match[2]) {
      add(match[1], match[2], match.index);
    }
  }

  const npmShortcut = /\bnpm\s+(test|start|stop|restart)\b/g;
  while ((match = npmShortcut.exec(content)) !== null) {
    if (match[1]) {
      add("npm", match[1], match.index);
    }
  }

  const direct = /\b(pnpm|yarn)\s+([A-Za-z\d_.:@/-]+)\b/g;
  while ((match = direct.exec(content)) !== null) {
    const manager = match[1];
    const script = match[2];
    if (
      manager &&
      script &&
      !DIRECT_SCRIPT_BUILTINS[manager]?.has(script) &&
      !content.slice(match.index, explicit.lastIndex).includes(" run ")
    ) {
      add(manager, script, match.index);
    }
  }

  return references.sort((left, right) =>
    left.line === right.line
      ? left.column - right.column
      : left.line - right.line,
  );
}

async function findPackageJson(
  start: string,
  root: string,
): Promise<PackageLookup> {
  const canonicalRoot = await realpath(root);
  let directory = start;
  while (true) {
    const packagePath = path.join(directory, "package.json");
    try {
      const details = await lstat(packagePath);
      if (details.isSymbolicLink()) {
        return {
          path: packagePath,
          error: "Symbolic package.json files are not read.",
        };
      }
      if (!details.isFile()) {
        return {
          path: packagePath,
          error: "package.json is not a regular file.",
        };
      }
      if (details.size > MAX_PACKAGE_JSON_BYTES) {
        return {
          path: packagePath,
          error: `package.json exceeds the ${MAX_PACKAGE_JSON_BYTES}-byte safety limit.`,
        };
      }
      const canonicalPackage = await realpath(packagePath);
      if (!isInside(canonicalRoot, canonicalPackage)) {
        return {
          path: packagePath,
          error: "package.json resolves outside the project root.",
        };
      }
      const content = await readFile(packagePath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
      } catch {
        return {
          path: packagePath,
          error: "Invalid package.json.",
        };
      }

      const scripts =
        parsed &&
        typeof parsed === "object" &&
        "scripts" in parsed &&
        (parsed as { scripts?: unknown }).scripts &&
        typeof (parsed as { scripts?: unknown }).scripts === "object"
          ? ((parsed as { scripts: Record<string, unknown> }).scripts ?? {})
          : {};
      return { path: packagePath, scripts };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          path: packagePath,
          error: `Cannot read package.json: ${(error as Error).message}`,
        };
      }
    }

    if (directory === root) {
      return {};
    }
    const parent = path.dirname(directory);
    if (parent === directory || !parent.startsWith(root)) {
      return {};
    }
    directory = parent;
  }
}

async function checkScriptReferences(
  guide: GuideFile,
  root: string,
): Promise<Diagnostic[]> {
  const references = findScriptReferences(guide.content);
  if (references.length === 0) {
    return [];
  }

  const packageLookup = await findPackageJson(guide.directory, root);
  if (packageLookup.error) {
    return [
      {
        ruleId: "package-json-error",
        severity: "error",
        message: packageLookup.error,
        file: packageLookup.path ?? guide.path,
        line: 1,
        column: 1,
      },
    ];
  }

  return references.flatMap((reference): Diagnostic[] => {
    const withoutSentencePunctuation = reference.script.replace(/[.,;!?]+$/, "");
    const displayScript = withoutSentencePunctuation || reference.script;

    if (!packageLookup.path) {
      return [
        {
          ruleId: "package-json-missing",
          severity: "error",
          message: `Cannot validate ${reference.manager} script \"${displayScript}\" because no package.json exists at or above this guide.`,
          file: guide.path,
          line: reference.line,
          column: reference.column,
        },
      ];
    }

    const scripts = packageLookup.scripts ?? {};
    const exactExists = Object.hasOwn(scripts, reference.script);
    const punctuationTrimmedExists =
      displayScript !== reference.script && Object.hasOwn(scripts, displayScript);
    if (!exactExists && !punctuationTrimmedExists) {
      return [
        {
          ruleId: "missing-package-script",
          severity: "error",
          message: `${reference.manager} references missing package.json script \"${displayScript}\".`,
          file: guide.path,
          line: reference.line,
          column: reference.column,
          target: packageLookup.path,
        },
      ];
    }
    return [];
  });
}

function checkFence(guide: GuideFile, analysis: FenceAnalysis): Diagnostic[] {
  if (!analysis.unclosed) {
    return [];
  }
  return [
    {
      ruleId: "unclosed-code-fence",
      severity: "error",
      message: `Code fence ${analysis.unclosed.marker} is not closed.`,
      file: guide.path,
      line: analysis.unclosed.line,
      column: analysis.unclosed.column,
    },
  ];
}

export async function lintResolution(
  resolution: Resolution,
): Promise<Diagnostic[]> {
  const diagnostics = [...resolution.diagnostics];

  for (const guide of resolution.selected) {
    const analysis = analyseFences(guide.content);
    diagnostics.push(...checkFence(guide, analysis));
    diagnostics.push(
      ...(await checkRelativeLinks(
        guide,
        analysis.fencedLines,
        resolution.root,
      )),
    );
    diagnostics.push(...(await checkScriptReferences(guide, resolution.root)));
  }

  return diagnostics;
}

export async function checkProject(
  options: ResolveOptions,
): Promise<{ resolution: Resolution; diagnostics: Diagnostic[] }> {
  const resolution = await resolveGuides(options);
  const diagnostics = await lintResolution(resolution);
  return { resolution, diagnostics };
}
