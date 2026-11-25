import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../build.mjs';
import { findSafetyViolations } from './safety/scan.js';

const pluginScripts = fileURLToPath(new URL('../../../plugin/scripts/', import.meta.url));
const sampleEntries = fileURLToPath(new URL('./bundle/entries/', import.meta.url));

describe('committed bundles in plugin/scripts', () => {
  const bundles = existsSync(pluginScripts)
    ? readdirSync(pluginScripts).filter((name) => name.endsWith('.mjs'))
    : [];

  it.each(bundles.length > 0 ? bundles : ['(none yet)'])('%s is safe', (name) => {
    if (bundles.length === 0) return;
    expect(findSafetyViolations(readFileSync(join(pluginScripts, name), 'utf8'))).toEqual([]);
  });
});

describe('a bundle built from the real lib modules', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'theoldman-bundle-'));
  let code = '';
  beforeAll(async () => {
    expect(await buildHooks({ entriesDir: sampleEntries, outDir })).toEqual(['sample.mjs']);
    code = readFileSync(join(outDir, 'sample.mjs'), 'utf8');
  });
  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('is readable ESM: unminified, with the original names', () => {
    expect(code).toContain('function readHeadVersion(filePath)');
    expect(code).toContain('import { execFileSync } from "node:child_process";');
    expect(code.split('\n').length).toBeGreaterThan(50);
  });

  it('passes the safety scan, including its git call', () => {
    expect(code).toContain('execFileSync("git", [');
    expect(findSafetyViolations(code)).toEqual([]);
  });

  it('runs on its own with Node', () => {
    const stdout = execFileSync(process.execPath, [join(outDir, 'sample.mjs'), join(outDir, 'x')], {
      encoding: 'utf8',
      input: '',
    });
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'no committed version',
      },
    });
  });
});

describe('findSafetyViolations', () => {
  const git = 'import { execFileSync } from "node:child_process";\n';

  it.each([
    ['plain code', 'const a = 1;\nexport { a };'],
    ['the allowed git call', `${git}execFileSync("git", ["cat-file", "blob", spec], { cwd });`],
    ['single quotes', `${git}execFileSync('git', ['status']);`],
    ['a network word outside a git call', 'const denied = new Set(["fetch", "push"]);'],
    ['runGit with a local subcommand', 'runGit(dir, ["cat-file", "blob", spec]);'],
  ])('allows %s', (_name, code) => {
    expect(findSafetyViolations(code)).toEqual([]);
  });

  it.each([
    ['import http', 'import http from "http";', 'imports http'],
    ['import node:https', 'import { request } from "node:https";', 'imports https'],
    ['require http2', 'const h = require("node:http2");', 'imports http2'],
    ['dynamic import net', 'await import("net");', 'imports net'],
    ['side-effect import tls', "import 'tls';", 'imports tls'],
    ['import dgram', 'import * as d from "node:dgram";', 'imports dgram'],
    ['require dns', "require('dns').lookup(h);", 'imports dns'],
    ['import worker_threads', 'import { Worker } from "worker_threads";', 'imports worker_threads'],
    ['fetch', 'await fetch("https://example.com");', 'calls fetch('],
    ['eval', 'eval(source);', 'calls eval('],
    ['new Function', 'const f = new Function("return 1");', 'calls new Function('],
  ])('rejects %s', (_name, code, problem) => {
    expect(findSafetyViolations(code)).toContain(problem);
  });

  const otherChildProcess = 'uses child_process other than `import { execFileSync }`';
  const badExecFileSync = "uses execFileSync other than as execFileSync('git', [...])";

  it.each([
    ...['exec', 'execSync', 'execFile', 'spawn', 'spawnSync', 'fork'].map((fn) => [
      `importing ${fn}`,
      `import { ${fn} } from "node:child_process";\n${fn}("ls");`,
      otherChildProcess,
    ]),
    [
      'importing execFileSync with another function',
      'import { execFileSync, spawn } from "child_process";',
      otherChildProcess,
    ],
    [
      'a namespace import',
      'import * as cp from "node:child_process";\ncp.execFileSync("git", []);',
      otherChildProcess,
    ],
    ['a default import', 'import cp from "child_process";', otherChildProcess],
    [
      'an aliased import',
      'import { execFileSync as run } from "child_process";\nrun("sh", ["-c", "x"]);',
      otherChildProcess,
    ],
    ['require', 'const { execFileSync } = require("child_process");', otherChildProcess],
    ['a dynamic import', 'const cp = await import("node:child_process");', otherChildProcess],
    ['another binary', `${git}execFileSync("node", ["-e", "1"]);`, badExecFileSync],
    ['a binary from a variable', `${git}execFileSync(bin, ["status"]);`, badExecFileSync],
    ['git without an argument array', `${git}execFileSync("git", args);`, badExecFileSync],
    ['git with a command string', `${git}execFileSync("git status");`, badExecFileSync],
    [
      'execFileSync passed as a value',
      `${git}const run = execFileSync;\nrun("sh");`,
      badExecFileSync,
    ],
    [
      'a shell option',
      `${git}execFileSync("git", ["status"], { shell: true });`,
      'sets a shell option',
    ],
    [
      'a quoted shell option',
      `${git}execFileSync("git", ["status"], { "shell": "/bin/sh" });`,
      'sets a shell option',
    ],
    [
      'git push',
      `${git}execFileSync("git", ["push", "origin"]);`,
      'passes a git network subcommand',
    ],
    [
      'git fetch after options',
      `${git}execFileSync("git", ["-c", "a=b", "fetch"]);`,
      'passes a git network subcommand',
    ],
    [
      'runGit with a network subcommand',
      'runGit(cwd, ["ls-remote", url]);',
      'passes a git network subcommand',
    ],
    ['a renamed runGit', 'runGit2(cwd, ["clone", url]);', 'passes a git network subcommand'],
  ])('rejects %s', (_name, code, problem) => {
    expect(findSafetyViolations(code)).toContain(problem);
  });
});
