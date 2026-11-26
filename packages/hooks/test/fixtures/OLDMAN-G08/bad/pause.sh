# expect: OLDMAN-G08@2, OLDMAN-G08@3, OLDMAN-G08@4, OLDMAN-G08@5, OLDMAN-G08@6, OLDMAN-G08@7, OLDMAN-G08@8, OLDMAN-G08@9, OLDMAN-G08@10
node "/home/me/.claude/plugins/theoldman/scripts/oldman-pause.mjs" off "/home/me/proj"
node plugin/scripts/oldman-pause.mjs on
cd /tmp && node --no-warnings ./oldman-pause.mjs off
./oldman-pause.mjs off
touch .theoldman/state/paused
echo > .theoldman/state/paused
rm -f ./.theoldman/state/paused
bash -c "node scripts/oldman-pause.mjs off"
mkdir -p .theoldman/state && : > /home/me/proj/.theoldman/state/paused
