#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ConfigurationError, resolveGuides } from "./discovery.js";
import { formatOutput, summarize } from "./format.js";
import { checkProject } from "./lint.js";
                                               

                      
                               
              
                
                    
                       
 

                 
                                  
                                  
 

const VERSION = "0.1.0";

const HELP = `AgentGuide Lint ${VERSION}

Usage:
  agentguide-lint check [directory] [options]
  agentguide-lint explain [directory] [options]

Commands:
  check       Lint the effective AGENTS.md instruction chain
  explain     Show how instruction files resolve from project root to cwd

Options:
  --cwd <directory>        Working directory (alternative to positional path)
  --root <directory>       Project root (default: nearest .git ancestor)
  --format <format>        text, json, or sarif (default: text)
  --max-bytes <number>     Combined instruction limit (default: 32768)
  -h, --help               Show help
  -v, --version            Show version
`;

function optionValue(
  args          ,
  index        ,
  name        ,
)                                                  {
  const argument = args[index] ?? "";
  if (argument === name) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError(`${name} requires a value.`);
    }
    return { value, consumed: 2 };
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (!value) {
      throw new ConfigurationError(`${name} requires a value.`);
    }
    return { value, consumed: 1 };
  }
  return undefined;
}

export function parseArgs(args          )                                  {
  if (args.includes("--help") || args.includes("-h")) {
    return "help";
  }
  if (args.includes("--version") || args.includes("-v")) {
    return "version";
  }

  const command = args[0];
  if (command !== "check" && command !== "explain") {
    throw new ConfigurationError(
      command
        ? `Unknown command: ${command}`
        : "A command is required (check or explain).",
    );
  }

  let format               = "text";
  let root                    ;
  let cwdOption                    ;
  let maxBytes                    ;
  const positional           = [];

  for (let index = 1; index < args.length; ) {
    const formatOption = optionValue(args, index, "--format");
    if (formatOption) {
      if (!(["text", "json", "sarif"]            ).includes(formatOption.value)) {
        throw new ConfigurationError(
          `Unknown output format: ${formatOption.value}`,
        );
      }
      format = formatOption.value                ;
      index += formatOption.consumed;
      continue;
    }

    const rootOption = optionValue(args, index, "--root");
    if (rootOption) {
      root = rootOption.value;
      index += rootOption.consumed;
      continue;
    }

    const workingOption = optionValue(args, index, "--cwd");
    if (workingOption) {
      cwdOption = workingOption.value;
      index += workingOption.consumed;
      continue;
    }

    const byteOption = optionValue(args, index, "--max-bytes");
    if (byteOption) {
      maxBytes = Number(byteOption.value);
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new ConfigurationError(
          "--max-bytes must be a positive integer.",
        );
      }
      index += byteOption.consumed;
      continue;
    }

    const argument = args[index] ?? "";
    if (argument.startsWith("-")) {
      throw new ConfigurationError(`Unknown option: ${argument}`);
    }
    positional.push(argument);
    index += 1;
  }

  if (positional.length > 1) {
    throw new ConfigurationError("Only one working directory may be provided.");
  }
  if (cwdOption && positional[0]) {
    throw new ConfigurationError(
      "Use either a positional directory or --cwd, not both.",
    );
  }

  return {
    command,
    cwd: cwdOption ?? positional[0] ?? process.cwd(),
    root,
    maxBytes,
    format,
  };
}

const defaultIo        = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runCli(
  args          ,
  io        = defaultIo,
)                  {
  try {
    const options = parseArgs(args);
    if (options === "help") {
      io.stdout(HELP);
      return 0;
    }
    if (options === "version") {
      io.stdout(`${VERSION}\n`);
      return 0;
    }

    const common = {
      cwd: options.cwd,
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.maxBytes === undefined
        ? {}
        : { maxBytes: options.maxBytes }),
    };
    const result =
      options.command === "check"
        ? await checkProject(common)
        : {
            resolution: await resolveGuides(common),
            diagnostics: []                                                           ,
          };

    if (options.command === "explain") {
      result.diagnostics = result.resolution.diagnostics;
    }

    io.stdout(
      `${formatOutput(
        options.command,
        options.format,
        result.resolution,
        result.diagnostics,
      )}\n`,
    );
    return summarize(result.diagnostics).errors > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`agentguide-lint: ${message}\n`);
    return error instanceof ConfigurationError ? error.exitCode : 2;
  }
}

const entryPoint = process.argv[1]
  ? realpathSync(process.argv[1])
  : undefined;
const modulePath = realpathSync(fileURLToPath(import.meta.url));
if (entryPoint === modulePath) {
  process.exitCode = await runCli(process.argv.slice(2));
}
