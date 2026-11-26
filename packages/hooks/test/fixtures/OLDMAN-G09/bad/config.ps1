# expect: OLDMAN-G09@2, OLDMAN-G09@3, OLDMAN-G09@4, OLDMAN-G09@5, OLDMAN-G09@6, OLDMAN-G09@7
Set-Content -Path .theoldman.json -Value '{}'
'{"disableAllHooks": true}' | Out-File .claude\settings.local.json
Remove-Item -Recurse -Force .theoldman
Copy-Item new.json C:\proj\.claude\settings.json
Add-Content $env:USERPROFILE\.claude\settings.json 'x'
'{}' > C:\ProgramData\ClaudeCode\managed-settings.json
