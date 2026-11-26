// src/entries/guard-write.ts
import { readFileSync as readFileSync3 } from "node:fs";

// src/lib/added-lines.ts
function lineOffset(content, snippet) {
  const file = content.replaceAll("\r\n", "\n");
  const index = file.indexOf(snippet.replaceAll("\r\n", "\n"));
  return index === -1 ? void 0 : file.slice(0, index).split("\n").length - 1;
}

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
function isCommonInput(value) {
  return isRecord(value) && typeof value.session_id === "string" && typeof value.cwd === "string" && typeof value.hook_event_name === "string" && (value.agent_type === void 0 || typeof value.agent_type === "string");
}
function isToolHookInput(value) {
  if (!isCommonInput(value)) return false;
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
function readHookInput(isValid, fd = 0) {
  const value = parseJson(readFileSync(fd, "utf8"));
  return isValid(value) ? value : void 0;
}
function readToolHookInput(fd = 0) {
  return readHookInput(isToolHookInput, fd);
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

// src/lib/paths.ts
function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\/([A-Za-z])(?=\/|$)/, "$1:").replace(/^([A-Za-z]):/, (drive) => drive.toLowerCase()).replace(/^\.\//, "");
}
function toProjectRelative(filePath, projectDir) {
  const file = normalizePath(filePath);
  const root = normalizePath(projectDir).replace(/\/+$/, "");
  const fold = /^[a-z]:/.test(root) ? (p) => p.toLowerCase() : (p) => p;
  return fold(file).startsWith(`${fold(root)}/`) ? file.slice(root.length + 1) : file;
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

// src/rules/guard-pause.ts
var FLAG_FILE = /(?:^|\/)\.theoldman\/state\/paused$/i;
var pauseViolation = {
  id: "OLDMAN-G08",
  message: "pausing or resuming theoldman is the user's decision. Ask the user to run /theoldman:off or /theoldman:on themselves."
};
function isPauseFlag(path) {
  return FLAG_FILE.test(normalizePath(path));
}

// src/rules/guard-config.ts
var PROTECTED = [
  /(?:^|\/)\.theoldman\.json$/i,
  /(?:^|\/)\.theoldman(?:\/|$)/i,
  /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/i,
  /(?:^|\/)managed-settings\.json$/i,
  /(?:^|\/)\.claude\/plugins(?:\/|$)/i
];
var configViolation = {
  id: "OLDMAN-G09",
  message: "theoldman's settings and Claude Code's settings are the user's to change. Tell the user what to change and why, and let them edit the file or run /theoldman:init."
};
function isProtectedConfig(path) {
  const normalized = normalizePath(path);
  return !isPauseFlag(normalized) && PROTECTED.some((pattern) => pattern.test(normalized));
}

// src/rules/guard-write.ts
var SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)/;
var KEY_EXTENSION = /\.(?:pem|key)$/;
var DOCS_WRITER = "theoldman:oldman-docs-writer";
var DOC_NAME = /^(?:(?:readme|changelog)(?:[.-][\w-]+)*\.(?:md|mdx|markdown|txt|rst|adoc)|readme|changelog|\.env\.example|(?:openapi|swagger)(?:\.[\w-]+)*\.(?:json|ya?ml))$/;
var ROOT_DOC_NAME = /^(?:contributing|security|code_of_conduct|support)\.md$/;
var INSTRUCTION_NAME = /^(?:claude(?:\.local)?\.md|agents\.md|review\.md|\.theoldman\.json|licen[cs]e(?:\.[\w-]+)?)$/;
var INSTRUCTION_DIRS = [".claude", ".github"];
function fileName(path) {
  return (normalizePath(path).split("/").pop() ?? "").toLowerCase();
}
function checkPath(path) {
  if (isPauseFlag(path)) return pauseViolation;
  if (isProtectedConfig(path)) return configViolation;
  const name = fileName(path);
  if (name === ".env" || name.startsWith(".env.") && name !== ".env.example") {
    return {
      id: "OLDMAN-G05",
      message: `${path} is an env file and can hold real secrets. Add the variable name to .env.example instead, and ask the user to put the value in their own env file.`
    };
  }
  if (SSH_KEY.test(name) || KEY_EXTENSION.test(name)) {
    return {
      id: "OLDMAN-G06",
      message: `${path} looks like a private key or certificate file. Do not create or change key files; ask the user to manage them.`
    };
  }
  return void 0;
}
function projectRelative(path, projectDir) {
  const root = resolvePath(projectDir, "/");
  if (!isStrictlyInside(path, root)) return void 0;
  return toProjectRelative(resolvePath(path, root), root).toLowerCase();
}
function isInstruction(relative) {
  const parts = relative.split("/");
  return INSTRUCTION_NAME.test(parts.at(-1) ?? "") || parts.slice(0, -1).some((part) => INSTRUCTION_DIRS.includes(part));
}
function isDoc(relative) {
  const name = relative.split("/").pop() ?? "";
  return DOC_NAME.test(name) || relative === name && ROOT_DOC_NAME.test(name) || relative.startsWith("docs/") && name.endsWith(".md");
}
function checkAgentPath(path, projectDir, agentType, cwd = projectDir) {
  if (agentType !== DOCS_WRITER) return void 0;
  const relative = projectRelative(resolvePath(path, cwd), projectDir);
  if (relative !== void 0 && isInstruction(relative)) {
    return {
      id: "OLDMAN-G07",
      message: `${path} holds agent instructions or config. The docs writer may not change it, because an edit there could persist a prompt injection. Describe the change in your reply instead.`
    };
  }
  if (relative !== void 0 && isDoc(relative)) return void 0;
  return {
    id: "OLDMAN-G07",
    message: `${path} is not a documentation file. The docs writer may only change README and CHANGELOG files, root CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and SUPPORT files, Markdown under docs/, .env.example and OpenAPI files. Describe the code change in your reply instead of making it.`
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
var ASSIGNMENT = /["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(["'`]?)([^\s"'`,;]+)\2/g;
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
  for (const match of line.matchAll(ASSIGNMENT)) {
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
function secretMessage(file, finding) {
  return `${file}:${String(finding.line)} looks like ${finding.kind}. Do not write secrets into files: read the value from an environment variable and keep it out of the repo.`;
}

// src/entries/guard-write.ts
var MAX_LISTED = 5;
function editOffset(file, oldString) {
  try {
    return lineOffset(readFileSync3(file, "utf8"), oldString) ?? 0;
  } catch {
    return 0;
  }
}
runHook(() => {
  const input = readToolHookInput();
  if (input === void 0 || input.tool_name !== "Write" && input.tool_name !== "Edit") {
    return failOpen("invalid hook input");
  }
  const file = input.tool_input.file_path;
  const [text, offset] = input.tool_name === "Write" ? [input.tool_input.content, 0] : [input.tool_input.new_string, editOffset(file, input.tool_input.old_string)];
  const secrets = scanSecrets(text).map((finding) => ({
    id: "OLDMAN-S01",
    message: secretMessage(file, { ...finding, line: finding.line + offset })
  }));
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const { disable } = loadConfig(root).config;
  const agentPath = checkAgentPath(file, root, input.agent_type, input.cwd);
  const violations = [checkPath(file), agentPath, ...secrets].filter(
    (violation) => violation !== void 0 && !disable.includes(violation.id)
  );
  if (violations.length === 0) return pass();
  const listed = violations.slice(0, MAX_LISTED).map(({ id, message }) => `${id}: ${message}`);
  const more = violations.length - listed.length;
  return block([...listed, ...more > 0 ? [`...and ${String(more)} more.`] : []].join("\n"));
});
