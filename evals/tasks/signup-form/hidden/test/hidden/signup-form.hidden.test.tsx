// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VALID = {
  Name: 'Ada Lovelace',
  Email: 'ada@example.com',
  Password: 'analytical engine',
  'Confirm password': 'analytical engine',
};

// Imported when a test runs, so on the starter, where the component does not exist, each test
// fails on its own. The path is a variable because in a jsdom test Vite resolves a literal one
// when it transforms this file, and a missing module would stop the whole file from loading.
const COMPONENT = '../../src/components/SignupForm';

async function renderForm() {
  const { default: SignupForm } = (await import(/* @vite-ignore */ COMPONENT)) as {
    default: (props: { onSignedUp: (result: unknown) => void }) => React.JSX.Element;
  };
  const onSignedUp = vi.fn();
  render(<SignupForm onSignedUp={onSignedUp} />);
  return { onSignedUp, user: userEvent.setup() };
}

async function submit(user: ReturnType<typeof userEvent.setup>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    if (value !== '') await user.type(screen.getByLabelText(label), value);
  }
  await user.click(screen.getByRole('button', { name: 'Sign up' }));
}

function expectInvalid(label: string): void {
  const field = screen.getByLabelText(label);
  expect(field.getAttribute('aria-invalid')).toBe('true');
  const ids = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const message = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  expect(message.trim()).not.toBe('');
}

function expectValid(label: string): void {
  expect(screen.getByLabelText(label).getAttribute('aria-invalid')).not.toBe('true');
}

/** The URL, method and JSON body of the first fetch call, whatever form it took. */
async function firstRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
  if (input instanceof Request) {
    return { url: input.url, method: input.method, body: (await input.json()) as unknown };
  }
  return {
    url: String(input),
    method: (init?.method ?? 'GET').toUpperCase(),
    body: JSON.parse(String(init?.body)) as unknown,
  };
}

describe('SignupForm', () => {
  it('flags the empty required fields and sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { user } = await renderForm();
    await submit(user, {});
    expectInvalid('Name');
    expectInvalid('Email');
    expectInvalid('Password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the email, the password length and the confirmation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { user } = await renderForm();
    await submit(user, {
      Name: 'Ada',
      Email: 'ada-at-example.com',
      Password: 'short',
      'Confirm password': 'different',
    });
    expectValid('Name');
    expectInvalid('Email');
    expectInvalid('Password');
    expectInvalid('Confirm password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends name, email and password and passes the response on', async () => {
    const result = { token: 'tok', user: { id: 'u1', email: VALID.Email, name: VALID.Name } };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { user, onSignedUp } = await renderForm();
    await submit(user, VALID);

    await vi.waitFor(() => {
      expect(onSignedUp).toHaveBeenCalledWith(result);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = await firstRequest(fetchMock);
    expect(request.url).toMatch(/(^|\/)api\/auth\/signup$/);
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({
      name: VALID.Name,
      email: VALID.Email,
      password: VALID.Password,
    });
  });

  it('disables the button while sending, so it is sent once', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { user } = await renderForm();
    await submit(user, VALID);

    const button = screen.getByRole('button', { name: 'Sign up' });
    await vi.waitFor(() => {
      expect(button).toHaveProperty('disabled', true);
    });
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(Response.json({ error: 'stop' }, { status: 500 }));
  });

  it("shows the server's error message", async () => {
    const response = Response.json(
      { error: 'An account with this email already exists' },
      { status: 409 },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const { user, onSignedUp } = await renderForm();
    await submit(user, VALID);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('An account with this email already exists');
    expect(onSignedUp).not.toHaveBeenCalled();
  });
});
