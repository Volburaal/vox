#!/usr/bin/env node
/**
 * Generates the TypeScript parser from ../Vox.g4 with ANTLR.
 *
 * ANTLR is a Java program, so this needs a JDK/JRE on the PATH. When Java is
 * missing we do not fail blindly:
 *   - if a previously generated parser exists in src/gen, it is reused;
 *   - otherwise we stop with an explanation of the two ways to fix it.
 * The generated parser is deliberately not committed; see the README.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(here, "..");
const repoDir = resolve(coreDir, "..");
const grammar = resolve(repoDir, "Vox.g4");
const antlrJar = resolve(repoDir, "tools", "antlr-4.13.2-complete.jar");
const outDir = resolve(coreDir, "src", "gen");
const parserFile = resolve(outDir, "VoxParser.ts");

const javaAvailable =
  spawnSync("java", ["-version"], { stdio: "ignore", shell: true }).status ===
  0;

if (!javaAvailable) {
  if (existsSync(parserFile)) {
    console.warn(
      "generate: Java not found; reusing the existing parser in core/src/gen",
    );
    process.exit(0);
  }
  console.error(`
generate: Java is required to build the Vox parser and none was found.

  ANTLR (tools/antlr-4.13.2-complete.jar) turns Vox.g4 into TypeScript and
  ANTLR is a Java program. Either:

  1. Install a JDK/JRE (https://adoptium.net) and make sure "java" is on PATH.
     On Vercel this is done by the installCommand in web/vercel.json.

  2. Generate the parser on a machine with Java and commit core/src/gen
     (remove it from .gitignore). Then this step is skipped everywhere.
`);
  process.exit(1);
}

const result = spawnSync(
  "java",
  [
    "-cp",
    antlrJar,
    "org.antlr.v4.Tool",
    "-Dlanguage=TypeScript",
    "-visitor",
    "-no-listener",
    "-Xexact-output-dir",
    "-o",
    outDir,
    grammar,
  ],
  { stdio: "inherit", shell: true },
);

if (result.status !== 0) {
  console.error("generate: ANTLR failed (see output above)");
  process.exit(result.status ?? 1);
}
console.log("generate: parser written to core/src/gen");
