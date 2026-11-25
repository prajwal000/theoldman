# expect: OLDMAN-G01@3, OLDMAN-G01@4, OLDMAN-G01@5, OLDMAN-G01@6, OLDMAN-G01@7, OLDMAN-G01@8, OLDMAN-G01@9
# The encoded commands are "git push -f origin main" in base64 UTF-16LE.
pwsh -Command "git push -f origin main"
powershell -c 'git push --force origin master'
powershell "git push -f origin main"
pwsh -NoProfile -EncodedCommand ZwBpAHQAIABwAHUAcwBoACAALQBmACAAbwByAGkAZwBpAG4AIABtAGEAaQBuAA==
powershell -ExecutionPolicy Bypass -enc ZwBpAHQAIABwAHUAcwBoACAALQBmACAAbwByAGkAZwBpAG4AIABtAGEAaQBuAA==
git push origin --delete main
npm run ship
