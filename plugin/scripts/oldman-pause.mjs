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

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var PAUSED_FILE = "paused";
function ensureStateDir(projectDir, ...segments) {
  let dir = projectDir;
  for (const segment of [".theoldman", "state", ...segments]) {
    dir = join(dir, segment);
    if (!existsSync(dir)) {
      mkdirSync(dir);
      if (segment === ".theoldman") writeFileSync(join(dir, ".gitignore"), "*\n");
    }
    if (lstatSync(dir).isSymbolicLink()) {
      throw new Error(`${segment} is a symbolic link; refusing to write state through it`);
    }
  }
  return dir;
}
function setPaused(projectDir, paused) {
  const file = join(ensureStateDir(projectDir), PAUSED_FILE);
  if (paused) {
    writeFileSync(file, "");
  } else {
    rmSync(file, { force: true });
  }
}

// src/entries/oldman-pause.ts
runHook(() => {
  const [mode, projectDir = process.cwd()] = process.argv.slice(2);
  if (mode !== "on" && mode !== "off")
    return failOpen("usage: oldman-pause.mjs on|off [project dir]");
  setPaused(projectDir, mode === "off");
  return say(
    mode === "off" ? "theoldman is paused for this project: the rules summary, prompt rules, edit checks and review are off. The guards stay on. Run /theoldman:on to resume." : "theoldman is on again for this project: the rules summary, prompt rules, edit checks and review are back."
  );
});
