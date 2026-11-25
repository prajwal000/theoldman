# Project root and working directory are C:\repo.
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force .\dist
Remove-Item -Recurse -Force C:\repo\dist
Remove-Item -Recurse -Force c:\REPO\coverage
Remove-Item -Recurse C:\Windows
Remove-Item -Force C:\Windows\Temp\file.txt
Remove-Item -Recurse -Force C:\ -WhatIf
Write-Output "Remove-Item -Recurse -Force C:\"
Remove-Item -Recurse -Force -Filter *.log C:\repo\logs
