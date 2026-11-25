import { readHeadVersion } from '../../../src/lib/git.js';
import { runHook, warn } from '../../../src/lib/output.js';

runHook(() =>
  warn('PostToolUse', readHeadVersion(process.argv[2] ?? '') ?? 'no committed version'),
);
