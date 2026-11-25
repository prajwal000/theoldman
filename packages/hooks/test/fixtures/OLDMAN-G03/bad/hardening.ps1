# Project root and working directory are C:\repo. The encoded command is "Remove-Item -Recurse -Force ~".
# expect: OLDMAN-G03@3, OLDMAN-G03@4, OLDMAN-G03@5, OLDMAN-G03@6, OLDMAN-G03@7, OLDMAN-G03@8, OLDMAN-G03@9
Set-Location ..; Remove-Item -Recurse -Force other
sl C:\temp; Remove-Item -Recurse -Force build
Push-Location D:\; rm -r -fo data
pwsh -c "Remove-Item -Recurse -Force C:\"
powershell -enc UgBlAG0AbwB2AGUALQBJAHQAZQBtACAALQBSAGUAYwB1AHIAcwBlACAALQBGAG8AcgBjAGUAIAB+AA==
cd -Path C:\Users; Remove-Item -Recurse -Force me
Push-Location src; Pop-Location; Set-Location ..; Remove-Item -Recurse -Force x
