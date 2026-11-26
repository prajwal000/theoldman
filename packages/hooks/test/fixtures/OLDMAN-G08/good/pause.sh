echo "run node oldman-pause.mjs off to pause"
cat plugin/scripts/oldman-pause.mjs
node scripts/pause.mjs off
node scripts/oldman-pause.mjs.bak off
ls .theoldman/state
cat .theoldman/state/paused.bak
grep -r paused .theoldman/state/s1/review.json
git commit -m "touch .theoldman/state/paused in tests"
