// expect: OLDMAN-C06@2
// Load the config file from disk.
// Parse it as JSON.
// Validate the shape.
export function loadConfig(path: string): Config {
  // Read the raw text.
  const text = readFileSync(path, 'utf8');
  // Parse the JSON.
  return parse(text);
}
