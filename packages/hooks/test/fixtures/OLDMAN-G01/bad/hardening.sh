# expect: OLDMAN-G01@4, OLDMAN-G01@5, OLDMAN-G01@6, OLDMAN-G01@7, OLDMAN-G01@8, OLDMAN-G01@9, OLDMAN-G01@10, OLDMAN-G01@11, OLDMAN-G01@12, OLDMAN-G01@13
# expect: OLDMAN-G01@14, OLDMAN-G01@15, OLDMAN-G01@16, OLDMAN-G01@17, OLDMAN-G01@18, OLDMAN-G01@19, OLDMAN-G01@20, OLDMAN-G01@21, OLDMAN-G01@22, OLDMAN-G01@23
# package.json scripts: ship = git push -f origin main; predeploy = git push --force origin main
bash -c "git push -f origin main"
sh -c 'cd repo && git push --force origin master'
zsh -lc "git push -f origin main"
bash -o pipefail -c "git push -f origin main"
cmd /c "git push -f origin main"
cmd /c git push -f origin main
git push --delete origin main
git push origin --delete main
git push -d origin master
git push origin :main
git push origin :refs/heads/main
git push --force-w origin main
git push --mir
pnpm exec git push -f origin main
npx git push -f origin main
npm run ship
npm run deploy
yarn ship
pnpm run ship
sudo env GIT_TRACE=1 git push -f origin main
