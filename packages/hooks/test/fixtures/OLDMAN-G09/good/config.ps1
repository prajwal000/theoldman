Get-Content .theoldman.json
Copy-Item .claude\settings.json $env:TEMP\settings-copy.json
Select-String -Pattern level -Path .theoldman.json
Write-Output "change .claude/settings.json yourself"
Get-ChildItem .theoldman\state
