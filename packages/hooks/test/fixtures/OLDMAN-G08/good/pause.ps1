Write-Output "oldman-pause.mjs off"
Get-Content plugin\scripts\oldman-pause.mjs
Get-ChildItem .theoldman\state
Select-String -Pattern paused -Path .theoldman\state\s1\review.json
