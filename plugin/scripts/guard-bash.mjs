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
      start++;
    } else if (WRAPPERS.has(programName(word))) {
      start++;
      while (kept[start]?.startsWith("-") === true) start++;
    } else {
      break;
    }
  }
  return kept.slice(start);
}
function splitCommands(input, dialect) {
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
    if (command.length > 0) commands.push(command);
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

// src/rules/git-args.ts
var GLOBAL_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
var PUSH_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["--repo", "--receive-pack", "--exec", "--push-option"]);
var COMMIT_OPTIONS_WITH_VALUE = new Set(
  "--message --file --author --date --reuse-message --reedit-message --fixup --squash --template --cleanup --trailer".split(
    " "
  )
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
  let force = false;
  let allBranches = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const name = arg.split("=")[0] ?? arg;
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith("--")) {
      if (name === "--force" || name === "--force-with-lease" || name === "--mirror") force = true;
      if (name === "--mirror" || name === "--all" || name === "--branches") allBranches = true;
      if (PUSH_OPTIONS_WITH_VALUE.has(name) && !arg.includes("=")) i++;
    } else if (arg.startsWith("-") && arg.length > 1) {
      const letters = arg.slice(1).split("o")[0] ?? "";
      if (letters.includes("f")) force = true;
      if (arg.endsWith("o")) i++;
    } else {
      positional.push(arg);
    }
  }
  const [remote = "origin", ...refspecs] = positional;
  return { force, allBranches, remote, refspecs };
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
    if (arg === "--no-verify") return true;
    if (arg.startsWith("--")) {
      if (COMMIT_OPTIONS_WITH_VALUE.has(arg)) i++;
    } else if (arg.startsWith("-")) {
      const valueAt = arg.slice(1).search(/[mFCct]/);
      const letters = valueAt === -1 ? arg.slice(1) : arg.slice(1, valueAt + 1);
      if (letters.includes("n")) return true;
      if (valueAt === arg.length - 2) i++;
    }
  }
  return false;
}

// src/rules/guard-bash.ts
var forcePush = (target) => ({
  id: "OLDMAN-G01",
  message: `force-pushing to ${target} rewrites history others depend on. Push to a new branch and open a pull request, or ask the user to run the force-push themselves.`
});
var skipHooks = {
  id: "OLDMAN-G02",
  message: "--no-verify skips the git hooks that check this repo. Fix what the hook reports, then commit or push without --no-verify."
};
function forcePushViolation(args, git) {
  const { force, allBranches, remote, refspecs } = parsePush(args);
  if (allBranches) {
    return force ? forcePush("every branch, including the default branch") : void 0;
  }
  const forced = refspecs.length > 0 ? refspecs.filter((s) => force || s.startsWith("+")) : force ? ["HEAD"] : [];
  const targets = forced.map(refspecTarget).map((t) => t === "HEAD" || t === "@" ? git.currentBranch() : t);
  const protectedTarget = targets.find(
    (branch) => branch !== void 0 && branch !== "" && (branch === "main" || branch === "master" || branch === git.defaultBranch(remote))
  );
  return protectedTarget === void 0 ? void 0 : forcePush(protectedTarget);
}
function checkCommand(text, dialect, git) {
  const found = /* @__PURE__ */ new Map();
  for (const words of splitCommands(text, dialect)) {
    const invocation = programName(words[0] ?? "") === "git" ? gitInvocation(words) : void 0;
    const { subcommand, args = [] } = invocation ?? {};
    const violations = subcommand === "push" ? [forcePushViolation(args, git), args.includes("--no-verify") ? skipHooks : void 0] : [subcommand === "commit" && commitSkipsHooks(args) ? skipHooks : void 0];
    for (const violation of violations) {
      if (violation !== void 0 && !found.has(violation.id)) found.set(violation.id, violation);
    }
  }
  return [...found.values()];
}

// src/entries/guard-bash.ts
runHook(() => {
  const input = readToolHookInput();
  if (input === void 0 || input.tool_name !== "Bash" && input.tool_name !== "PowerShell") {
    return failOpen("invalid hook input");
  }
  const { cwd } = input;
  const { disable } = loadConfig(cwd).config;
  const violations = checkCommand(
    input.tool_input.command,
    input.tool_name === "PowerShell" ? "powershell" : "bash",
    {
      currentBranch: () => currentBranch(cwd),
      defaultBranch: (remote) => defaultBranch(cwd, remote)
    }
  ).filter((violation) => !disable.includes(violation.id));
  if (violations.length === 0) return pass();
  return block(violations.map(({ id, message }) => `${id}: ${message}`).join("\n"));
});
