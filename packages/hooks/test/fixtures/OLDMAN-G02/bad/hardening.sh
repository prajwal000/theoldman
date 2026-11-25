# expect: OLDMAN-G02@2, OLDMAN-G02@3, OLDMAN-G02@4, OLDMAN-G02@5, OLDMAN-G02@6, OLDMAN-G02@7
git commit --no-verif -m x
git push --no-verif
git commit --no-veri -m x
bash -c "git commit -n -m x"
pnpm exec git commit --no-verify -m x
git commit --mess "x" --no-verify
