# expect: OLDMAN-G02@2, OLDMAN-G02@3, OLDMAN-G02@4, OLDMAN-G02@5, OLDMAN-G02@6, OLDMAN-G02@7, OLDMAN-G02@8
git commit -m x --no-verify
git push --no-verify
git commit -nm "message"
git commit -n -m x
git commit -am x --no-verify
FOO=1 git push --no-verify origin feature/x
git -c user.name=x commit --no-verify -m y
