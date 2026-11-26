// src/entries/oldman-init.ts
import { appendFileSync, lstatSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/input.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return void 0;
  }
}

// src/lib/config.ts
var CONFIG_FILE = ".theoldman.json";

// src/lib/output.ts
function say(text) {
  return { exitCode: 0, stdout: `${text}
`, stderr: "" };
}
function failOpen(message) {
  return { exitCode: 1, stdout: "", stderr: `theoldman: ${message}
` };
}
function writeOutput(output, io) {
  if (output.stdout !== "") io.stdout.write(output.stdout);
  if (output.stderr !== "") io.stderr.write(output.stderr);
  io.exitCode = output.exitCode;
}
function runHook(handler, io = process) {
  let output;
  try {
    output = handler();
  } catch (error) {
    output = failOpen(`internal error: ${error instanceof Error ? error.message : String(error)}`);
  }
  writeOutput(output, io);
}

// src/lib/stack.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var MARKERS = [
  ["typescript", ["typescript"]],
  ["nextjs", ["next"]],
  ["react", ["react"]],
  ["prisma", ["prisma", "@prisma/client"]],
  ["express", ["express"]],
  ["vitest", ["vitest"]],
  ["jest", ["jest"]]
];
var DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
function detectStack(projectDir) {
  let raw;
  try {
    raw = readFileSync(join(projectDir, "package.json"), "utf8");
  } catch {
    return [];
  }
  const manifest = parseJson(raw);
  if (!isRecord(manifest)) return [];
  const names = new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = manifest[field];
      return isRecord(dependencies) ? Object.keys(dependencies) : [];
    })
  );
  return MARKERS.filter(([, packages]) => packages.some((name) => names.has(name))).map(
    ([id]) => id
  );
}

// src/entries/oldman-init.ts
var HEADING = "## theoldman";
var SECTION = [
  HEADING,
  "",
  "This project uses the theoldman plugin. Its rules are in the plugin skills, and `.theoldman.json` holds the settings.",
  "",
  "- Guards block force-pushes to main, `--no-verify`, deletes outside the project, destructive commands on non-local databases, writes to `.env` and key files, and secrets.",
  "- Edits are checked for comment and code-quality problems, and changed code is reviewed by the reviewer and verifier subagents before Claude finishes.",
  "- `/theoldman:off` pauses the checks and the review (the guards stay on); `/theoldman:on` turns them back on.",
  ""
].join("\n");
function kind(path) {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return "link";
    return stats.isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
}
function writeConfig(projectDir) {
  const path = join2(projectDir, CONFIG_FILE);
  if (kind(path) !== "missing") return `Kept the existing ${CONFIG_FILE}.`;
  const stack = detectStack(projectDir);
  writeFileSync(path, `${JSON.stringify({ level: "standard", stack }, null, 2)}
`, { flag: "wx" });
  return stack.length > 0 ? `Wrote ${CONFIG_FILE} with the stack detected from package.json: ${stack.join(", ")}.` : `Wrote ${CONFIG_FILE}; no stack was detected from package.json, so "stack" is empty.`;
}
function addSection(projectDir) {
  const path = join2(projectDir, "CLAUDE.md");
  const found = kind(path);
  if (found === "link" || found === "other")
    return "Left CLAUDE.md alone: it is not a regular file.";
  const text = found === "file" ? readFileSync2(path, "utf8") : "";
  if (text.split(/\r?\n/).includes(HEADING)) return "CLAUDE.md already has a theoldman section.";
  const gap = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(path, gap + SECTION);
  return found === "file" ? "Added a theoldman section to CLAUDE.md." : "Created CLAUDE.md with a theoldman section.";
}
runHook(() => {
  const [projectDir = process.cwd()] = process.argv.slice(2);
  return say([writeConfig(projectDir), addSection(projectDir)].join("\n"));
});
