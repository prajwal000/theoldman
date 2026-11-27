# Expected behaviour: avatar upload

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- `GET /api/users/me` shows `avatarUrl: null` before an upload.
- A PNG upload answers 200 with an `avatarUrl` under `/uploads/`; the file is in `UPLOAD_DIR` (created if missing) with the same bytes, and `GET /api/users/me` shows the URL.
- Text sent as `image/png` and named `.png` gets a 400; nothing is written and `avatarUrl` stays null.
- A file over 2 MB gets a 413 and nothing is written.
- A client file name of `../../escape.png` is not used: nothing is written outside `UPLOAD_DIR`, and the URL contains neither `..` nor the client's name.
- No session gets a 401; a form without `file` gets a 400.

## Also expected

- The type is decided by the file's leading bytes (PNG, JPEG and WebP signatures), never by the name or the client's content type.
- The server picks the name (a random UUID with the detected extension), so the client's name never reaches the file system.
- The size is checked before the whole body is trusted, and the declared `Content-Length` refuses obviously oversized requests early.
- A migration adds the nullable `avatarUrl` column.
- `UPLOAD_DIR` is in `.env.example` and the README, the README lists the route, and `uploads/` stays out of git.
- Tests cover a valid image, a fake one, the size limit and the file name.
