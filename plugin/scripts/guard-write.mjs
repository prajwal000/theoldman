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

// src/rules/guard-write.ts
var SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)/;
var KEY_EXTENSION = /\.(?:pem|key)$/;
function fileName(path) {
  return (normalizePath(path).split("/").pop() ?? "").toLowerCase();
}
function checkPath(path) {
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

// src/entries/guard-write.ts
runHook(() => {
  const input = readToolHookInput();
  if (input === void 0 || input.tool_name !== "Write" && input.tool_name !== "Edit") {
    return failOpen("invalid hook input");
  }
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const violation = checkPath(input.tool_input.file_path);
  if (violation === void 0 || loadConfig(projectRoot).config.disable.includes(violation.id)) {
    return pass();
  }
  return block(`${violation.id}: ${violation.message}`);
});
