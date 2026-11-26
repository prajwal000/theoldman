#!/usr/bin/env node
/*
 * Copyright 2026 Example Ltd. ----------
 * SPDX-License-Identifier: MIT
 * Updated yearly.
 */
/// <reference types="node" />
// TODO see https://github.com/example/repo/issues/9
// const legacy = load(); kept for #123
/** Gets the user. */
export function getUser(id: string): User {
  // eslint-disable-next-line no-console -- debug output, remove(after) launch;
  console.log(id);
  // @ts-expect-error: TODO the library types are wrong
  return users.find(id);
}
/** Added in v2. */
export default getUser;
/**
 * ==========
 * Fixed bug
 */
@Injectable()
export class Service {}
