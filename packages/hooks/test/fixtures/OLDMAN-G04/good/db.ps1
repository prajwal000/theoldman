# DATABASE_URL in the environment points to db.internal.example (not local).
$env:DATABASE_URL="postgresql://localhost/app"; npx prisma migrate reset
$env:DATABASE_URL = 'postgresql://localhost/app'; npx prisma migrate reset
Write-Output "DROP TABLE users"
npx prisma generate
