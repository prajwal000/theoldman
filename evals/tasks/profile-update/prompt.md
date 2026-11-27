Let users edit their profile with `PATCH /api/users/me`.

- They can change their `name` and their `email`, with the same rules as at signup (a 400 otherwise). Other fields in the body, such as `role`, must not change anything.
- Changing the email also needs the current password, in `currentPassword`: a missing or wrong password gets a 403. An email that another account already uses gets a 409.
- Answer 200 with the updated user, in the same shape as `GET /api/users/me`. Signed-out requests get a 401.
