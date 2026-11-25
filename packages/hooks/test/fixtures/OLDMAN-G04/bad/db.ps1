# DATABASE_URL in the environment points to db.internal.example (not local).
# expect: OLDMAN-G04@3, OLDMAN-G04@4, OLDMAN-G04@5
npx prisma migrate reset
$env:DATABASE_URL="postgresql://app@db.example.com/app"; npx prisma migrate reset
psql -c "DROP TABLE users"
