export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Emails are not delivered yet: no provider is set up. They are kept here instead, so
 * development and tests can read what would have been sent.
 */
export const outbox: Email[] = [];

export function sendEmail(email: Email): Promise<void> {
  outbox.push(email);
  return Promise.resolve();
}
