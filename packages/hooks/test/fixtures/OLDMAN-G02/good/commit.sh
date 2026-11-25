git commit -m "skip --no-verify"
git commit -m x
git commit -m -n
git push -n origin feature/x
echo "git commit --no-verify"
git commit --message --no-verify
git commit -m x -- --no-verify
