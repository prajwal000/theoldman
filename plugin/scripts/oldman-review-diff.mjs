// src/entries/oldman-review-diff.ts
import { fileURLToPath } from "node:url";

// src/lib/diff.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
function defaultBranch(cwd, remote) {
  if (!REMOTE_NAME.test(remote) || remote.includes("..")) return void 0;
  return symbolicRef(cwd, `refs/remotes/${remote}/HEAD`)?.replace(`${remote}/`, "");
}
var COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
function commitOf(cwd, rev) {
  try {
    const hash = runGit(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).trim();
    return COMMIT_HASH.test(hash) ? hash : void 0;
  } catch {
    return void 0;
  }
}
function branchBase(cwd) {
  const head = commitOf(cwd, "HEAD");
  if (head === void 0) return void 0;
  const remoteDefault = defaultBranch(cwd, "origin");
  const candidates = [
    remoteDefault === void 0 ? [] : [`origin/${remoteDefault}`],
    ["origin/main", "origin/master", "main", "master"]
  ].flat();
  for (const branch of candidates) {
    const tip = commitOf(cwd, branch);
    if (tip === void 0) continue;
    let commit;
    try {
      commit = runGit(cwd, ["merge-base", head, tip]).trim();
    } catch {
      continue;
    }
    if (COMMIT_HASH.test(commit)) return { commit, branch };
  }
  return void 0;
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
    const buffer = readFileSync(join(cwd, path));
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
      current = { path, status: "modified", addedLines: [], removedLines: 0 };
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
      if (line.startsWith("-")) current.removedLines += 1;
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

// src/lib/review-scope.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";

// src/lib/router.ts
var KEYWORDS = [
  [
    "auth",
    /\b(auth\w*|log ?ins?|log ?outs?|logged (in|out)|sign ?(ins?|ups?|outs?)|passwords?|sessions?|jwts?|oauth|sso|tokens?|permissions?|roles?|rbac|admins?|cookies?|csrf|2fa|mfa)\b/g
  ],
  [
    "db",
    /\b(databases?|db|sql|postgres\w*|mysql|sqlite|mongo\w*|prisma|drizzle|orm|migrations?|migrate|schemas?|tables?|columns?|index(es)?|indices|quer(y|ies)|seeds?|transactions?|n\+1|backfill)\b/g
  ],
  [
    "api",
    /\b(apis?|endpoints?|routes?|rest|graphql|grpc|controllers?|handlers?|webhooks?|express|fastify|middleware|requests?|responses?|post|get|put|patch|status codes?|rate limit\w*)\b/g
  ],
  [
    "infra",
    /\b(docker\w*|compose|containers?|deploy\w*|ci|pipelines?|kubernetes|k8s|helm|terraform|nginx|aws|s3|gcp|azure|vercel|github actions|workflows?|env vars?|environment variables?|servers?|dns|cdn|monitoring)\b/g
  ],
  [
    "tests",
    /\b(tests?|testing|tested|specs?|vitest|jest|mocha|playwright|cypress|coverage|mocks?|mocking|stubs?|fixtures?|e2e|tdd|assertions?|flaky)\b/g
  ],
  [
    "git",
    /\b(git|commits?|branch(es)?|merge[sd]?|rebase[sd]?|prs?|pull requests?|push|cherry-pick|stash|squash|conflicts?)\b/g
  ],
  [
    "docs",
    /\b(readme|docs?|documentation|document|changelog|adrs?|jsdoc|tsdoc|comments?|env\.example)\b/g
  ],
  [
    "ui",
    /\b(ui|ux|components?|buttons?|pages?|css|styles?|styling|tailwind|layouts?|react|jsx|tsx|modals?|forms?|frontend|a11y|accessibility|responsive|mobile|dark mode|navbar|sidebar|animations?)\b/g
  ]
];
var MAX_PROMPT_CHARS = 1e4;
function classify(prompt) {
  const text = prompt.slice(0, MAX_PROMPT_CHARS).toLowerCase();
  return KEYWORDS.map(([category, pattern]) => ({
    category,
    count: text.match(pattern)?.length ?? 0
  })).filter(({ count }) => count > 0).sort((a, b) => b.count - a.count).map(({ category }) => category);
}

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync as readFileSync2, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/lib/input.ts
function parseJson(raw) {
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return void 0;
  }
}

// src/lib/state.ts
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
function readSessionJson(projectDir, sessionId, name) {
  const file = join2(stateDir(projectDir), sessionSegment(sessionId), name);
  return existsSync(file) ? parseJson(readFileSync2(file, "utf8")) : void 0;
}
function writeSessionFile(projectDir, sessionId, name, text) {
  const file = join2(ensureStateDir(projectDir, sessionSegment(sessionId)), name);
  writeFileSync(file, text);
  return file;
}

// src/lib/review-scope.ts
var CATEGORIES_FILE = "categories.json";
var CATEGORY_NAMES = [
  "auth",
  "db",
  "api",
  "infra",
  "tests",
  "git",
  "docs",
  "ui"
];
var SKILL_FOR = {
  auth: "oldman-security",
  api: "oldman-security",
  infra: "oldman-security",
  db: "oldman-database",
  tests: "oldman-testing",
  docs: "oldman-docs",
  git: void 0,
  ui: void 0
};
var isCategory = (value) => typeof value === "string" && CATEGORY_NAMES.includes(value);
function sessionCategories(projectDir, sessionId) {
  const value = readSessionJson(projectDir, sessionId, CATEGORIES_FILE);
  return Array.isArray(value) ? value.filter(isCategory) : [];
}
function reviewSkills(paths, categories) {
  const fromPaths = classify(paths.join(" ").replace(/[/\\._-]+/g, " "));
  const skills = [...fromPaths, ...categories].map((category) => SKILL_FOR[category]);
  return [...new Set(skills.filter((skill) => skill !== void 0))].sort();
}
function writeReviewRules(pluginRoot, projectDir, sessionId, skills) {
  const bodies = skills.flatMap((skill) => {
    try {
      const text = readFileSync3(join3(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
      return [text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()];
    } catch {
      return [];
    }
  });
  if (bodies.length === 0) return void 0;
  return writeSessionFile(
    projectDir,
    sessionId,
    "review-rules.md",
    `${bodies.join("\n\n---\n\n")}
`
  );
}

// src/entries/oldman-review-diff.ts
runHook(() => {
  const [sessionId = "", projectDir = process.cwd()] = process.argv.slice(2);
  const base = branchBase(projectDir);
  let diff;
  try {
    diff = workingTreeDiff(projectDir, void 0, base?.commit ?? "HEAD");
  } catch {
    return say("This project is not a git repository, so there is no branch diff to review.");
  }
  const against = base === void 0 ? "the last commit" : `${base.branch} (from ${base.commit.slice(0, 7)})`;
  const files = parseDiff(diff).length;
  if (files === 0) return say(`No changes against ${against}, so there is nothing to review.`);
  const path = writeSessionFile(projectDir, sessionId, "diff.patch", diff);
  const changed = parseDiff(diff).map((file) => file.path);
  const skills = reviewSkills(changed, sessionCategories(projectDir, sessionId));
  const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
  const rules = writeReviewRules(pluginRoot, projectDir, sessionId, skills);
  const summary = `Diff of ${String(files)} changed file(s) against ${against} written to ${path}`;
  return say(rules === void 0 ? summary : `${summary}
Topic rules for this change: ${rules}`);
});
