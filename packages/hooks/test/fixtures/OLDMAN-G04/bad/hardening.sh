# DATABASE_URL in the environment is remote. Scripts: db:reset = prisma migrate reset --force,
# reset = npm run db:reset, chain2 -> chain3 -> db:reset.
# expect: OLDMAN-G04@5, OLDMAN-G04@6, OLDMAN-G04@7, OLDMAN-G04@8, OLDMAN-G04@9, OLDMAN-G04@10, OLDMAN-G04@11
# expect: OLDMAN-G04@12, OLDMAN-G04@13, OLDMAN-G04@14, OLDMAN-G04@15, OLDMAN-G04@16
npm run reset
npm run db:reset
npm run chain2
yarn db:reset
pnpm db:reset
pnpm dlx prisma migrate reset
bunx prisma migrate reset
npm exec prisma migrate reset
bash -c "psql -c 'DROP TABLE users'"
yarn exec prisma db push --force-reset
npx -y prisma migrate reset
DATABASE_URL=postgresql://localhost/app bash -c "DATABASE_URL=postgresql://db.example.com/app npx prisma migrate reset"
