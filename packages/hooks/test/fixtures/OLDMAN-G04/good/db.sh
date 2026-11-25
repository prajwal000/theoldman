# DATABASE_URL in the environment points to db.internal.example (not local).
DATABASE_URL=postgresql://localhost:5432/app npx prisma migrate reset
DATABASE_URL="postgresql://app@127.0.0.1/app" pnpm prisma db push --force-reset
DATABASE_URL=file:./dev.db npx prisma migrate reset
export DATABASE_URL=postgresql://localhost/app; npx prisma migrate reset
npx prisma migrate dev
npx prisma db push
psql postgresql://localhost/app -c "DROP TABLE users"
psql -h localhost -c "TRUNCATE orders"
psql -c "SELECT count(*) FROM users"
echo "DROP TABLE users"
grep -r "prisma migrate reset" docs
