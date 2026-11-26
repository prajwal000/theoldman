// expect: OLDMAN-C01@3, OLDMAN-C01@4, OLDMAN-C01@5, OLDMAN-C01@6, OLDMAN-C01@7, OLDMAN-C01@8, OLDMAN-C01@9
// expect: OLDMAN-C01@10, OLDMAN-C01@12, OLDMAN-C01@13, OLDMAN-C01@14, OLDMAN-C01@15, OLDMAN-C01@16, OLDMAN-C01@17, OLDMAN-C01@18
// Added retry logic for flaky requests
// Updated to use the v2 endpoint
// Fixed the off-by-one error in pagination
// New: cache the parsed config
// Changed from a for loop to map
// Now we validate the input first
// This was causing a crash on empty input
// Previously this returned null
export function load(input: string): string[] {
  /* Refactored for readability */
  const parts = input.split(','); // Fixed: handle empty strings
  // As requested, trim every part
  // Replaced lodash with native methods
  // Moved from utils.ts
  // No longer needed after the migration, kept for one release
  /** Updated per review comments */
  return parts.map((p) => p.trim());
}
