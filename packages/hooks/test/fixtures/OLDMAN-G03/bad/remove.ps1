# Project root and working directory are C:\repo; home is C:\Users\me.
# expect: OLDMAN-G03@3, OLDMAN-G03@4, OLDMAN-G03@5, OLDMAN-G03@6, OLDMAN-G03@7, OLDMAN-G03@8, OLDMAN-G03@9, OLDMAN-G03@10, OLDMAN-G03@11, OLDMAN-G03@12
Remove-Item -Recurse -Force C:\
Remove-Item C:\Users\other -Recurse -Force
Remove-Item -Recurse -Force ~
Remove-Item -Recurse -Force ..\other
rm -r -fo C:\Windows
ri -Recurse -Force D:\data
Remove-Item -Path C:\Windows\Temp -Recurse -Force
Remove-Item -LiteralPath 'C:\Program Files\App' -Recurse -Force
del -Recurse -Force $env:USERPROFILE
Remove-Item -Recurse -Force -Path:D:\
