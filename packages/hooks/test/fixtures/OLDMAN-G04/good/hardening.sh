# DATABASE_URL in the environment is remote. Scripts: db:reset:local sets a local URL; chain1 ->
# chain2 -> chain3 -> db:reset is three script-to-script calls deep, past the two followed.
npm run db:reset:local
DATABASE_URL=postgresql://localhost/app npm run db:reset
DATABASE_URL=postgresql://localhost/app bash -c "npx prisma migrate reset"
npm run chain1
npm test
npm run self
pnpm install
yarn add prisma
