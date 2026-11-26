// src/entries/stop-review.ts
import { createHash } from "node:crypto";

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
function isStopHookInput(value) {
  return isCommonInput(value) && typeof value.stop_hook_active === "boolean" && (value.last_assistant_message === void 0 || typeof value.last_assistant_message === "string");
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

// src/lib/diff.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/git.ts
import { execFileSync } from "node:child_process";
import { basename, dirname } from "node:path";
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
function readHeadVersion(filePath2) {
  try {
    return runGit(dirname(filePath2), ["cat-file", "blob", `HEAD:./${basename(filePath2)}`]);
  } catch {
    return void 0;
  }
}

// src/lib/added-lines.ts
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// src/lib/diff.ts
var DIFF_ARGS = [
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-renames",
  "--relative",
  "--src-prefix=a/",
  "--dst-prefix=b/"
];
var MAX_UNTRACKED_BYTES = 1024 * 1024;
function newFileDiff(cwd, path) {
  const header = `diff --git a/${path} b/${path}
new file mode 100644
`;
  let content;
  try {
    const buffer = readFileSync3(join2(cwd, path));
    if (buffer.length > MAX_UNTRACKED_BYTES || buffer.includes(0)) {
      return `${header}Binary files /dev/null and b/${path} differ
`;
    }
    content = buffer.toString("utf8");
  } catch {
    return "";
  }
  const lines = splitLines(content);
  if (lines.length === 0) return header;
  const body = lines.map((line) => `+${line}
`).join("");
  return `${header}--- /dev/null
+++ b/${path}
@@ -0,0 +1,${String(lines.length)} @@
${body}`;
}
function workingTreeDiff(cwd, paths, base = "HEAD") {
  if (paths?.length === 0) return "";
  const pathspecs = ["--", ...(paths ?? []).map((path) => `:(literal)${path}`)];
  let tracked;
  try {
    tracked = runGit(cwd, [...DIFF_ARGS, base, ...pathspecs]);
  } catch (error) {
    if (base !== "HEAD") throw error;
    tracked = runGit(cwd, [...DIFF_ARGS, "--cached", ...pathspecs]);
  }
  const untracked = runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...pathspecs]).split("\0").filter((path) => path !== "");
  return tracked + untracked.map((path) => newFileDiff(cwd, path)).join("");
}
function unquote(path) {
  if (!path.startsWith('"')) return path;
  const bytes = [];
  const body = path.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))?.[0];
    const escapes = { n: 10, t: 9, '"': 34, "\\": 92 };
    bytes.push(octal === void 0 ? escapes[body.charAt(i + 1)] ?? 92 : parseInt(octal, 8));
    i += octal === void 0 ? 1 : 3;
  }
  return Buffer.from(bytes).toString("utf8");
}
function filePath(line, prefix) {
  return unquote(line.slice(4).replace(/\t$/, "")).slice(prefix.length);
}
function parseDiff(diff) {
  const files = [];
  let current;
  let inHunk = false;
  let next = 0;
  for (const line of splitLines(diff)) {
    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      const path = unquote(rest.slice(0, (rest.length - 1) / 2)).slice(2);
      current = { path, status: "modified", addedLines: [] };
      files.push(current);
      inHunk = false;
    } else if (current === void 0) {
      continue;
    } else if (line.startsWith("@@")) {
      next = Number(/^@@ -\S+ \+(\d+)/.exec(line)?.[1] ?? "1");
      inHunk = true;
    } else if (inHunk) {
      if (line.startsWith("+")) current.addedLines.push({ line: next, text: line.slice(1) });
      if (line.startsWith("+") || line.startsWith(" ")) next += 1;
    } else if (line.startsWith("new file mode")) {
      current.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
    } else if (line.startsWith("--- a/") || line.startsWith('--- "a/')) {
      current.path = filePath(line, "a/");
    } else if (line.startsWith("+++ b/") || line.startsWith('+++ "b/')) {
      current.path = filePath(line, "b/");
    }
  }
  return files;
}

// src/lib/output.ts
function json(body) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
}
function pass() {
  return { exitCode: 0, stdout: "", stderr: "" };
}
function fix(event, reason, context) {
  return json({
    decision: "block",
    reason,
    ...context === void 0 ? {} : { hookSpecificOutput: { hookEventName: event, additionalContext: context } }
  });
}
function notify(message) {
  return json({ systemMessage: message });
}
function failOpen(message) {
  return { exitCode: 1, stdout: "", stderr: `theoldman: ${message}
` };
}
function formatFindings(findings) {
  return findings.map((f) => `${f.id} ${f.file}:${String(f.line)} ${f.message}`).join("\n");
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
import { join as join4 } from "node:path";

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync as readFileSync4, rmSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
var PAUSED_FILE = "paused";
var ROUNDS_FILE = "rounds.json";
var TOUCHED_FILE = "touched.json";
var CAPPED_FILE = "capped.json";
var SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
function stateDir(projectDir) {
  return join3(projectDir, ".theoldman", "state");
}
function sessionSegment(sessionId) {
  if (!SESSION_ID.test(sessionId)) throw new Error("invalid session id");
  return sessionId;
}
function ensureStateDir(projectDir, ...segments) {
  let dir = projectDir;
  for (const segment of [".theoldman", "state", ...segments]) {
    dir = join3(dir, segment);
    if (!existsSync(dir)) {
      mkdirSync(dir);
      if (segment === ".theoldman") writeFileSync(join3(dir, ".gitignore"), "*\n");
    }
    if (lstatSync(dir).isSymbolicLink()) {
      throw new Error(`${segment} is a symbolic link; refusing to write state through it`);
    }
  }
  return dir;
}
function isPaused(projectDir) {
  return existsSync(join3(stateDir(projectDir), PAUSED_FILE));
}
function readRounds(file) {
  const rounds = /* @__PURE__ */ new Map();
  const value = existsSync(file) ? parseJson(readFileSync4(file, "utf8")) : void 0;
  if (!isRecord(value)) return rounds;
  for (const [check, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      rounds.set(check, count);
    }
  }
  return rounds;
}
function getRounds(projectDir, sessionId, check) {
  const file = join3(stateDir(projectDir), sessionSegment(sessionId), ROUNDS_FILE);
  return readRounds(file).get(check) ?? 0;
}
function addRound(projectDir, sessionId, check) {
  const file = join3(ensureStateDir(projectDir, sessionSegment(sessionId)), ROUNDS_FILE);
  const rounds = readRounds(file);
  const next = (rounds.get(check) ?? 0) + 1;
  rounds.set(check, next);
  writeFileSync(file, JSON.stringify(Object.fromEntries(rounds)));
  return next;
}
var isStringArray2 = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
function readSessionJson(projectDir, sessionId, name) {
  const file = join3(stateDir(projectDir), sessionSegment(sessionId), name);
  return existsSync(file) ? parseJson(readFileSync4(file, "utf8")) : void 0;
}
function writeSessionFile(projectDir, sessionId, name, text) {
  const file = join3(ensureStateDir(projectDir, sessionSegment(sessionId)), name);
  writeFileSync(file, text);
  return file;
}
function writeSessionJson(projectDir, sessionId, name, value) {
  writeSessionFile(projectDir, sessionId, name, JSON.stringify(value));
}
function touchedFiles(projectDir, sessionId) {
  const value = readSessionJson(projectDir, sessionId, TOUCHED_FILE);
  return isStringArray2(value) ? value : [];
}
function cappedFindings(projectDir, sessionId) {
  const value = readSessionJson(projectDir, sessionId, CAPPED_FILE);
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry) => isStringArray2(entry[1]))
  );
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
  let listed2;
  try {
    listed2 = runGit(projectDir, [
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
  const paths = [...new Set(listed2.split("\0").filter((path) => path !== ""))];
  if (paths.length > limit) return void 0;
  return Object.fromEntries(paths.map((path) => [path, fingerprint(join4(projectDir, path))]));
}
var insideProject = (path) => !/^(?:[a-z]:|\/|\.\.(?:\/|$))/i.test(path);
function sessionChanges(projectDir, sessionId) {
  const touched = touchedFiles(projectDir, sessionId).filter(insideProject);
  const baseline = readSessionJson(projectDir, sessionId, BASELINE_FILE);
  const now = isRecord(baseline) ? dirtyFiles(projectDir) : void 0;
  const changed = isRecord(baseline) ? Object.entries(now ?? {}).filter(([path, print]) => baseline[path] !== print).map(([path]) => path) : [];
  return [.../* @__PURE__ */ new Set([...touched, ...changed])];
}

// src/lib/stop-report.ts
var MAX_LISTED = 20;
function section(title, lines) {
  if (lines.length === 0) return [];
  const more = lines.length - MAX_LISTED;
  return [
    "",
    title,
    ...lines.slice(0, MAX_LISTED),
    ...more > 0 ? [`...and ${String(more)} more.`] : []
  ];
}
var asLines = (findings) => findings.length === 0 ? [] : formatFindings(findings).split("\n");
function blockReason({ diffPath, fixes, capped, notes }) {
  const steps = [];
  if (diffPath !== void 0) {
    const apiDocs = notes.some((note) => note.id === "OLDMAN-D02") ? " Also check whether the API docs need an update for the changed routes." : "";
    steps.push(
      `1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at ${diffPath}.${apiDocs}`,
      "2. Run the theoldman:oldman-verifier subagent with the same diff path and the reviewer's full reply.",
      "3. Fix every confirmed Critical and Important finding, then run the tests again. Mention confirmed Nits in your summary."
    );
  }
  if (fixes.length > 0) {
    steps.push(`${String(steps.length + 1)}. Fix these docs findings:`, ...asLines(fixes));
  }
  return [
    "theoldman: code changed in this session. Before you finish:",
    ...steps,
    ...section("Left after the feedback limit; mention them in your summary:", capped),
    ...section("Notes, no fix required:", asLines(notes))
  ].join("\n");
}
function userNotice(report, reviewSkipped) {
  const lines = [
    ...reviewSkipped === void 0 ? [] : ["", `Review skipped: ${reviewSkipped}.`],
    ...section("Not fixed after the feedback limit:", [...report.capped, ...asLines(report.fixes)]),
    ...section("Notes:", asLines(report.notes))
  ];
  return lines.length === 0 ? void 0 : ["theoldman:", ...lines.slice(1)].join("\n");
}

// src/rules/docs-context.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";

// src/lib/dotenv.ts
var LISTED = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
function dotenvNames(text) {
  const names = /* @__PURE__ */ new Set();
  for (const line of text.split(/\r?\n/)) {
    const name = LISTED.exec(line)?.[1];
    if (name !== void 0) names.add(name);
  }
  return names;
}

// src/rules/docs-context.ts
var DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
function readText(path) {
  try {
    return readFileSync5(path, "utf8");
  } catch {
    return void 0;
  }
}
function manifest(text) {
  const value = text === void 0 ? void 0 : parseJson(text);
  return isRecord(value) ? value : void 0;
}
function dependencyNames(pkg) {
  return new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = pkg[field];
      return isRecord(dependencies) ? Object.keys(dependencies) : [];
    })
  );
}
function lineOf(file, matches) {
  return (file.addedLines.find(({ text }) => matches(text)) ?? file.addedLines[0])?.line ?? 1;
}
function packageChanges(projectDir, file) {
  const now = manifest(readText(join5(projectDir, file.path)));
  if (now === void 0) return { dependencies: [], scripts: [] };
  const before = (file.status === "added" ? void 0 : manifest(readHeadVersion(join5(projectDir, file.path)))) ?? {};
  const old = dependencyNames(before);
  const dependencies = [...dependencyNames(now)].filter((name) => !old.has(name)).map((name) => ({
    file: file.path,
    line: lineOf(file, (text) => text.includes(`"${name}"`)),
    name
  }));
  const scriptsChanged = JSON.stringify(now.scripts ?? {}) !== JSON.stringify(before.scripts ?? {});
  const scripts = scriptsChanged ? [{ file: file.path, line: lineOf(file, () => true) }] : [];
  return { dependencies, scripts };
}
function exampleVars(projectDir) {
  let listed2;
  try {
    listed2 = runGit(projectDir, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ":(glob)**/.env.example"
    ]);
  } catch {
    return /* @__PURE__ */ new Set();
  }
  const names = /* @__PURE__ */ new Set();
  for (const path of listed2.split("\0").filter((entry) => entry !== "")) {
    for (const name of dotenvNames(readText(join5(projectDir, path)) ?? "")) names.add(name);
  }
  return names;
}
function buildDocsContext(projectDir, diff, summary = "") {
  const files = parseDiff(diff);
  const packages = files.filter((file) => file.status !== "deleted" && /(^|\/)package\.json$/.test(file.path)).map((file) => packageChanges(projectDir, file));
  return {
    files,
    exampleVars: exampleVars(projectDir),
    newDependencies: packages.flatMap((changes) => changes.dependencies),
    scriptChanges: packages.flatMap((changes) => changes.scripts),
    summary
  };
}

// src/rules/docs.ts
var CODE_FILE = /\.[cm]?[jt]sx?$/;
var COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
var ENV_READ = /\bprocess\.env(?:\.([A-Za-z_]\w*)\b|\[\s*(['"`])([A-Za-z_]\w*)\2\s*\])(?!\s*=(?!=))/g;
var RUNTIME_VARS = /* @__PURE__ */ new Set(["NODE_ENV", "CI"]);
var TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
var ROUTE_FILE = [
  /(^|\/)app\/(.+\/)?route\.[cm]?[jt]s$/,
  /(^|\/)pages\/api\//,
  /(^|\/)(routes|controllers|api)\//,
  /\.(controller|routes?|router)\.[cm]?[jt]s$/
];
var API_DOC = /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$|(^|\/)docs\/(.+\/)?(api|routes?)([^/]*\.md$|\/)|(^|\/)(api|routes)\.md$/;
var ADR = /(^|\/)(adr|decisions)\/[^/]+\.md$/;
var SETUP_FILE = /(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml|\.nvmrc|\.node-version|\.tool-versions|makefile|pnpm-workspace\.yaml)$/;
var README = /(^|\/)readme[^/]*$/;
var lower = (file) => file.path.toLowerCase();
var firstLine = (file) => file.addedLines[0]?.line ?? 1;
function listed(paths) {
  const more = paths.length - 3;
  return paths.slice(0, 3).join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
}
var d01 = ({ files, exampleVars: exampleVars2 }) => {
  const seen = /* @__PURE__ */ new Set();
  return files.filter((file) => file.status !== "deleted" && CODE_FILE.test(lower(file))).flatMap(
    (file) => file.addedLines.filter(({ text }) => !COMMENT_LINE.test(text)).flatMap(
      ({ line, text }) => [...text.matchAll(ENV_READ)].flatMap((match) => {
        const name = match[1] ?? match[3] ?? "";
        if (exampleVars2.has(name) || RUNTIME_VARS.has(name) || seen.has(name)) return [];
        seen.add(name);
        return [
          {
            id: "OLDMAN-D01",
            action: "fix",
            file: file.path,
            line,
            message: `process.env.${name} is read here but no .env.example lists ${name}. Add ${name}= with a placeholder value and a short comment.`
          }
        ];
      })
    )
  );
};
var d02 = ({ files }) => {
  const routes = files.filter((file) => {
    const path = lower(file);
    return CODE_FILE.test(path) && !TEST_FILE.test(path) && ROUTE_FILE.some((re) => re.test(path));
  });
  const [first] = routes;
  if (first === void 0 || files.some((file) => API_DOC.test(lower(file)))) return [];
  return [
    {
      id: "OLDMAN-D02",
      action: "warn",
      file: first.path,
      line: firstLine(first),
      message: `API route files changed (${listed(routes.map((file) => file.path))}) but no OpenAPI or route docs did. Check whether the API docs need an update.`
    }
  ];
};
var d03 = ({ files, newDependencies, summary }) => {
  if (files.some((file) => file.status !== "deleted" && ADR.test(lower(file)))) return [];
  const said = summary.toLowerCase();
  return newDependencies.filter(({ name }) => !said.includes(name.toLowerCase())).map(({ file, line, name }) => ({
    id: "OLDMAN-D03",
    action: "warn",
    file,
    line,
    message: `New dependency ${name} has no ADR and no reason in your summary. Say in one line why it is needed, or add an ADR.`
  }));
};
var d04 = ({ files, scriptChanges }) => {
  if (files.some((file) => README.test(lower(file)))) return [];
  const setup = files.filter((file) => SETUP_FILE.test(lower(file)));
  const changed = [
    ...scriptChanges.map(({ file, line }) => ({ file, line, what: `${file} scripts` })),
    ...setup.map((file) => ({ file: file.path, line: firstLine(file), what: file.path }))
  ];
  const [first] = changed;
  if (first === void 0) return [];
  return [
    {
      id: "OLDMAN-D04",
      action: "warn",
      file: first.file,
      line: first.line,
      message: `${listed(changed.map(({ what }) => what))} changed but no README did. Check that the setup steps and commands in the README are still right.`
    }
  ];
};
function checkDocs(context) {
  return [d01, d02, d03, d04].flatMap((rule) => rule(context));
}

// src/entries/stop-review.ts
var DOC_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$|(?:^|\/)(?:license|changelog)[^/]*$/i;
var REVIEW_STATE = "review.json";
var hash = (text) => createHash("sha256").update(text).digest("hex");
function sessionDiff(projectDir, paths) {
  try {
    return workingTreeDiff(projectDir, paths);
  } catch {
    return paths.map((path) => newFileDiff(projectDir, path)).join("");
  }
}
runHook(() => {
  const input = readHookInput(isStopHookInput);
  if (input === void 0) return failOpen("invalid hook input");
  const session = input.session_id;
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  if (isPaused(root)) return pass();
  const paths = sessionChanges(root, session);
  if (paths.length === 0) return pass();
  const diff = sessionDiff(root, paths);
  if (parseDiff(diff).every((file) => DOC_FILE.test(file.path))) return pass();
  const stored = readSessionJson(root, session, REVIEW_STATE);
  const state = (key) => isRecord(stored) ? stored[key] : void 0;
  const save = (reviewed, notified = state("notified")) => {
    writeSessionJson(root, session, REVIEW_STATE, { reviewed, notified });
  };
  const diffHash = hash(diff);
  if (input.stop_hook_active) {
    if (state("reviewed") !== void 0) save(diffHash);
    return pass();
  }
  if (state("reviewed") === diffHash) return pass();
  const { config } = loadConfig(root);
  const summary = input.last_assistant_message ?? "";
  const findings = checkDocs(buildDocsContext(root, diff, summary)).filter(
    (finding) => !config.disable.includes(finding.id)
  );
  const fixes = findings.filter((finding) => finding.action === "fix");
  const notes = findings.filter((finding) => finding.action !== "fix");
  const capped = Object.values(cappedFindings(root, session)).flat();
  const max = config.maxFeedbackRounds;
  const wantsReview = config.level !== "quick" && config.review.onStop;
  const review = wantsReview && getRounds(root, session, "review") < max;
  const docsFix = fixes.length > 0 && getRounds(root, session, "docs") < max;
  if (review || docsFix) {
    const diffPath = review ? writeSessionFile(root, session, "diff.patch", diff) : void 0;
    if (review) addRound(root, session, "review");
    if (docsFix) addRound(root, session, "docs");
    save(diffHash);
    const left = docsFix ? capped : [...capped, ...formatFindings(fixes).split("\n")];
    return fix("Stop", blockReason({ diffPath, fixes: docsFix ? fixes : [], capped: left, notes }));
  }
  const skipped = wantsReview ? `this session already had ${String(max)} reviews (maxFeedbackRounds)` : void 0;
  const notice = userNotice({ fixes, capped, notes }, skipped);
  if (notice === void 0 || state("notified") === hash(notice)) {
    save(diffHash);
    return pass();
  }
  save(diffHash, hash(notice));
  return notify(notice);
});
