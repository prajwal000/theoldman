import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as me } from '../../src/app/api/users/me/route';
import { call, createUser, resetDatabase } from './support';

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let root: string;
let uploads: string;
let previousDir: string | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hidden-avatars-'));
  // Not created here: the app must create its upload folder.
  uploads = join(root, 'uploads');
  previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploads;
});
afterAll(() => {
  if (previousDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousDir;
  rmSync(root, { recursive: true, force: true });
});
beforeEach(resetDatabase);

// Imported when a test runs, after UPLOAD_DIR is set and so that on the starter, where the route
// does not exist, each test fails on its own.
async function upload(
  token: string | undefined,
  file: { bytes: Buffer; name?: string; type?: string } | null,
): Promise<Response> {
  const { POST } = await import('../../src/app/api/users/me/avatar/route');
  const form = new FormData();
  if (file !== null) {
    const blob = new File([new Uint8Array(file.bytes)], file.name ?? 'me.png', {
      type: file.type ?? 'image/png',
    });
    form.append('file', blob);
  } else {
    form.append('note', 'no file here');
  }
  return POST(
    call('/api/users/me/avatar', { body: form, ...(token === undefined ? {} : { token }) }),
  );
}

async function currentAvatar(token: string): Promise<unknown> {
  const body = (await (await me(call('/api/users/me', { token }))).json()) as {
    user: { avatarUrl?: unknown };
  };
  return body.user.avatarUrl;
}

const stored = (): string[] =>
  existsSync(uploads) ? readdirSync(uploads, { recursive: true }).map(String) : [];

describe('avatar upload', () => {
  it('stores a PNG and shows its URL on the user', async () => {
    const { token } = await createUser();
    expect(await currentAvatar(token)).toBeNull();

    const response = await upload(token, { bytes: PNG });
    expect(response.status).toBe(200);
    const { avatarUrl } = (await response.json()) as { avatarUrl: string };
    expect(avatarUrl).toMatch(/^\/uploads\/.+/);
    const relative = avatarUrl.slice('/uploads/'.length);
    expect(relative).not.toContain('..');
    expect(readFileSync(join(uploads, relative))).toEqual(PNG);
    expect(await currentAvatar(token)).toBe(avatarUrl);
  });

  it('rejects a file that only claims to be an image', async () => {
    const { token } = await createUser();
    const before = stored();
    const fake = Buffer.from('<?php system($_GET["c"]); ?>\n');
    expect((await upload(token, { bytes: fake, name: 'shell.png' })).status).toBe(400);
    expect(stored()).toEqual(before);
    expect(await currentAvatar(token)).toBeNull();
  });

  it('rejects an image over 2 MB with a 413', async () => {
    const { token } = await createUser();
    const before = stored();
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload(token, { bytes: big })).status).toBe(413);
    expect(stored()).toEqual(before);
  });

  it('never uses the file name the client sent', async () => {
    const { token } = await createUser();
    const response = await upload(token, { bytes: PNG, name: '../../escape.png' });
    expect(response.status).toBe(200);
    const { avatarUrl } = (await response.json()) as { avatarUrl: string };
    expect(avatarUrl).not.toContain('..');
    expect(avatarUrl).not.toContain('escape');
    expect(existsSync(join(root, 'escape.png'))).toBe(false);
    expect(existsSync(join(root, '..', 'escape.png'))).toBe(false);
  });

  it('needs a signed-in user and a file', async () => {
    const { token } = await createUser();
    expect((await upload(undefined, { bytes: PNG })).status).toBe(401);
    expect((await upload(token, null)).status).toBe(400);
  });
});
