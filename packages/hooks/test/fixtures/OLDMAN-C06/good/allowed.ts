/*
 * Copyright 2026 Example Ltd.
 * SPDX-License-Identifier: MIT
 */
/**
 * Loads the user.
 * @param id - the user ID
 * @returns the user, or undefined when unknown
 */
export function getUser(id: string): User | undefined {
  // eslint-disable-next-line no-console -- audit log required by #88
  console.log(id);
  // See https://example.com/users for the lookup rules
  return users.get(id);
}
