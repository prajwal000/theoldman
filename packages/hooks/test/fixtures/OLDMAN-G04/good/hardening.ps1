# DATABASE_URL in the environment is remote.
$env:DATABASE_URL="postgresql://localhost/app"; npm run db:reset
npm run build
