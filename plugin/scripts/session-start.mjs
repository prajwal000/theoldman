// src/entries/session-start.ts
import { fileURLToPath } from "node:url";

// src/lib/config.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join } from "node:path";

// src/lib/input.ts
import { readFileSync } from "node:fs";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCommonInput(value) {
  return isRecord(value) && typeof value.session_id === "string" && typeof value.cwd === "string" && typeof value.hook_event_name === "string" && (value.agent_type === void 0 || typeof value.agent_type === "string");
}
function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return void 0;
  }
}
function readHookInput(isValid, fd = 0) {
  const value = parseJson(readFileSync(fd, "utf8"));
  return isValid(value) ? value : void 0;
}

// src/lib/config.ts
var CONFIG_FILE = ".theoldman.json";
var DEFAULT_CONFIG = {
  level: "standard",
  stack: [],
  disable: [],
  ignorePaths: ["**/generated/**", "**/*.lock", "**/vendor/**"],
  review: { maxNits: 5, onStop: true, docsWriterModel: "sonnet" },
  maxFeedbackRounds: 2
};
var LEVELS = ["quick", "standard", "strict"];
function isLevel(value) {
  return LEVELS.includes(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isCount(value) {
  return Number.isInteger(value) && Number(value) >= 0;
}
function unknownKey(value, known) {
  return Object.keys(value).find((key) => !Object.hasOwn(known, key));
}
function parseReview(value) {
  if (!isRecord(value)) return '"review" must be an object';
  const extra = unknownKey(value, DEFAULT_CONFIG.review);
  if (extra !== void 0) return `has unknown key "review.${extra}"`;
  const {
    maxNits = DEFAULT_CONFIG.review.maxNits,
    onStop = DEFAULT_CONFIG.review.onStop,
    docsWriterModel = DEFAULT_CONFIG.review.docsWriterModel
  } = value;
  if (!isCount(maxNits)) return '"review.maxNits" must be a whole number of 0 or more';
  if (typeof onStop !== "boolean") return '"review.onStop" must be true or false';
  if (typeof docsWriterModel !== "string" || docsWriterModel === "") {
    return '"review.docsWriterModel" must be a non-empty string';
  }
  return { maxNits, onStop, docsWriterModel };
}
function parseConfig(value) {
  if (!isRecord(value)) return "must be a JSON object";
  const extra = unknownKey(value, DEFAULT_CONFIG);
  if (extra !== void 0) return `has unknown key "${extra}"`;
  const {
    level = DEFAULT_CONFIG.level,
    stack = DEFAULT_CONFIG.stack,
    disable = DEFAULT_CONFIG.disable,
    ignorePaths = DEFAULT_CONFIG.ignorePaths,
    review = DEFAULT_CONFIG.review,
    maxFeedbackRounds = DEFAULT_CONFIG.maxFeedbackRounds
  } = value;
  if (!isLevel(level)) return '"level" must be "quick", "standard" or "strict"';
  if (!isStringArray(stack)) return '"stack" must be an array of strings';
  if (!isStringArray(disable)) return '"disable" must be an array of strings';
  if (!isStringArray(ignorePaths)) return '"ignorePaths" must be an array of strings';
  if (!isCount(maxFeedbackRounds)) return '"maxFeedbackRounds" must be a whole number of 0 or more';
  const parsedReview = parseReview(review);
  if (typeof parsedReview === "string") return parsedReview;
  return { level, stack, disable, ignorePaths, review: parsedReview, maxFeedbackRounds };
}
function loadConfig(projectDir) {
  let raw;
  try {
    raw = readFileSync2(join(projectDir, CONFIG_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { config: DEFAULT_CONFIG };
    }
    return invalid("cannot be read");
  }
  const value = parseJson(raw);
  if (value === void 0) return invalid("is not valid JSON");
  const config = parseConfig(value);
  return typeof config === "string" ? invalid(config) : { config };
}
function invalid(problem) {
  return { config: DEFAULT_CONFIG, warning: `${CONFIG_FILE} ${problem}; using defaults.` };
}

// src/lib/output.ts
function json(body) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
}
function warn(event, context) {
  return json({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
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

// src/lib/session-changes.ts
import { statSync } from "node:fs";
import { join as join3 } from "node:path";

// src/lib/git.ts
import { execFileSync } from "node:child_process";
var NETWORK_SUBCOMMANDS = /* @__PURE__ */ new Set(["fetch", "pull", "push", "clone", "ls-remote", "remote"]);
var SAFE_OPTIONS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never"];
var SAFE_ENV = { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
function runGit(cwd, args) {
  const [subcommand = ""] = args;
  if (NETWORK_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`git ${subcommand} reaches the network and is not allowed`);
  }
  return execFileSync("git", [...SAFE_OPTIONS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...SAFE_ENV },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2e3,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync as readFileSync3, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var PAUSED_FILE = "paused";
var SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
function stateDir(projectDir) {
  return join2(projectDir, ".theoldman", "state");
}
function sessionSegment(sessionId) {
  if (!SESSION_ID.test(sessionId)) throw new Error("invalid session id");
  return sessionId;
}
function ensureStateDir(projectDir, ...segments) {
  let dir = projectDir;
  for (const segment of [".theoldman", "state", ...segments]) {
    dir = join2(dir, segment);
    if (!existsSync(dir)) {
      mkdirSync(dir);
      if (segment === ".theoldman") writeFileSync(join2(dir, ".gitignore"), "*\n");
    }
    if (lstatSync(dir).isSymbolicLink()) {
      throw new Error(`${segment} is a symbolic link; refusing to write state through it`);
    }
  }
  return dir;
}
function isPaused(projectDir) {
  return existsSync(join2(stateDir(projectDir), PAUSED_FILE));
}
function readSessionJson(projectDir, sessionId, name) {
  const file = join2(stateDir(projectDir), sessionSegment(sessionId), name);
  return existsSync(file) ? parseJson(readFileSync3(file, "utf8")) : void 0;
}
function writeSessionFile(projectDir, sessionId, name, text) {
  const file = join2(ensureStateDir(projectDir, sessionSegment(sessionId)), name);
  writeFileSync(file, text);
  return file;
}
function writeSessionJson(projectDir, sessionId, name, value) {
  writeSessionFile(projectDir, sessionId, name, JSON.stringify(value));
}

// src/lib/session-changes.ts
var BASELINE_FILE = "baseline.json";
var MAX_DIRTY_FILES = 5e3;
function fingerprint(file) {
  try {
    const stats = statSync(file);
    return `${String(stats.size)}:${String(stats.mtimeMs)}`;
  } catch {
    return "missing";
  }
}
function dirtyFiles(projectDir, limit = MAX_DIRTY_FILES) {
  let listed;
  try {
    listed = runGit(projectDir, [
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z"
    ]);
  } catch {
    return void 0;
  }
  const paths = [...new Set(listed.split("\0").filter((path) => path !== ""))];
  if (paths.length > limit) return void 0;
  return Object.fromEntries(paths.map((path) => [path, fingerprint(join3(projectDir, path))]));
}
function recordBaseline(projectDir, sessionId) {
  if (readSessionJson(projectDir, sessionId, BASELINE_FILE) !== void 0) return;
  writeSessionJson(projectDir, sessionId, BASELINE_FILE, dirtyFiles(projectDir) ?? null);
}

// src/lib/stack.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
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
    raw = readFileSync4(join4(projectDir, "package.json"), "utf8");
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

// src/lib/tell.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";
var TELL_FILE = join5("skills", "oldman-rules", "tell.md");
function readTellSections(pluginRoot) {
  const sections = /* @__PURE__ */ new Map();
  let current;
  for (const line of readFileSync5(join5(pluginRoot, TELL_FILE), "utf8").split(/\r?\n/)) {
    const name = /^## (\S.*)$/.exec(line)?.[1];
    if (name !== void 0) {
      current = [];
      sections.set(name.trim(), current);
    } else if (line.startsWith("- ")) {
      current?.push(line);
    }
  }
  return sections;
}

// src/entries/session-start.ts
var HEADER = "theoldman core rules (the oldman-rules skill has the full text):";
var PAUSED = "theoldman is paused: the guards stay on; rules, checks and review are off.";
var QUICK = "theoldman level is quick: guards and edit checks are on, the rules summary and review are off.";
function stackLine(projectDir, configured) {
  if (configured.length > 0) return `Stack (from .theoldman.json): ${configured.join(", ")}.`;
  const detected = detectStack(projectDir);
  return detected.length > 0 ? `Stack (from package.json): ${detected.join(", ")}.` : "Stack: nothing detected from package.json.";
}
runHook(() => {
  const input = readHookInput(isCommonInput);
  if (input === void 0) return failOpen("invalid hook input");
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  try {
    recordBaseline(root, input.session_id);
  } catch {
  }
  const { config, warning } = loadConfig(root);
  const notes = warning === void 0 ? [] : [`theoldman: ${warning}`];
  if (isPaused(root)) return warn("SessionStart", [...notes, PAUSED].join("\n"));
  if (config.level === "quick") return warn("SessionStart", [...notes, QUICK].join("\n"));
  const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
  const rules = readTellSections(pluginRoot).get("core") ?? [];
  if (rules.length === 0) return failOpen("no core rules found in the oldman-rules skill");
  const lines = [...notes, HEADER, ...rules, stackLine(root, config.stack)];
  return warn("SessionStart", lines.join("\n"));
});
