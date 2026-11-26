// src/entries/check-file.ts
import { readFileSync as readFileSync4 } from "node:fs";

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
function readHeadVersion(filePath) {
  try {
    return runGit(dirname(filePath), ["cat-file", "blob", `HEAD:./${basename(filePath)}`]);
  } catch {
    return void 0;
  }
}

// src/lib/added-lines.ts
var MAX_LCS_CELLS = 2e6;
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
function unmatchedByCount(a, b) {
  const unused = /* @__PURE__ */ new Map();
  for (const id of a) unused.set(id, (unused.get(id) ?? 0) + 1);
  const unmatched = [];
  b.forEach((id, index) => {
    const count = unused.get(id) ?? 0;
    if (count > 0) {
      unused.set(id, count - 1);
    } else {
      unmatched.push(index);
    }
  });
  return unmatched;
}
function unmatchedByLcs(a, b) {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  const at = (index) => table[index] ?? 0;
  for (let i2 = a.length - 1; i2 >= 0; i2--) {
    const row = i2 * width;
    const next = row + width;
    for (let j = b.length - 1; j >= 0; j--) {
      table[row + j] = a[i2] === b[j] ? at(next + j + 1) + 1 : Math.max(at(next + j), at(row + j + 1));
    }
  }
  const unmatched = [];
  let i = 0;
  for (let j = 0; j < b.length; ) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && at((i + 1) * width + j) >= at(i * width + j + 1)) {
      i++;
    } else {
      unmatched.push(j);
      j++;
    }
  }
  return unmatched;
}
function addedIndices(oldLines, newLines) {
  const ids = /* @__PURE__ */ new Map();
  const idOf = (line) => {
    const id = ids.get(line) ?? ids.size;
    ids.set(line, id);
    return id;
  };
  const oldIds = oldLines.map(idOf);
  const newIds = newLines.map(idOf);
  const inOld = new Set(oldIds);
  const inNew = new Set(newIds);
  const added = [];
  const candidates = [];
  const b = [];
  newIds.forEach((id, index) => {
    if (inOld.has(id)) {
      candidates.push(index);
      b.push(id);
    } else {
      added.push(index);
    }
  });
  const a = oldIds.filter((id) => inNew.has(id));
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const aMiddle = a.slice(start, aEnd);
  const bMiddle = b.slice(start, bEnd);
  const unmatched = (aMiddle.length + 1) * (bMiddle.length + 1) > MAX_LCS_CELLS ? unmatchedByCount(aMiddle, bMiddle) : unmatchedByLcs(aMiddle, bMiddle);
  for (const index of unmatched) added.push(candidates[start + index] ?? 0);
  return added.sort((x, y) => x - y);
}
function diffAddedLines(oldText, newText) {
  const newLines = splitLines(newText);
  return addedIndices(splitLines(oldText), newLines).map((index) => ({
    line: index + 1,
    text: newLines[index] ?? ""
  }));
}
function lineOffset(content, snippet) {
  const file = content.replaceAll("\r\n", "\n");
  const index = file.indexOf(snippet.replaceAll("\r\n", "\n"));
  return index === -1 ? void 0 : file.slice(0, index).split("\n").length - 1;
}
function addedLinesForWrite(filePath, content) {
  return diffAddedLines(readHeadVersion(filePath) ?? "", content);
}
function addedLinesForEdit(edit, fileContent) {
  const added = diffAddedLines(edit.old_string, edit.new_string);
  if (fileContent === void 0 || added.length === 0) return added;
  const offset = lineOffset(fileContent, edit.new_string);
  if (offset === void 0) return added;
  const fileLines = splitLines(fileContent);
  return added.map(({ line }) => ({
    line: line + offset,
    text: fileLines[line + offset - 1] ?? ""
  }));
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
function fix(event, reason, context) {
  return json({
    decision: "block",
    reason,
    ...context === void 0 ? {} : { hookSpecificOutput: { hookEventName: event, additionalContext: context } }
  });
}
function warn(event, context) {
  return json({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
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
function globToRegExp(glob) {
  const pattern = normalizePath(glob);
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === "*" && pattern.charAt(i + 1) === "*") {
      const slash = pattern.charAt(i + 2) === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}
function isIgnored(filePath, projectDir, patterns) {
  const relative = toProjectRelative(filePath, projectDir);
  return patterns.some((pattern) => globToRegExp(pattern).test(relative));
}

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync as readFileSync3, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var PAUSED_FILE = "paused";
var ROUNDS_FILE = "rounds.json";
var TOUCHED_FILE = "touched.json";
var CAPPED_FILE = "capped.json";
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
function readRounds(file) {
  const rounds = /* @__PURE__ */ new Map();
  const value = existsSync(file) ? parseJson(readFileSync3(file, "utf8")) : void 0;
  if (!isRecord(value)) return rounds;
  for (const [check, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      rounds.set(check, count);
    }
  }
  return rounds;
}
function getRounds(projectDir, sessionId, check) {
  const file = join2(stateDir(projectDir), sessionSegment(sessionId), ROUNDS_FILE);
  return readRounds(file).get(check) ?? 0;
}
function addRound(projectDir, sessionId, check) {
  const file = join2(ensureStateDir(projectDir, sessionSegment(sessionId)), ROUNDS_FILE);
  const rounds = readRounds(file);
  const next = (rounds.get(check) ?? 0) + 1;
  rounds.set(check, next);
  writeFileSync(file, JSON.stringify(Object.fromEntries(rounds)));
  return next;
}
var isStringArray2 = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
function readSessionJson(projectDir, sessionId, name) {
  const file = join2(stateDir(projectDir), sessionSegment(sessionId), name);
  return existsSync(file) ? parseJson(readFileSync3(file, "utf8")) : void 0;
}
function writeSessionJson(projectDir, sessionId, name, value) {
  writeFileSync(
    join2(ensureStateDir(projectDir, sessionSegment(sessionId)), name),
    JSON.stringify(value)
  );
}
function touchedFiles(projectDir, sessionId) {
  const value = readSessionJson(projectDir, sessionId, TOUCHED_FILE);
  return isStringArray2(value) ? value : [];
}
function recordTouchedFile(projectDir, sessionId, file) {
  const files = touchedFiles(projectDir, sessionId);
  if (!files.includes(file))
    writeSessionJson(projectDir, sessionId, TOUCHED_FILE, [...files, file]);
}
function cappedFindings(projectDir, sessionId) {
  const value = readSessionJson(projectDir, sessionId, CAPPED_FILE);
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry) => isStringArray2(entry[1]))
  );
}
function recordCappedFindings(projectDir, sessionId, file, findings) {
  const all = cappedFindings(projectDir, sessionId);
  if (findings.length === 0 && !(file in all)) return;
  const others = Object.fromEntries(Object.entries(all).filter(([key]) => key !== file));
  writeSessionJson(
    projectDir,
    sessionId,
    CAPPED_FILE,
    findings.length > 0 ? { ...others, [file]: findings } : others
  );
}

// src/lib/js-tokens.ts
function skipString(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote && source[i] !== "\n") {
    i += source[i] === "\\" ? 2 : 1;
  }
  return source[i] === quote ? i + 1 : i;
}
function skipRegex(source, start) {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\n") return -1;
    if (char === "\\") {
      i++;
    } else if (char === "[" || char === "]") {
      inClass = char === "[";
    } else if (char === "/" && !inClass) {
      let end = i + 1;
      while (/[a-z]/i.test(source.charAt(end))) end++;
      return end;
    }
  }
  return -1;
}

// src/lib/js-scan.ts
var BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%>~^".split(""));
var KEYWORDS_BEFORE_REGEX = new Set(
  "return typeof case do else in of new delete void throw yield await instanceof".split(" ")
);
var URL_SCHEME_BEFORE = /[A-Za-z][\w+.-]*:$/;
function scanJs(source, file = "") {
  const jsx = /\.[jt]sx$/i.test(file);
  const spans = [];
  const length = source.length;
  let previous = "";
  const skipTemplate = (start) => {
    let chunk = start;
    let i = start + 1;
    while (i < length) {
      const char = source[i];
      if (char === "`") {
        spans.push({ kind: "template", start: chunk, end: i + 1 });
        return i + 1;
      }
      if (char === "$" && source[i + 1] === "{") {
        spans.push({ kind: "template", start: chunk, end: i + 2 });
        i = scan(i + 2, true);
        chunk = i - 1;
      } else {
        i += char === "\\" ? 2 : 1;
      }
    }
    spans.push({ kind: "template", start: chunk, end: length });
    return length;
  };
  function scan(start, inTemplate) {
    let depth = 0;
    let i = start;
    while (i < length) {
      const char = source.charAt(i);
      const next = source.charAt(i + 1);
      if (char === "/" && next === "/" && jsx && URL_SCHEME_BEFORE.test(source.slice(Math.max(0, i - 32), i))) {
        previous = "/";
        i += 2;
      } else if (char === "/" && next === "/") {
        const newline = source.indexOf("\n", i);
        const end = newline === -1 ? length : newline;
        spans.push({ kind: "line-comment", start: i, end });
        i = end;
      } else if (char === "/" && next === "*") {
        const close = source.indexOf("*/", i + 2);
        const end = close === -1 ? length : close + 2;
        spans.push({ kind: "block-comment", start: i, end });
        i = end;
      } else if (char === '"' || char === "'") {
        const end = skipString(source, i);
        spans.push({ kind: "string", start: i, end });
        previous = '"';
        i = end;
      } else if (char === "`") {
        i = skipTemplate(i);
        previous = "`";
      } else if (char === "/" && (previous === "" || BEFORE_REGEX.has(previous) || KEYWORDS_BEFORE_REGEX.has(previous))) {
        const end = skipRegex(source, i);
        if (end !== -1) spans.push({ kind: "regex", start: i, end });
        previous = end === -1 ? "/" : "regex";
        i = end === -1 ? i + 1 : end;
      } else if (inTemplate && char === "}" && depth === 0) {
        previous = "}";
        return i + 1;
      } else if (/\s/.test(char)) {
        i++;
      } else {
        const word = /^[\w$]+/.exec(source.slice(i, i + 64))?.[0] ?? char;
        if (char === "{") depth++;
        if (char === "}") depth--;
        previous = word;
        i += word.length;
      }
    }
    return i;
  }
  const shebangEnd = source.indexOf("\n");
  scan(source.startsWith("#!") ? shebangEnd === -1 ? length : shebangEnd : 0, false);
  return spans;
}

// src/lib/comments.ts
var SUPPORTED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
function supportsComments(file) {
  return SUPPORTED.test(file);
}
var blockLines = (body) => body.split(/\r?\n/).map(
  (line) => line.trim().replace(/^\*\s?/, "").trim()
);
function extractComments(source, file = "") {
  const comments = [];
  let line = 1;
  let codeLine = 0;
  let position = 0;
  const advance = (to, isCode) => {
    for (let i = position; i < to; i++) {
      const char = source[i];
      if (char === "\n") line++;
      else if (isCode && char !== " " && char !== "	" && char !== "\r") codeLine = line;
    }
    position = to;
  };
  for (const span of scanJs(source, file)) {
    advance(span.start, true);
    if (span.kind !== "line-comment" && span.kind !== "block-comment") {
      advance(span.end, true);
      continue;
    }
    const startLine = line;
    const trailing = codeLine === startLine;
    let kind = "line";
    let lines = [source.slice(span.start + 2, span.end).trim()];
    if (span.kind === "block-comment") {
      const closed = span.end - span.start >= 4 && source.slice(span.end - 2, span.end) === "*/";
      const jsdoc = source[span.start + 2] === "*" && source[span.start + 3] !== "/";
      kind = jsdoc ? "jsdoc" : "block";
      lines = blockLines(
        source.slice(span.start + (jsdoc ? 3 : 2), closed ? span.end - 2 : span.end)
      );
    }
    advance(span.end, false);
    comments.push({
      line: startLine,
      endLine: line,
      text: lines.join("\n").trim(),
      lines,
      kind,
      trailing
    });
  }
  return comments;
}

// src/rules/comment-allow.ts
var REFERENCE = /https?:\/\/\S|#\d+\b/;
var LICENSE = /\b(?:copyright|licen[cs]ed?|spdx-license-identifier)\b|@license\b|@preserve\b|\(c\)\s*\d{4}/i;
var DIRECTIVE_WITH_REASON = /^(?:eslint-disable(?:-next-line|-line)?\b.*\s--\s+\S|@ts-expect-error\b[:\s]+\S)/;
var TRIPLE_SLASH = /^\/\s*<(?:reference|amd-module)\b/;
var EXPORT = /^export\b/;
function nextCodeLine(lines, afterLine, skipDecorators = false) {
  return lines.slice(afterLine).map((line) => line.trim()).find(
    (line) => line !== "" && !/^(?:\/\/|\/\*|\*)/.test(line) && !(skipDecorators && line.startsWith("@"))
  );
}
function isAllowedComment(comment, lines, { references = true } = {}) {
  const { text } = comment;
  if (references && REFERENCE.test(text) || LICENSE.test(text)) return true;
  if (DIRECTIVE_WITH_REASON.test(text) || TRIPLE_SLASH.test(text)) return true;
  if (comment.kind !== "jsdoc") return false;
  return EXPORT.test(nextCodeLine(lines, comment.endLine, true) ?? "");
}

// src/rules/comment-code.ts
function addedComments(input, { references = true } = {}) {
  if (!supportsComments(input.file)) return [];
  const added = new Set(input.addedLines.map(({ line }) => line));
  const lines = input.content.split(/\r?\n/);
  return extractComments(input.content, input.file).filter(
    (comment) => comment.lines.some((_, i) => added.has(comment.line + i)) && !isAllowedComment(comment, lines, { references })
  );
}
var STOP_WORDS = new Set(
  "the a an to of and or for in on at with this that it its is are be by from as into over then if we our".split(
    " "
  )
);
var REASON = /\b(?:because|since|so that|otherwise|instead|workaround|why|unless|until|must|never|always)\b/i;
var OPERATOR_WORDS = [
  [/\+\+|\+=/, "increment add"],
  [/--|-=/, "decrement"],
  [/[^=!<>]=[^=>]/, "set assign store"],
  [/\bnew\b/, "create"],
  [/\bif\b/, "check"],
  [/\b(?:for|while|forEach|map)\b/, "loop iterate"],
  [/\bconsole\b/, "log print"],
  [/\bawait\b/, "wait"],
  [/\.push\(/, "add append"]
];
function stem(word) {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
function words(text) {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return (spaced.match(/[A-Za-z]+/g) ?? []).map(stem);
}
function codeWords(code) {
  const found = new Set(words(code));
  for (const [pattern, synonyms] of OPERATOR_WORDS) {
    if (pattern.test(code)) for (const word of synonyms.split(" ")) found.add(word);
  }
  return found;
}
function restates(comment, lines) {
  if (comment.trailing || comment.kind === "jsdoc" || comment.endLine !== comment.line)
    return false;
  if (REFERENCE.test(comment.text) || REASON.test(comment.text)) return false;
  const content = words(comment.text).filter((word) => !STOP_WORDS.has(word));
  const code = nextCodeLine(lines, comment.endLine);
  if (content.length === 0 || content.length > 8 || code === void 0) return false;
  const known = codeWords(code);
  return content.filter((word) => known.has(word)).length / content.length >= 0.6;
}
var CODE_PATTERNS = [
  /;$/,
  /\{$/,
  /^\}/,
  /^(?:const|let|var)\s+[\w$[{]/,
  /^(?:if|for|while|switch|catch)\s*\(/,
  /^(?:import|export)\s.*(?:\bfrom\s+['"]|[{}*;]|\bdefault\b)/,
  /^(?:await|throw|return)\s+[\w$.]+\(/,
  /^(?:function|class)\s+[\w$]+\s*[({<]/,
  /^[\w$]+(?:\.[\w$]+)*\(.*\)$/,
  /^[\w$.]+\s*[+\-*/%]?=\s*\S+$/
];
function looksLikeCode(text) {
  if (text === "" || REFERENCE.test(text) || text.endsWith(".") && !text.endsWith(".."))
    return false;
  return CODE_PATTERNS.some((pattern) => pattern.test(text));
}
var c02 = (input) => {
  const lines = input.content.split(/\r?\n/);
  return addedComments(input).filter((comment) => restates(comment, lines)).map((comment) => ({
    id: "OLDMAN-C02",
    action: "warn",
    file: input.file,
    line: comment.line,
    message: "This comment repeats what the next line says; explain why instead, or delete it."
  }));
};
var c03 = (input) => {
  const added = new Set(input.addedLines.map(({ line }) => line));
  const codeLines = addedComments(input, { references: false }).filter((comment) => comment.kind !== "jsdoc").flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text }))).filter(({ line, text }) => added.has(line) && looksLikeCode(text)).map(({ line }) => line);
  const runStarts = codeLines.filter((line) => !codeLines.includes(line - 1));
  return runStarts.map((line) => ({
    id: "OLDMAN-C03",
    action: "fix",
    file: input.file,
    line,
    message: "Delete the commented-out code; git keeps the old version if it is needed again."
  }));
};

// src/rules/comment-density.ts
var CODE_LINES_PER_COMMENT_LINE = 5;
var MIN_COMMENT_LINES = 3;
var c06 = (input) => {
  if (!supportsComments(input.file)) return [];
  const lines = input.content.split(/\r?\n/);
  const comments = extractComments(input.content, input.file);
  const commentOnly = new Set(
    comments.flatMap(
      (comment) => comment.lines.map((_, i) => comment.line + i).filter((line, i) => i > 0 || !comment.trailing)
    )
  );
  const commentLines = comments.filter((comment) => !isAllowedComment(comment, lines)).flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text }))).filter(({ text }) => text !== "").map(({ line }) => line);
  const added = input.addedLines.filter(({ text }) => text.trim() !== "");
  const addedNumbers = new Set(added.map(({ line }) => line));
  const addedComments2 = commentLines.filter((line) => addedNumbers.has(line));
  const addedCode = added.filter(({ line }) => !commentOnly.has(line)).length;
  const [first] = addedComments2;
  if (first === void 0 || addedComments2.length < MIN_COMMENT_LINES || addedComments2.length * CODE_LINES_PER_COMMENT_LINE <= addedCode) {
    return [];
  }
  return [
    {
      id: "OLDMAN-C06",
      action: "warn",
      file: input.file,
      line: first,
      message: `This edit adds ${String(addedComments2.length)} comment lines for ${String(addedCode)} lines of code (more than 1 per 5); keep only the comments that say why.`
    }
  ];
};

// src/rules/comments.ts
function addedCommentLines(input) {
  if (!supportsComments(input.file)) return [];
  const added = new Set(input.addedLines.map(({ line }) => line));
  const lines = input.content.split(/\r?\n/);
  return extractComments(input.content, input.file).filter((comment) => !isAllowedComment(comment, lines)).flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text }))).filter(({ line, text }) => text !== "" && added.has(line));
}
var verb = (word, follows) => new RegExp(`^${word}(?=\\s*(?::|$)|\\s+(?:${follows})\\b)`, "i");
var ARTICLES = "the|a|an|this|that|it";
var NARRATION = [
  verb(
    "added",
    `${ARTICLES}|for|support|missing|new|logging|retry|retries|checks?|validation|tests?`
  ),
  verb("updated", `${ARTICLES}|to|for|per|so|with|logic|code|version|deps|dependencies`),
  verb("fixed", `${ARTICLES}|bugs?|issues?|typo|crash|errors?|for|in|by|so`),
  verb("changed", `${ARTICLES}|from|to|so`),
  verb("removed", `${ARTICLES}|unused|old|dead|deprecated`),
  // "Replaced X with Y" and "Renamed X to Y" name what changed before the telling word.
  /^replaced\b.*\b(?:with|by)\b/i,
  /^renamed\b.*\b(?:from|to)\b/i,
  verb("moved", "from|to|here|out|into"),
  /^refactored\b/i,
  /^new:/i,
  /^now (?:we|uses?|returns?|handles?|supports?|calls?|works?)\b/i,
  /^this used to\b/i,
  /^this was (?:causing|broken|failing|wrong|buggy|a bug|the bug|slow|missing|returning|throwing|crashing|(?:added|changed|removed|moved|renamed|replaced|refactored|fixed|updated)\b)/i,
  /^previously\b/i,
  /^no longer (?:needed|used|required|necessary|works?)\b/i,
  /^as requested\b/i,
  /^per (?:your |the |user |pr |code )?(?:request|review|feedback)\b/i,
  /^(?:fix|bugfix|hotfix)(?::|\s+for\b)/i,
  /^(?:was|old):/i
];
var SHORT_NARRATION = /^(?:added|updated|fixed|changed|removed|refactored|new|now)(?=[\s:]|$)/i;
var isShortNarration = (text) => SHORT_NARRATION.test(text) && text.split(/\s+/).length <= 4;
var MARKER = /\b(?:TODO|FIXME|HACK)\b(\([^)\s]+\))?/;
var DIVIDER = /([=\-*#/])\1{3,}/;
function commentRule(id, message, matches) {
  return (input) => addedCommentLines(input).filter(({ text }) => matches(text)).map(({ line }) => ({ id, action: "fix", file: input.file, line, message }));
}
var c01 = commentRule(
  "OLDMAN-C01",
  "Move change notes to the commit message; a comment should say why the code is as it is.",
  (text) => NARRATION.some((pattern) => pattern.test(text)) || isShortNarration(text)
);
var c04 = commentRule(
  "OLDMAN-C04",
  "Link the TODO to an issue or owner, as in TODO(#123) or TODO(name), or remove it.",
  (text) => {
    const marker = MARKER.exec(text);
    return marker !== null && marker[1] === void 0;
  }
);
var c05 = commentRule(
  "OLDMAN-C05",
  "Remove the divider comment; group code with functions, modules or files instead.",
  (text) => DIVIDER.test(text)
);

// src/lib/code-mask.ts
function maskJs(source, file = "", { keepComments = false } = {}) {
  let masked = "";
  let position = 0;
  for (const span of scanJs(source, file)) {
    if (keepComments && span.kind.endsWith("comment")) continue;
    masked += source.slice(position, span.start) + source.slice(span.start, span.end).replace(/[^\n]/g, " ");
    position = span.end;
  }
  return masked + source.slice(position);
}

// src/rules/quality.ts
var TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/i;
var ANY = [/:\s*any\b/, /\bas\s+any\b/, /<\s*any\s*>/, /[<,]\s*any\s*[,>]/];
var CONSOLE = /\bconsole\s*\.\s*(?:log|debug)\s*\(/;
var DEBUGGER = /(?<![.\w$])debugger(?=\s*(?:;|$))/;
var EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
var CLI_FOLDER = /(?:^|\/)(?:scripts|bin|cli)\//i;
var TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
function lineRule(id, message, appliesTo, matches) {
  return (input) => {
    if (!supportsComments(input.file) || !appliesTo(input.file)) return [];
    const code = maskJs(input.content, input.file).split("\n");
    return input.addedLines.filter(({ line }) => matches(code[line - 1] ?? "")).map(({ line }) => ({ id, action: "fix", file: input.file, line, message }));
  };
}
var q01 = lineRule(
  "OLDMAN-Q01",
  "Replace any with a real type, or with unknown and a type guard.",
  (file) => TYPESCRIPT.test(file),
  (code) => ANY.some((pattern) => pattern.test(code))
);
var q02 = lineRule(
  "OLDMAN-Q02",
  "Remove the console.log or console.debug, or use the project's logger.",
  (file) => !CLI_FOLDER.test(normalizePath(file)) && !TEST_FILE.test(normalizePath(file)),
  (code) => CONSOLE.test(code)
);
var q04 = lineRule(
  "OLDMAN-Q04",
  "Remove the debugger statement.",
  () => true,
  (code) => DEBUGGER.test(code)
);
var q03 = (input) => {
  if (!supportsComments(input.file)) return [];
  const code = maskJs(input.content, input.file);
  const withComments = maskJs(input.content, input.file, { keepComments: true });
  const added = new Set(input.addedLines.map(({ line }) => line));
  return [...code.matchAll(EMPTY_CATCH)].flatMap((match) => {
    const block = withComments.slice(match.index, match.index + match[0].length);
    if (!/\{\s*\}$/.test(block)) return [];
    const line = code.slice(0, match.index).split("\n").length;
    const lastLine = line + match[0].split("\n").length - 1;
    const touched = Array.from({ length: lastLine - line + 1 }, (_, i) => line + i).some(
      (l) => added.has(l)
    );
    if (!touched) return [];
    return [
      {
        id: "OLDMAN-Q03",
        action: "fix",
        file: input.file,
        line,
        message: "Handle or rethrow the error in this catch block, or add a comment saying why it is safe to ignore."
      }
    ];
  });
};

// src/rules/check.ts
var CHECK_TYPES = ["comments", "quality"];
var RULES = [c01, c02, c03, c04, c05, c06, q01, q02, q03, q04];
function checkType(finding) {
  return finding.id.startsWith("OLDMAN-Q") ? "quality" : "comments";
}
function runChecks(input, disabled = []) {
  return RULES.flatMap((rule) => rule(input)).filter((finding) => !disabled.includes(finding.id)).sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

// src/entries/check-file.ts
var MAX_LISTED = 20;
function list(findings) {
  const more = findings.length - MAX_LISTED;
  return formatFindings(findings.slice(0, MAX_LISTED)) + (more > 0 ? `
...and ${String(more)} more.` : "");
}
runHook(() => {
  const input = readToolHookInput();
  if (input === void 0 || input.tool_name !== "Write" && input.tool_name !== "Edit") {
    return failOpen("invalid hook input");
  }
  const { session_id: session, tool_input: toolInput } = input;
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const file = toProjectRelative(toolInput.file_path, root);
  recordTouchedFile(root, session, file);
  const { config } = loadConfig(root);
  if (isPaused(root) || isIgnored(toolInput.file_path, root, config.ignorePaths)) return pass();
  const content = input.tool_name === "Write" ? input.tool_input.content : readFileSync4(toolInput.file_path, "utf8");
  const addedLines = input.tool_name === "Write" ? addedLinesForWrite(toolInput.file_path, content) : addedLinesForEdit(input.tool_input, content);
  const findings = runChecks({ file, content, addedLines }, config.disable);
  const warnings = findings.filter((finding) => finding.action === "warn");
  const blocking = [];
  const capped = [];
  for (const type of CHECK_TYPES) {
    const fixes = findings.filter((f) => f.action === "fix" && checkType(f) === type);
    if (fixes.length === 0) continue;
    if (getRounds(root, session, type) < config.maxFeedbackRounds) {
      blocking.push(...fixes);
      addRound(root, session, type);
    } else {
      capped.push(...fixes);
    }
  }
  recordCappedFindings(root, session, file, formatFindings(capped).split("\n").filter(Boolean));
  const context = warnings.length > 0 ? list(warnings) : void 0;
  if (blocking.length > 0) return fix("PostToolUse", list(blocking), context);
  return context === void 0 ? pass() : warn("PostToolUse", context);
});
