import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  Diagnostic,
  GuideCandidate,
  OutputFormat,
  Resolution,
  Summary,
} from "./types.ts";

export type CommandName = "check" | "explain";

const RULE_HELP: Record<string, string> = {
  "empty-guide": "Remove the empty file or add meaningful project instructions.",
  "guide-read-error": "Make the instruction file readable and ensure it is a regular file.",
  "guide-over-limit":
    "Reduce or split broader instruction files so nested guidance is loaded.",
  "guide-truncated":
    "Reduce or split instruction files so important guidance is not truncated.",
  "missing-package-script": "Add the referenced script or correct the command in the guide.",
  "missing-relative-path": "Create the target or correct the relative Markdown path.",
  "package-json-error": "Repair package.json so it can be parsed and inspected.",
  "package-json-missing": "Add package.json or remove the package-script command.",
  "path-check-error": "Check permissions and the target path.",
  "relative-path-outside-root":
    "Keep instruction links inside the selected project root.",
  "unclosed-code-fence": "Close the Markdown code fence with the same marker character.",
};

export function summarize(diagnostics: Diagnostic[]): Summary {
  return diagnostics.reduce<Summary>(
    (summary, diagnostic) => {
      if (diagnostic.severity === "error") {
        summary.errors += 1;
      } else if (diagnostic.severity === "warning") {
        summary.warnings += 1;
      } else {
        summary.notes += 1;
      }
      return summary;
    },
    { errors: 0, warnings: 0, notes: 0 },
  );
}

function displayPath(file: string, root: string): string {
  const relative = path.relative(root, file);
  if (relative === "") {
    return ".";
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return file;
  }
  return relative;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    left.file.localeCompare(right.file) ||
    (left.line ?? 1) - (right.line ?? 1) ||
    (left.column ?? 1) - (right.column ?? 1) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

function diagnosticText(diagnostic: Diagnostic, root: string): string {
  const location = [
    displayPath(diagnostic.file, root),
    diagnostic.line,
    diagnostic.column,
  ]
    .filter((part) => part !== undefined)
    .join(":");
  return `${location} ${diagnostic.severity} [${diagnostic.ruleId}] ${diagnostic.message}`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatCheckText(
  resolution: Resolution,
  diagnostics: Diagnostic[],
): string {
  const summary = summarize(diagnostics);
  const output = [...diagnostics]
    .sort(compareDiagnostics)
    .map((diagnostic) => diagnosticText(diagnostic, resolution.root));

  if (output.length > 0) {
    output.push("");
  }

  const result = summary.errors > 0 ? "FAIL" : "PASS";
  output.push(
    `${result} ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}, ${plural(summary.notes, "note")}; ` +
      `${plural(resolution.selected.length, "effective file")}, ${resolution.totalBytes}/${resolution.maxBytes} bytes.`,
  );
  return output.join("\n");
}

function candidateReason(candidate: GuideCandidate): string {
  switch (candidate.status) {
    case "selected":
      return "effective";
    case "shadowed":
      return "ignored: AGENTS.override.md takes precedence";
    case "empty":
      return "ignored: empty";
    case "over-limit":
      return "ignored: combined byte limit exhausted";
    case "unreadable":
      return "ignored: unreadable";
  }
}

function formatExplainText(
  resolution: Resolution,
  diagnostics: Diagnostic[],
): string {
  const output = [
    "AgentGuide instruction resolution",
    `Project root: ${resolution.root}`,
    `Working directory: ${resolution.cwd}`,
    `Combined size: ${resolution.totalBytes}/${resolution.maxBytes} bytes`,
    "",
    "Directory decisions (root to working directory):",
  ];

  for (const directory of resolution.directories) {
    output.push(`- ${displayPath(directory, resolution.root)}`);
    const candidates = resolution.candidates.filter(
      (candidate) => candidate.directory === directory,
    );
    if (candidates.length === 0) {
      output.push("  (no instruction file)");
    } else {
      for (const candidate of candidates) {
        output.push(
          `  ${path.basename(candidate.path)} — ${candidateReason(candidate)} (${candidate.bytes} bytes)`,
        );
      }
    }
  }

  output.push("", "Effective order:");
  if (resolution.selected.length === 0) {
    output.push("  (none)");
  } else {
    resolution.selected.forEach((guide, index) => {
      output.push(
        `  ${index + 1}. ${displayPath(guide.path, resolution.root)} (${guide.bytes} bytes)`,
      );
    });
  }

  if (diagnostics.length > 0) {
    output.push("", "Resolution findings:");
    output.push(
      ...[...diagnostics]
        .sort(compareDiagnostics)
        .map((diagnostic) => `  ${diagnosticText(diagnostic, resolution.root)}`),
    );
  }

  return output.join("\n");
}

function jsonDiagnostic(diagnostic: Diagnostic, root: string): object {
  return {
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: displayPath(diagnostic.file, root),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
    ...(diagnostic.target === undefined
      ? {}
      : { target: displayPath(diagnostic.target, root) }),
  };
}

function outputModel(
  command: CommandName,
  resolution: Resolution,
  diagnostics: Diagnostic[],
): object {
  const truncated = diagnostics.some(
    (diagnostic) => diagnostic.ruleId === "guide-truncated",
  );
  const exhausted = resolution.candidates.some(
    (candidate) => candidate.status === "over-limit",
  );
  return {
    version: 1,
    command,
    root: resolution.root,
    cwd: resolution.cwd,
    limit: {
      usedBytes: resolution.totalBytes,
      maxBytes: resolution.maxBytes,
      truncated,
      exhausted,
    },
    effectiveFiles: resolution.selected.map((guide) => ({
      path: displayPath(guide.path, resolution.root),
      kind: guide.kind,
      bytes: guide.bytes,
    })),
    candidates: resolution.candidates.map((candidate) => ({
      path: displayPath(candidate.path, resolution.root),
      kind: candidate.kind,
      status: candidate.status,
      bytes: candidate.bytes,
    })),
    diagnostics: diagnostics.map((diagnostic) =>
      jsonDiagnostic(diagnostic, resolution.root),
    ),
    summary: summarize(diagnostics),
  };
}

function sarifPath(file: string, root: string): string {
  const displayed = displayPath(file, root);
  return displayed.split(path.sep).join("/");
}

function formatSarif(
  command: CommandName,
  resolution: Resolution,
  diagnostics: Diagnostic[],
): string {
  const ruleIds = [...new Set(diagnostics.map((diagnostic) => diagnostic.ruleId))];
  const summary = summarize(diagnostics);
  const sarif = {
    $schema:
      "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "AgentGuide Lint",
            informationUri: "https://github.com/Mark-zhang-en/agentguide-lint",
            semanticVersion: "0.1.0",
            rules: ruleIds.map((ruleId) => ({
              id: ruleId,
              shortDescription: { text: ruleId.replaceAll("-", " ") },
              ...(RULE_HELP[ruleId]
                ? { help: { text: RULE_HELP[ruleId] } }
                : {}),
            })),
          },
        },
        invocations: [
          {
            commandLine: `agentguide-lint ${command}`,
            executionSuccessful: summary.errors === 0,
            workingDirectory: { uri: pathToFileURL(resolution.cwd).href },
          },
        ],
        results: diagnostics.map((diagnostic) => ({
          ruleId: diagnostic.ruleId,
          level:
            diagnostic.severity === "error"
              ? "error"
              : diagnostic.severity === "warning"
                ? "warning"
                : "note",
          message: { text: diagnostic.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: sarifPath(diagnostic.file, resolution.root),
                  uriBaseId: "%SRCROOT%",
                },
                region: {
                  startLine: diagnostic.line ?? 1,
                  startColumn: diagnostic.column ?? 1,
                },
              },
            },
          ],
          ...(diagnostic.target
            ? { properties: { target: diagnostic.target } }
            : {}),
        })),
        originalUriBaseIds: {
          "%SRCROOT%": {
            uri: pathToFileURL(`${resolution.root}${path.sep}`).href,
          },
        },
        properties: {
          command,
          effectiveFiles: resolution.selected.map((guide) =>
            sarifPath(guide.path, resolution.root),
          ),
          usedBytes: resolution.totalBytes,
          maxBytes: resolution.maxBytes,
        },
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function formatOutput(
  command: CommandName,
  format: OutputFormat,
  resolution: Resolution,
  diagnostics: Diagnostic[],
): string {
  if (format === "json") {
    return JSON.stringify(outputModel(command, resolution, diagnostics), null, 2);
  }
  if (format === "sarif") {
    return formatSarif(command, resolution, diagnostics);
  }
  return command === "check"
    ? formatCheckText(resolution, diagnostics)
    : formatExplainText(resolution, diagnostics);
}
