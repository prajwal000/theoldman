export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** The request body as JSON, or undefined when it is not valid JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
