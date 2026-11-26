// src/entries/guard-bash.ts
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// src/lib/config.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join } from "node:path";

// src/lib/input.ts
import { readFileSync } from "node:fs";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isShellToolInput(value) {
  return isRecord(value) && typeof value.command === "string";
}
function isWriteToolInput(value) {
  return isRecord(value) && typeof value.file_path === "string" && typeof value.content === "string";
}
function isEditToolInput(value) {
  return isRecord(value) && typeof value.file_path === "string" && typeof value.old_string === "string" && typeof value.new_string === "string" && (value.replace_all === void 0 || typeof value.replace_all === "boolean");
}
function isToolHookInput(value) {
  if (!isRecord(value) || typeof value.session_id !== "string" || typeof value.cwd !== "string" || typeof value.hook_event_name !== "string") {
    return false;
  }
  switch (value.tool_name) {
    case "Bash":
    case "PowerShell":
      return isShellToolInput(value.tool_input);
    case "Write":
      return isWriteToolInput(value.tool_input);
    case "Edit":
      return isEditToolInput(value.tool_input);
    default:
      return false;
  }
}
function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return void 0;
  }
}
function readToolHookInput(fd = 0) {
  const value = parseJson(readFileSync(fd, "utf8"));
  return isToolHookInput(value) ? value : void 0;
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

// src/lib/dotenv.ts
import { readFileSync as readFileSync3 } from "node:fs";
var LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
function readDotenv(file, name) {
  let text;
  try {
    text = readFileSync3(file, "utf8");
  } catch {
    return void 0;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] !== name) continue;
    const raw = match[2] ?? "";
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    return quoted ? quoted[2] ?? "" : raw.replace(/\s+#.*$/, "");
  }
  return void 0;
}

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
var REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
function symbolicRef(cwd, ref) {
  try {
    return runGit(cwd, ["symbolic-ref", "--quiet", "--short", ref]).trim() || void 0;
  } catch {
    return void 0;
  }
}
function currentBranch(cwd) {
  return symbolicRef(cwd, "HEAD");
}
function defaultBranch(cwd, remote) {
  if (!REMOTE_NAME.test(remote) || remote.includes("..")) return void 0;
  return symbolicRef(cwd, `refs/remotes/${remote}/HEAD`)?.replace(`${remote}/`, "");
}

// src/lib/package-scripts.ts
import { existsSync, readFileSync as readFileSync4 } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
function readScripts(file) {
  let value;
  try {
    value = parseJson(readFileSync4(file, "utf8"));
  } catch {
    return /* @__PURE__ */ new Map();
  }
  const scripts = isRecord(value) ? value.scripts : void 0;
  if (!isRecord(scripts)) return /* @__PURE__ */ new Map();
  return new Map(
    Object.entries(scripts).filter(
      (entry) => typeof entry[1] === "string"
    )
  );
}
function findPackageScripts(startDir) {
  let dir = resolve(startDir);
  for (; ; ) {
    const file = join2(dir, "package.json");
    if (existsSync(file)) return { dir, scripts: readScripts(file) };
    const parent = dirname(dir);
    if (parent === dir) return void 0;
    dir = parent;
  }
}

// src/lib/output.ts
function json(body) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
}
function pass() {
  return { exitCode: 0, stdout: "", stderr: "" };
}
function block(reason) {
  return json({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  });
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

// src/lib/shell.ts
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var WRAPPERS = /* @__PURE__ */ new Set(["env", "command", "exec", "time", "nohup", "sudo"]);
var SEPARATORS = /* @__PURE__ */ new Set([";", "|", "&", "(", ")"]);
var REDIRECT = /^(?:\d*|&)(?:>>?|<<?)(&\d*|&-)?(.*)$/;
function isAbbreviation(name, parameter, shortest) {
  return name.length >= shortest && parameter.startsWith(name);
}
function programName(word) {
  return (word.split(/[/\\]/).pop() ?? "").toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
}
function readQuoted(text, start, dialect) {
  const quote = text.charAt(start);
  let value = "";
  for (let i = start + 1; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === quote && quote === "'" && dialect === "powershell" && next === "'") {
      value += "'";
      i++;
    } else if (char === quote && quote === '"' && dialect === "powershell" && next === '"') {
      value += '"';
      i++;
    } else if (char === quote) {
      return [value, i];
    } else if (quote === '"' && dialect === "bash" && char === "\\" && '"\\$`\n'.includes(next)) {
      value += next === "\n" ? "" : next;
      i++;
    } else if (quote === '"' && dialect === "powershell" && char === "`") {
      value += next;
      i++;
    } else {
      value += char;
    }
  }
  return [value, text.length];
}
function finish(words) {
  const assignments = [];
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? { text: "", quoted: false };
    const redirect = word.quoted ? null : REDIRECT.exec(word.text);
    if (redirect === null) {
      kept.push(word.text);
    } else if (redirect[1] === void 0 && redirect[2] === "") {
      i++;
    }
  }
  let start = 0;
  while (start < kept.length) {
    const word = kept[start] ?? "";
    if (ASSIGNMENT.test(word)) {
      assignments.push(word);
      start++;
    } else if (WRAPPERS.has(programName(word))) {
      start++;
      while (kept[start]?.startsWith("-") === true) start++;
    } else {
      break;
    }
  }
  return { assignments, words: kept.slice(start) };
}
function parseCommands(input, dialect) {
  const text = input.replaceAll("\r\n", "\n");
  const escape = dialect === "bash" ? "\\" : "`";
  const commands = [];
  let words = [];
  let word;
  const endWord = () => {
    if (word !== void 0) words.push(word);
    word = void 0;
  };
  const endCommand = () => {
    endWord();
    const command = finish(words);
    if (command.words.length > 0 || command.assignments.length > 0) commands.push(command);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === escape) {
      if (next !== "\n") word = { text: (word?.text ?? "") + next, quoted: word?.quoted ?? false };
      i++;
    } else if (char === "'" || char === '"') {
      const [value, end] = readQuoted(text, i, dialect);
      word = { text: (word?.text ?? "") + value, quoted: true };
      i = end;
    } else if (char === "\n") {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else if (char === "#" && word === void 0) {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline - 1;
    } else if (char === "&" && (text.charAt(i - 1) === ">" || next === ">")) {
      word = { text: (word?.text ?? "") + char, quoted: word?.quoted ?? false };
    } else if (SEPARATORS.has(char) || dialect === "bash" && char === "`") {
      endCommand();
    } else if ((char === "{" || char === "}") && word === void 0 && /^[\s;|&()]?$/.test(next)) {
      endCommand();
    } else {
      word = { text: (word?.text ?? "") + char, quoted: word?.quoted ?? false };
    }
  }
  endCommand();
  return commands;
}

// src/lib/paths.ts
function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\/([A-Za-z])(?=\/|$)/, "$1:").replace(/^([A-Za-z]):/, (drive) => drive.toLowerCase()).replace(/^\.\//, "");
}
function resolvePath(target, base) {
  const path = normalizePath(target);
  const absolute = /^[a-z]:/.test(path) || path.startsWith("/") ? path : `${normalizePath(base).replace(/\/+$/, "")}/${path}`;
  const [, prefix = "", rest = ""] = /^((?:[a-z]:)?\/?)(.*)$/s.exec(absolute) ?? [];
  const parts = [];
  for (const part of rest.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }
  return prefix + parts.join("/");
}
function isStrictlyInside(path, root) {
  const base = resolvePath(root, "/").replace(/\/$/, "");
  const fold = /^[a-z]:/.test(base) ? (p) => p.toLowerCase() : (p) => p;
  const full = fold(resolvePath(path, base));
  return full.startsWith(`${fold(base)}/`) && full.length > base.length + 1;
}

// src/rules/nested.ts
import { Buffer } from "node:buffer";
var POSIX_SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash", "ksh"]);
var PWSH_VALUE_PARAMETERS = [
  ["executionpolicy", 2],
  ["ep", 2],
  ["windowstyle", 2],
  ["workingdirectory", 2],
  ["wd", 2],
  ["configurationname", 3],
  ["outputformat", 1],
  ["inputformat", 2],
  ["version", 1],
  ["settingsfile", 1],
  ["custompipename", 2],
  ["psconsolefile", 2]
];
function posixShellCommand(args) {
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (["-o", "+o", "--rcfile", "--init-file"].includes(arg)) {
      i++;
    } else if (arg.startsWith("-") || arg.startsWith("+")) {
      command ||= /^-[^-]*c/.test(arg);
    } else {
      return command ? arg : void 0;
    }
  }
  return void 0;
}
function decodeBase64Utf16(value) {
  if (value === void 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return void 0;
  return Buffer.from(value, "base64").toString("utf16le");
}
function powershellCommand(args, windowsPowerShell) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) return windowsPowerShell ? args.slice(i).join(" ") : void 0;
    const name = arg.slice(1).toLowerCase();
    if (isAbbreviation(name, "command", 1)) return args.slice(i + 1).join(" ");
    if (name === "e" || name === "ec" || isAbbreviation(name, "encodedcommand", 2)) {
      return decodeBase64Utf16(args[i + 1]);
    }
    if (isAbbreviation(name, "file", 1)) return void 0;
    if (PWSH_VALUE_PARAMETERS.some(([p, shortest]) => isAbbreviation(name, p, shortest))) i++;
  }
  return void 0;
}
function nestedCommand(words) {
  const program = programName(words[0] ?? "");
  const args = words.slice(1);
  let text;
  let dialect = "bash";
  if (POSIX_SHELLS.has(program)) {
    text = posixShellCommand(args);
  } else if (program === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    text = at === -1 ? void 0 : args.slice(at + 1).join(" ");
    dialect = "powershell";
  } else if (program === "pwsh" || program === "powershell") {
    text = powershellCommand(args, program === "powershell");
    dialect = "powershell";
  }
  return text === void 0 || text.trim() === "" ? void 0 : { text, dialect };
}

// src/rules/wrappers.ts
var RUNNERS = /* @__PURE__ */ new Set(["npx", "bunx", "pnpx"]);
var EXEC_SUBCOMMANDS = {
  npm: ["exec", "x"],
  pnpm: ["exec", "dlx"],
  yarn: ["exec", "dlx"],
  bun: ["x"]
};
var RUN_SUBCOMMANDS = /* @__PURE__ */ new Set(["run", "run-script", "rum", "urn"]);
var LIFECYCLE = {
  test: "test",
  t: "test",
  tst: "test",
  start: "start",
  stop: "stop",
  restart: "restart"
};
function afterFlags(words, from) {
  let i = from;
  while (i < words.length && (words[i] ?? "").startsWith("-")) {
    i += words[i] === "-p" || words[i] === "--package" ? 2 : 1;
  }
  return words.slice(i);
}
function unwrapOnce(words, isScript) {
  const program = programName(words[0] ?? "");
  const sub = words[1] ?? "";
  if (RUNNERS.has(program)) return { kind: "command", words: afterFlags(words, 1) };
  if (!["npm", "pnpm", "yarn", "bun"].includes(program)) return void 0;
  if (EXEC_SUBCOMMANDS[program]?.includes(sub) === true) {
    return { kind: "command", words: afterFlags(words, 2) };
  }
  if (RUN_SUBCOMMANDS.has(sub)) {
    const [name] = afterFlags(words, 2);
    return name === void 0 ? void 0 : { kind: "script", name };
  }
  const lifecycle = program === "bun" ? void 0 : LIFECYCLE[sub];
  if (lifecycle !== void 0) return { kind: "script", name: lifecycle };
  if (program === "pnpm" || program === "yarn") {
    return isScript(sub) ? { kind: "script", name: sub } : { kind: "command", words: words.slice(1) };
  }
  return void 0;
}
function unwrap(words, isScript) {
  let current = { kind: "command", words };
  for (let round = 0; round < 3 && current.kind === "command"; round++) {
    const next = unwrapOnce(current.words, isScript);
    if (next === void 0) break;
    current = next;
  }
  return current;
}

// src/rules/command-expand.ts
var MAX_NESTING = 4;
var MAX_SCRIPT_CALLS = 2;
var HOME = /^(?:~|\$HOME|\$\{HOME\}|\$env:HOME|\$env:USERPROFILE|%USERPROFILE%)(?=$|[/\\])/i;
var CHANGE_DIR = /* @__PURE__ */ new Set(["cd", "chdir", "set-location", "sl", "pushd", "push-location"]);
var POP_DIR = /* @__PURE__ */ new Set(["popd", "pop-location"]);
function resolveTarget(target, cwd, home) {
  const expanded = target.replace(HOME, home);
  if (/\$\{?\w|%\w+%/.test(expanded)) return void 0;
  const absolute = /^(?:[A-Za-z]:|[/\\])/.test(expanded);
  if (cwd === void 0 && !absolute) return void 0;
  return resolvePath(expanded, cwd ?? "/");
}
function setVariable(variables, piece) {
  const equals = piece.indexOf("=");
  if (equals <= 0) return;
  variables.set(
    piece.slice(0, equals).replace(/^\$env:/i, "").toUpperCase(),
    piece.slice(equals + 1)
  );
}
function directoryArgument(words, dialect) {
  const args = words.slice(1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const name = arg.slice(1).toLowerCase();
    if (dialect === "powershell" && arg.startsWith("-")) {
      if (isAbbreviation(name, "path", 3) || isAbbreviation(name, "literalpath", 1)) {
        return args[i + 1] ?? null;
      }
    } else if (dialect === "powershell" && name === "d" && arg.startsWith("/")) {
      continue;
    } else if (!(dialect === "bash" && arg.startsWith("-") && arg !== "-")) {
      return arg;
    }
  }
  return null;
}
function expandCommands(text, dialect, context) {
  const units = [];
  const scriptsByDir = /* @__PURE__ */ new Map();
  const scriptsAt = (dir) => {
    if (dir === void 0) return void 0;
    if (!scriptsByDir.has(dir)) scriptsByDir.set(dir, context.packageScripts(dir));
    return scriptsByDir.get(dir);
  };
  const visit = (line, lineDialect, startCwd, inherited, depth, scriptDepth) => {
    const variables = new Map(inherited);
    const commands = [];
    units.push({ text: line, dialect: lineDialect, commands, variables });
    let cwd = startCwd;
    const stack = [];
    for (const { assignments, words: raw } of parseCommands(line, lineDialect)) {
      const exported = raw[0] === "export" ? raw.slice(1) : [];
      for (const piece of [...assignments, ...exported]) setVariable(variables, piece);
      if (/^\$env:/i.test(raw[0] ?? "")) setVariable(variables, raw.join(""));
      const unwrapped = unwrap(raw, (name) => scriptsAt(cwd)?.scripts.has(name) ?? false);
      if (unwrapped.kind === "script") {
        const pkg = scriptsAt(cwd);
        if (pkg !== void 0 && depth < MAX_NESTING && scriptDepth <= MAX_SCRIPT_CALLS) {
          for (const name of [`pre${unwrapped.name}`, unwrapped.name, `post${unwrapped.name}`]) {
            const script = pkg.scripts.get(name);
            if (script !== void 0)
              visit(script, "bash", pkg.dir, variables, depth + 1, scriptDepth + 1);
          }
        }
        continue;
      }
      const { words } = unwrapped;
      const program = programName(words[0] ?? "");
      if (CHANGE_DIR.has(program)) {
        if (program === "pushd" || program === "push-location") stack.push(cwd);
        const target = directoryArgument(words, lineDialect);
        if (target === null) {
          if (lineDialect === "bash") cwd = context.home;
        } else {
          cwd = target === "-" ? void 0 : resolveTarget(target, cwd, context.home);
        }
        continue;
      }
      if (POP_DIR.has(program)) {
        if (stack.length > 0) cwd = stack.pop();
        continue;
      }
      const nested = nestedCommand(words);
      if (nested !== void 0 && depth < MAX_NESTING) {
        visit(nested.text, nested.dialect, cwd, variables, depth + 1, scriptDepth);
      }
      commands.push({ words, cwd });
    }
  };
  visit(text, dialect, context.cwd, /* @__PURE__ */ new Map(), 0, 0);
  return units;
}

// src/rules/git-options.ts
var options = (names) => {
  const list = names.split(" ");
  const negated = list.map((name) => name.startsWith("no-") ? name.slice(3) : `no-${name}`);
  return [.../* @__PURE__ */ new Set([...list, ...negated])];
};
var PUSH_OPTIONS = options(
  "all branches prune mirror dry-run porcelain delete tags follow-tags signed atomic push-option receive-pack exec force-with-lease force force-if-includes repo set-upstream thin quiet verbose progress recurse-submodules verify ipv4 ipv6"
);
var COMMIT_OPTIONS = options(
  "all patch reuse-message reedit-message fixup squash reset-author short branch porcelain long null file author date message template signoff trailer verify allow-empty allow-empty-message cleanup edit amend post-rewrite include only pathspec-from-file pathspec-file-nul untracked-files verbose quiet dry-run status gpg-sign"
);
function longOption(arg, known) {
  const name = arg.slice(2).split("=")[0] ?? "";
  if (name === "") return void 0;
  if (known.includes(name)) return name;
  const matches = known.filter((option) => option.startsWith(name));
  return matches.length === 1 ? matches[0] : void 0;
}

// src/rules/git-args.ts
var GLOBAL_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
var PUSH_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["repo", "receive-pack", "exec", "push-option"]);
var COMMIT_OPTIONS_WITH_VALUE = new Set(
  "message file author date reuse-message reedit-message fixup squash template cleanup trailer pathspec-from-file".split(" ")
);
function gitInvocation(words) {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (!word.startsWith("-")) return { subcommand: word, args: words.slice(i + 1) };
    if (GLOBAL_OPTIONS_WITH_VALUE.has(word)) i++;
  }
  return void 0;
}
function parsePush(args) {
  const flags = { force: false, allBranches: false, delete: false, noVerify: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      const name = longOption(arg, PUSH_OPTIONS) ?? "";
      flags.force ||= ["force", "force-with-lease", "mirror"].includes(name);
      flags.allBranches ||= ["mirror", "all", "branches"].includes(name);
      flags.delete ||= name === "delete";
      flags.noVerify ||= name === "no-verify";
      if (PUSH_OPTIONS_WITH_VALUE.has(name) && !arg.includes("=")) i++;
    } else if (arg.startsWith("-") && arg.length > 1) {
      const letters = arg.slice(1).split("o")[0] ?? "";
      flags.force ||= letters.includes("f");
      flags.delete ||= letters.includes("d");
      if (arg.endsWith("o")) i++;
    } else {
      positional.push(arg);
    }
  }
  const [remote = "origin", ...refspecs] = positional;
  return { ...flags, remote, refspecs };
}
function refspecTarget(refspec) {
  const spec = refspec.replace(/^\+/, "");
  const colon = spec.indexOf(":");
  return (colon === -1 ? spec : spec.slice(colon + 1)).replace(/^refs\/heads\//, "");
}
function commitSkipsHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") return false;
    if (arg.startsWith("--")) {
      const name = longOption(arg, COMMIT_OPTIONS);
      if (name === "no-verify") return true;
      if (name !== void 0 && COMMIT_OPTIONS_WITH_VALUE.has(name) && !arg.includes("=")) i++;
    } else if (arg.startsWith("-")) {
      const valueAt = arg.slice(1).search(/[mFCct]/);
      const letters = valueAt === -1 ? arg.slice(1) : arg.slice(1, valueAt + 1);
      if (letters.includes("n")) return true;
      if (valueAt === arg.length - 2) i++;
    }
  }
  return false;
}

// src/rules/guard-db.ts
var SQL_CLIENTS = /* @__PURE__ */ new Set(["psql", "mysql", "mariadb"]);
var DESTRUCTIVE_SQL = /\b(?:drop\s+(?:database|table|schema)|truncate)\b/i;
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["", "localhost", "127.0.0.1", "::1", "0.0.0.0"]);
function prismaOperation(words) {
  if (programName(words[0] ?? "") !== "prisma") return void 0;
  const args = words.slice(1);
  const [first, second] = args.filter((arg) => !arg.startsWith("-"));
  if (first === "migrate" && second === "reset") return "prisma migrate reset";
  if (first === "db" && second === "push" && args.includes("--force-reset")) {
    return "prisma db push --force-reset";
  }
  return void 0;
}
function clientUrl(words) {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (word.includes("://")) return word.replace(/^--dbname=/, "");
    const host = word === "-h" || word === "--host" ? words[i + 1] : /^--host=(.*)$/.exec(word)?.[1];
    if (host !== void 0) return `db://${host.startsWith("/") ? "" : host}`;
  }
  return void 0;
}
function isLocal(url) {
  if (url === void 0) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return parsed.protocol === "file:" || LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}
function databaseViolation(unit, context) {
  const { text, commands, variables } = unit;
  const sqlClient = commands.find((c) => SQL_CLIENTS.has(programName(c.words[0] ?? "")));
  const prisma = commands.map((c) => prismaOperation(c.words)).find((op) => op !== void 0);
  const sql = sqlClient !== void 0 && DESTRUCTIVE_SQL.test(text) ? "DROP or TRUNCATE" : void 0;
  const operation = prisma ?? sql;
  if (operation === void 0) return void 0;
  const url = (sql !== void 0 && sqlClient !== void 0 ? clientUrl(sqlClient.words) : void 0) ?? variables.get("DATABASE_URL") ?? context.env("DATABASE_URL") ?? context.dotenv("DATABASE_URL");
  if (isLocal(url)) return void 0;
  const why = url === void 0 ? "no DATABASE_URL was found, so it may not be local" : "the database is not local";
  return {
    id: "OLDMAN-G04",
    message: `${operation} destroys data and ${why}. Run it against a local database, or ask the user to run it themselves.`
  };
}

// src/rules/guard-rm.ts
var REMOVE_ITEM = /* @__PURE__ */ new Set(["remove-item", "rm", "ri", "del", "erase", "rd", "rmdir"]);
function rmTargets(args) {
  let recursive = false;
  let force = false;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      targets.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      recursive ||= arg === "--recursive";
      force ||= arg === "--force";
    } else if (arg.startsWith("-") && arg.length > 1) {
      recursive ||= /[rR]/.test(arg);
      force ||= arg.includes("f");
    } else {
      targets.push(arg);
    }
  }
  return recursive && force ? targets : [];
}
function removeItemTargets(args) {
  let recursive = false;
  let force = false;
  let whatIf = false;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) {
      targets.push(arg);
      continue;
    }
    const [name = "", attached] = arg.slice(1).toLowerCase().split(/:(.*)/s);
    const takesValue = ["path", "literalpath", "lp"].some(
      (p) => isAbbreviation(name, p, p === "lp" ? 2 : 1)
    );
    if (takesValue) {
      const value = attached ?? args[++i];
      if (value !== void 0) targets.push(value);
    } else if (["filter", "include", "exclude", "credential", "stream"].some((p) => isAbbreviation(name, p, 2))) {
      if (attached === void 0) i++;
    }
    recursive ||= isAbbreviation(name, "recurse", 1);
    force ||= isAbbreviation(name, "force", 2);
    whatIf ||= isAbbreviation(name, "whatif", 1);
  }
  return recursive && force && !whatIf ? targets : [];
}
function removalViolation(words, dialect, cwd, context) {
  const program = programName(words[0] ?? "");
  const args = words.slice(1);
  const targets = dialect === "powershell" && REMOVE_ITEM.has(program) ? removeItemTargets(args) : dialect === "bash" && program === "rm" ? rmTargets(args) : [];
  const outside = targets.find((target) => {
    const resolved = resolveTarget(target, cwd, context.home);
    return resolved !== void 0 && !isStrictlyInside(resolved, context.projectRoot);
  });
  if (outside === void 0) return void 0;
  return {
    id: "OLDMAN-G03",
    message: `recursively force-deleting ${outside} reaches outside this project (or deletes the project itself). Delete only paths inside the project, or ask the user to run it themselves.`
  };
}

// src/rules/secrets.ts
var PROVIDER_PATTERNS = [
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "an AWS access key ID"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, "a GitHub token"],
  [/\b[rs]k_live_[A-Za-z0-9]{16,}\b/g, "a Stripe live key"],
  [/\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/g, "an Anthropic API key"],
  [/\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, "an OpenAI API key"],
  [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, "a private key block"]
];
var ASSIGNMENT2 = /["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(["'`]?)([^\s"'`,;]+)\2/g;
var SECRET_NAME = /(?:_(?:secret|key|token)|password)$/i;
var CAMEL_SECRET_NAME = /[a-z0-9](?:Secret|Key|Token)$/;
var PUBLIC_NAME = /public|publishable/i;
var PLACEHOLDER = /your[-_ ]?[a-z_-]*here|change[-_ ]?me|placeholder|example|dummy|sample|redacted|x{4}|\*{3}|^<.*>$|^\$\{?\w+\}?$|^\{\{.*\}\}$|^(.)\1+$/i;
var CODE_REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|env\b)|^[$<{]|\(/;
function isPlaceholder(value) {
  return PLACEHOLDER.test(value);
}
function entropy(value) {
  const counts = /* @__PURE__ */ new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
function looksRandom(value) {
  return value.length >= 16 && /\d/.test(value) && /[A-Za-z]/.test(value) && entropy(value) >= 3.2;
}
function assignedSecret(line) {
  for (const match of line.matchAll(ASSIGNMENT2)) {
    const [, name = "", , value = ""] = match;
    const secretName = SECRET_NAME.test(name) || CAMEL_SECRET_NAME.test(name);
    if (!secretName || PUBLIC_NAME.test(name) || isPlaceholder(value)) continue;
    if (!CODE_REFERENCE.test(value) && looksRandom(value))
      return `a secret value assigned to ${name}`;
  }
  return void 0;
}
function secretKind(line) {
  for (const [pattern, kind] of PROVIDER_PATTERNS) {
    if ([...line.matchAll(pattern)].some(([token]) => !isPlaceholder(token))) return kind;
  }
  return assignedSecret(line);
}
function scanSecrets(text) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const kind = secretKind(line);
    return kind === void 0 ? [] : [{ line: index + 1, kind }];
  });
}
function commandSecretMessage(finding) {
  return `line ${String(finding.line)} of the command looks like ${finding.kind}. Do not put secrets in commands: they end up in shell history, logs and files. Read the value from an environment variable instead.`;
}

// src/rules/guard-bash.ts
var SAFE_ALTERNATIVE = "or ask the user to run it themselves.";
var forcePush = (target) => ({
  id: "OLDMAN-G01",
  message: `force-pushing to ${target} rewrites history others depend on. Push to a new branch and open a pull request, ${SAFE_ALTERNATIVE}`
});
var deleteBranch = (target) => ({
  id: "OLDMAN-G01",
  message: `deleting ${target} on the remote removes a branch others depend on. Delete only your own feature branches, ${SAFE_ALTERNATIVE}`
});
var skipHooks = {
  id: "OLDMAN-G02",
  message: "--no-verify skips the git hooks that check this repo. Fix what the hook reports, then commit or push without --no-verify."
};
function pushViolations(args, git) {
  const push = parsePush(args);
  const isProtected = (branch) => branch !== void 0 && branch !== "" && (branch === "main" || branch === "master" || branch === git.defaultBranch(push.remote));
  const deleted = push.delete ? push.refspecs.map(refspecTarget) : push.refspecs.filter((s) => s.startsWith(":")).map(refspecTarget);
  const pushed = push.refspecs.filter((s) => !s.startsWith(":"));
  const forced = push.refspecs.length > 0 ? pushed.filter((s) => push.force || s.startsWith("+")) : push.force ? ["HEAD"] : [];
  const forcedTargets = forced.map(refspecTarget).map((t) => t === "HEAD" || t === "@" ? git.currentBranch() : t);
  const deletedTarget = deleted.find(isProtected);
  const forcedTarget = push.allBranches ? void 0 : forcedTargets.find(isProtected);
  return [
    push.allBranches && push.force ? forcePush("every branch, including the default branch") : void 0,
    deletedTarget === void 0 ? void 0 : deleteBranch(deletedTarget),
    forcedTarget === void 0 || push.delete ? void 0 : forcePush(forcedTarget),
    push.noVerify ? skipHooks : void 0
  ];
}
function gitViolations(words, git) {
  const invocation = programName(words[0] ?? "") === "git" ? gitInvocation(words) : void 0;
  if (invocation?.subcommand === "push") return pushViolations(invocation.args, git);
  return [
    invocation?.subcommand === "commit" && commitSkipsHooks(invocation.args) ? skipHooks : void 0
  ];
}
function checkCommand(text, dialect, context) {
  const found = /* @__PURE__ */ new Map();
  for (const unit of expandCommands(text, dialect, context)) {
    const violations = [
      ...unit.commands.flatMap(({ words, cwd }) => [
        ...gitViolations(words, context),
        removalViolation(words, unit.dialect, cwd, context)
      ]),
      databaseViolation(unit, context)
    ];
    for (const violation of violations) {
      if (violation !== void 0 && !found.has(violation.id)) found.set(violation.id, violation);
    }
  }
  const [secret] = scanSecrets(text);
  if (secret !== void 0)
    found.set("OLDMAN-S01", { id: "OLDMAN-S01", message: commandSecretMessage(secret) });
  return [...found.values()];
}

// src/entries/guard-bash.ts
runHook(() => {
  const input = readToolHookInput();
  if (input === void 0 || input.tool_name !== "Bash" && input.tool_name !== "PowerShell") {
    return failOpen("invalid hook input");
  }
  const { cwd } = input;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const { disable } = loadConfig(projectRoot).config;
  const violations = checkCommand(
    input.tool_input.command,
    input.tool_name === "PowerShell" ? "powershell" : "bash",
    {
      cwd,
      projectRoot,
      home: homedir(),
      env: (name) => process.env[name],
      dotenv: (name) => readDotenv(join3(projectRoot, ".env"), name),
      packageScripts: (dir) => findPackageScripts(dir),
      currentBranch: () => currentBranch(cwd),
      defaultBranch: (remote) => defaultBranch(cwd, remote)
    }
  ).filter((violation) => !disable.includes(violation.id));
  if (violations.length === 0) return pass();
  return block(violations.map(({ id, message }) => `${id}: ${message}`).join("\n"));
});
