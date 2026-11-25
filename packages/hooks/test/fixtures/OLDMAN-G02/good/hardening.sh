# --no-ver and --no-v also match --no-verbose, so git rejects them as ambiguous.
git commit --no-ver -m x
git push --no-v
git commit --mess "skip --no-verify"
git commit --verify -m x
