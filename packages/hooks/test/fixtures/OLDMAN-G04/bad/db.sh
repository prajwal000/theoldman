# DATABASE_URL in the environment points to db.internal.example (not local).
# expect: OLDMAN-G04@4, OLDMAN-G04@5, OLDMAN-G04@6, OLDMAN-G04@7, OLDMAN-G04@8, OLDMAN-G04@9, OLDMAN-G04@10
# expect: OLDMAN-G04@11, OLDMAN-G04@12, OLDMAN-G04@13
npx prisma migrate reset
DATABASE_URL=postgresql://app@db.example.com:5432/app npx prisma migrate reset --force
pnpm prisma db push --force-reset
psql -c "DROP TABLE users"
psql postgresql://app@db.example.com/app -c "drop table users"
echo "TRUNCATE orders;" | psql
mysql -h db.example.com -e "DROP DATABASE app"
yarn prisma migrate reset
DATABASE_URL=postgresql://localhost/app psql -h db.example.com -c "DROP SCHEMA public CASCADE"
export DATABASE_URL=postgresql://app@db.example.com/app && pnpm exec prisma migrate reset
