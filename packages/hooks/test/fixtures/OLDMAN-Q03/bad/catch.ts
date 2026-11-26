// expect: OLDMAN-Q03@3, OLDMAN-Q03@7, OLDMAN-Q03@12
try {
} catch {}

try {
  run();
} catch (e) {
}

try {
  run();
} catch (error: unknown) {   }
