# expect: OLDMAN-G09@2, OLDMAN-G09@3, OLDMAN-G09@4, OLDMAN-G09@5, OLDMAN-G09@6, OLDMAN-G09@7, OLDMAN-G09@8, OLDMAN-G09@9, OLDMAN-G09@10, OLDMAN-G09@11, OLDMAN-G09@12
echo '{"level": "quick"}' > .theoldman.json
rm .theoldman.json
sed -i 's/standard/quick/' ./.theoldman.json
cp /tmp/loose.json .theoldman.json
mv .theoldman.json .theoldman.json.bak
rm -rf .theoldman
echo x >> .theoldman/state/s1/rounds.json
echo '{"disableAllHooks": true}' > .claude/settings.local.json
tee ~/.claude/settings.json < new.json
git checkout -- .theoldman.json
rm -rf ~/.claude/plugins/cache/theoldman
