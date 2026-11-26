// src/entries/prompt-router.ts
import { fileURLToPath } from "node:url";

// src/lib/input.ts
import { readFileSync } from "node:fs";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCommonInput(value) {
  return isRecord(value) && typeof value.session_id === "string" && typeof value.cwd === "string" && typeof value.hook_event_name === "string" && (value.agent_type === void 0 || typeof value.agent_type === "string");
}
function isPromptHookInput(value) {
  return isCommonInput(value) && typeof value.prompt === "string";
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

// src/lib/output.ts
function json(body) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
}
function pass() {
  return { exitCode: 0, stdout: "", stderr: "" };
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
function pickLines(sections, max) {
  const picked = [];
  const longest = Math.max(0, ...sections.map((lines) => lines.length));
  for (let i = 0; i < longest; i += 1) {
    for (const lines of sections) {
      const line = lines[i];
      if (line !== void 0 && picked.length < max) picked.push(line);
    }
  }
  return picked;
}

// src/lib/state.ts
import { existsSync, lstatSync, mkdirSync, readFileSync as readFileSync2, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var PAUSED_FILE = "paused";
function stateDir(projectDir) {
  return join(projectDir, ".theoldman", "state");
}
function isPaused(projectDir) {
  return existsSync(join(stateDir(projectDir), PAUSED_FILE));
}

// src/lib/tell.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join2 } from "node:path";
var TELL_FILE = join2("skills", "oldman-rules", "tell.md");
function readTellSections(pluginRoot) {
  const sections = /* @__PURE__ */ new Map();
  let current;
  for (const line of readFileSync3(join2(pluginRoot, TELL_FILE), "utf8").split(/\r?\n/)) {
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

// src/entries/prompt-router.ts
var MAX_CATEGORIES = 2;
var MAX_LINES = 4;
runHook(() => {
  const input = readHookInput(isPromptHookInput);
  if (input === void 0) return failOpen("invalid hook input");
  if (isPaused(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)) return pass();
  const categories = classify(input.prompt).slice(0, MAX_CATEGORIES);
  if (categories.length === 0) return pass();
  const sections = readTellSections(fileURLToPath(new URL("..", import.meta.url)));
  const lines = pickLines(
    categories.map((category) => sections.get(category) ?? []),
    MAX_LINES
  );
  if (lines.length === 0) return failOpen(`no rules for ${categories.join(", ")} in tell.md`);
  const header = `theoldman rules for this prompt (${categories.join(", ")}):`;
  return warn("UserPromptSubmit", [header, ...lines].join("\n"));
});
