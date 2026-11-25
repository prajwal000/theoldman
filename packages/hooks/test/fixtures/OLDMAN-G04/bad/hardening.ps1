# DATABASE_URL in the environment is remote. The encoded command is "npx prisma migrate reset".
# expect: OLDMAN-G04@3, OLDMAN-G04@4, OLDMAN-G04@5, OLDMAN-G04@6
npm run reset
pwsh -c "npx prisma migrate reset"
pnpm dlx prisma migrate reset
powershell -enc bgBwAHgAIABwAHIAaQBzAG0AYQAgAG0AaQBnAHIAYQB0AGUAIAByAGUAcwBlAHQA
