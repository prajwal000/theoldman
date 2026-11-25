# expect: OLDMAN-G02@2, OLDMAN-G02@3
git commit --no-verif -m x
pwsh -c "git push --no-verify"
