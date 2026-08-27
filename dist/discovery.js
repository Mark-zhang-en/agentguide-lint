import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

             
             
                 
            
            
             
                 
                    

export const DEFAULT_MAX_BYTES = 32 * 1024;

const GUIDE_NAMES                                     = [
  ["AGENTS.override.md", "override"],
  ["AGENTS.md", "standard"],
];

                         
               
                    
                  
                  
                
                 
 

                            
                   
                
                 
 

export class ConfigurationError extends Error {
  exitCode = 2;

  constructor(message        ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

async function pathExists(target        )                   {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error                         ).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertDirectory(target        , label        )                {
  let details;
  try {
    details = await stat(target);
  } catch (error) {
    if ((error                         ).code === "ENOENT") {
      throw new ConfigurationError(`${label} does not exist: ${target}`);
    }
    throw error;
  }

  if (!details.isDirectory()) {
    throw new ConfigurationError(`${label} is not a directory: ${target}`);
  }
}

export async function findProjectRoot(cwd        )                  {
  const start = path.resolve(cwd);
  await assertDirectory(start, "Working directory");

  let directory = start;
  while (true) {
    if (await pathExists(path.join(directory, ".git"))) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return start;
    }
    directory = parent;
  }
}

export function projectDirectories(root        , cwd        )           {
  const relative = path.relative(root, cwd);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ConfigurationError(
      `Working directory must be inside the project root: ${cwd}`,
    );
  }

  if (relative === "") {
    return [root];
  }

  const directories = [root];
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

async function readCandidate(
  directory        ,
  name        ,
  kind           ,
)                         {
  const candidatePath = path.join(directory, name);
  let details;
  try {
    details = await lstat(candidatePath);
  } catch (error) {
    if ((error                         ).code === "ENOENT") {
      return {
        path: candidatePath,
        directory,
        kind,
        exists: false,
        bytes: 0,
      };
    }
    return {
      path: candidatePath,
      directory,
      kind,
      exists: true,
      bytes: 0,
      error: (error         ).message,
    };
  }

  if (details.isSymbolicLink()) {
    return {
      path: candidatePath,
      directory,
      kind,
      exists: true,
      bytes: details.size,
      error: "symbolic instruction files are not read",
    };
  }

  if (!details.isFile()) {
    return {
      path: candidatePath,
      directory,
      kind,
      exists: true,
      bytes: details.size,
      error: "path is not a regular file",
    };
  }

  return {
    path: candidatePath,
    directory,
    kind,
    exists: true,
    bytes: details.size,
  };
}

async function readCandidateContent(
  candidate               ,
  limit        ,
)                            {
  const bytesToRead = Math.min(candidate.bytes, limit);
  let handle;
  try {
    handle = await open(candidate.path, "r");
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, result.bytesRead).toString("utf8"),
      bytes: result.bytesRead,
    };
  } catch (error) {
    return { bytes: 0, error: (error         ).message };
  } finally {
    await handle?.close();
  }
}

function isEmpty(content        )          {
  return content.replace(/^\uFEFF/, "").trim().length === 0;
}

function isInside(root        , target        )          {
  const relative = path.relative(root, target);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function unreadableDiagnostic(candidate               )             {
  return {
    ruleId: "guide-read-error",
    severity: "error",
    message: `Cannot read instruction file: ${candidate.error ?? "unknown error"}`,
    file: candidate.path,
    line: 1,
    column: 1,
  };
}

function emptyDiagnostic(candidate               )             {
  return {
    ruleId: "empty-guide",
    severity: "warning",
    message: "Instruction file is empty and will be ignored.",
    file: candidate.path,
    line: 1,
    column: 1,
  };
}

function truncatedDiagnostic(
  candidate               ,
  loadedBytes        ,
)             {
  return {
    ruleId: "guide-truncated",
    severity: "warning",
    message: `Instruction file was truncated from ${candidate.bytes} to ${loadedBytes} bytes by the combined instruction limit.`,
    file: candidate.path,
    line: 1,
    column: 1,
  };
}

function overLimitDiagnostic(candidate               )             {
  return {
    ruleId: "guide-over-limit",
    severity: "warning",
    message: "Instruction file is not loaded because the combined instruction limit is already exhausted.",
    file: candidate.path,
    line: 1,
    column: 1,
  };
}

export async function resolveGuides(options                )                      {
  const cwd = path.resolve(options.cwd);
  const root = path.resolve(options.root ?? (await findProjectRoot(cwd)));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ConfigurationError("Maximum byte count must be a positive integer.");
  }

  await Promise.all([
    assertDirectory(root, "Project root"),
    assertDirectory(cwd, "Working directory"),
  ]);
  const [canonicalRoot, canonicalCwd] = await Promise.all([
    realpath(root),
    realpath(cwd),
  ]);
  if (!isInside(canonicalRoot, canonicalCwd)) {
    throw new ConfigurationError(
      `Working directory resolves outside the project root: ${cwd}`,
    );
  }

  const directories = projectDirectories(root, cwd);
  const candidates                   = [];
  const selected              = [];
  const diagnostics               = [];
  let remaining = maxBytes;

  for (const directory of directories) {
    const reads = await Promise.all(
      GUIDE_NAMES.map(([name, kind]) => readCandidate(directory, name, kind)),
    );
    const present = reads.filter((candidate) => candidate.exists);

    const usable = present.filter((candidate) => candidate.error === undefined);
    const chosen = usable[0];
    const statuses = new Map                        ();

    const setStatus = (
      candidate               ,
      status                          ,
    )       => {
      statuses.set(candidate.path, {
        path: candidate.path,
        directory,
        kind: candidate.kind,
        status,
        bytes: candidate.bytes,
      });
    };

    for (const candidate of present.filter((item) => item.error)) {
      setStatus(candidate, "unreadable");
      diagnostics.push(unreadableDiagnostic(candidate));
    }

    for (const candidate of usable.filter((item) => item !== chosen)) {
      setStatus(candidate, "shadowed");
    }

    if (chosen && remaining === 0) {
      setStatus(chosen, "over-limit");
      diagnostics.push(overLimitDiagnostic(chosen));
    } else if (chosen) {
      const loaded = await readCandidateContent(chosen, remaining);
      if (loaded.error) {
        setStatus(chosen, "unreadable");
        diagnostics.push(
          unreadableDiagnostic({ ...chosen, error: loaded.error }),
        );
      } else if (isEmpty(loaded.content ?? "")) {
        setStatus(chosen, "empty");
        diagnostics.push(emptyDiagnostic(chosen));
      } else {
        setStatus(chosen, "selected");
        selected.push({
          path: chosen.path,
          directory,
          kind: chosen.kind,
          content: loaded.content ?? "",
          bytes: loaded.bytes,
        });
        if (chosen.bytes > loaded.bytes) {
          diagnostics.push(truncatedDiagnostic(chosen, loaded.bytes));
        }
        remaining -= loaded.bytes;
      }
    }

    candidates.push(
      ...present.flatMap((candidate) => {
        const status = statuses.get(candidate.path);
        return status ? [status] : [];
      }),
    );
  }

  const totalBytes = selected.reduce((sum, guide) => sum + guide.bytes, 0);

  return {
    root,
    cwd,
    directories,
    candidates,
    selected,
    totalBytes,
    maxBytes,
    diagnostics,
  };
}
