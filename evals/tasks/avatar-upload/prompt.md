Let users upload a profile picture.

- `POST /api/users/me/avatar` takes a multipart form with the image in a `file` field. Accept PNG, JPEG and WebP images up to 2 MB, and check that the file really is one of those, not just its name or content type. Anything else gets a 400; a file over 2 MB gets a 413. Only signed-in users can upload (401 otherwise).
- Store the file on disk in the folder named by the `UPLOAD_DIR` environment variable (default: `uploads` in the project root), under a name the server picks. Save its URL path, `/uploads/<name>`, on the user as `avatarUrl`, and answer `{ "avatarUrl": "..." }`.
- `GET /api/users/me` includes `avatarUrl`, which is null until a picture is uploaded.

Serving the files is out of scope for now.
