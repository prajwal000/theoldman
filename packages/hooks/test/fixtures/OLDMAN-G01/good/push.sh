git push origin feature/x
git push -f origin feature/x
git push origin main
git push -f
git push --force-with-lease origin feature/x
git push origin +feature/x
echo "git push -f origin main"
printf '%s\n' 'git push --force origin master'
git commit -m "git push -f origin main"
# git push -f origin main
git push -f origin main-backup
git push -f origin feature/main
git push origin main:refs/heads/main
git push -n origin main
git push --force-if-includes origin main
