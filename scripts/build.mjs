import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDirectory = path.join(projectRoot, "src");
const outputDirectory = path.join(projectRoot, "dist");
const sourceFiles = ["cli.ts", "discovery.ts", "format.ts", "lint.ts", "types.ts"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const filename of sourceFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const outputName = filename.replace(/\.ts$/, ".js");
  const outputPath = path.join(outputDirectory, outputName);
  const source = await readFile(sourcePath, "utf8");
  const shebang = source.startsWith("#!")
    ? `${source.slice(0, source.indexOf("\n"))}\n`
    : "";
  const body = shebang ? source.slice(source.indexOf("\n") + 1) : source;
  const javascript = stripTypeScriptTypes(body, { mode: "strip" })
    .replaceAll('.ts"', '.js"')
    .replaceAll(".ts'", ".js'");
  await writeFile(outputPath, `${shebang}${javascript}`, "utf8");
}

await chmod(path.join(outputDirectory, "cli.js"), 0o755);
