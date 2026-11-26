cat .theoldman.json
cp .theoldman.json /tmp/theoldman-backup.json
git add .theoldman.json
git diff -- .theoldman.json
grep -r disableAllHooks .claude/settings.json
sed 's/standard/quick/' .theoldman.json
echo "edit .theoldman.json to change the level"
ls .theoldman/state
cat .claude/settings.local.json
echo '{}' > theoldman.json
echo x > src/.theoldman.json.md
