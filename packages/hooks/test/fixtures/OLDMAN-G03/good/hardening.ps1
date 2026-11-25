# Project root and working directory are C:\repo.
Set-Location packages; Remove-Item -Recurse -Force dist
Push-Location src; Remove-Item -Recurse -Force out; Pop-Location
pwsh -c "Remove-Item -Recurse -Force .\dist"
Set-Location -LiteralPath C:\repo\web; Remove-Item -Recurse -Force build
