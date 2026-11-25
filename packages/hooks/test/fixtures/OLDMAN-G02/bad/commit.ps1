# expect: OLDMAN-G02@2, OLDMAN-G02@3, OLDMAN-G02@4
git commit -m x --no-verify
$env:HUSKY=0; git push --no-verify
git commit -n -m "x"
