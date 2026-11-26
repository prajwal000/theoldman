try {
  run();
} catch (error) {
  report(error);
}
try {
  run();
} catch {
  // The cache file may not exist yet; starting empty is fine.
}
export const label = 'catch {}';
// catch (e) {} in a comment
promise.catch(() => {});
