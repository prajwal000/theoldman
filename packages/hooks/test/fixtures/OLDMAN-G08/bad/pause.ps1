# expect: OLDMAN-G08@2, OLDMAN-G08@3, OLDMAN-G08@4, OLDMAN-G08@5, OLDMAN-G08@6, OLDMAN-G08@7
& node "C:\Users\me\.claude\plugins\theoldman\scripts\oldman-pause.mjs" off "C:\proj"
New-Item -ItemType File .theoldman\state\paused
Set-Content -Path .theoldman/state/paused -Value ''
Remove-Item .theoldman\state\paused
'' > .theoldman\state\paused
pwsh -c "node C:\plugin\scripts\oldman-pause.mjs on"
