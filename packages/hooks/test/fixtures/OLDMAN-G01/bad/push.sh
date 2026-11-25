# expect: OLDMAN-G01@3, OLDMAN-G01@4, OLDMAN-G01@5, OLDMAN-G01@6, OLDMAN-G01@7, OLDMAN-G01@8
# expect: OLDMAN-G01@9, OLDMAN-G01@10, OLDMAN-G01@11, OLDMAN-G01@12, OLDMAN-G01@13, OLDMAN-G01@14, OLDMAN-G01@15, OLDMAN-G01@16, OLDMAN-G01@17, OLDMAN-G01@18, OLDMAN-G01@19, OLDMAN-G01@20
git push -f origin main
git push --force-with-lease origin master
git push origin +main
FOO=1 git push -f origin main
git push --force origin HEAD:main
git push -f origin refs/heads/main
cd repo && git push -f origin main
git -C repo push --force origin main
git status; git push -uf origin main
(git push -f origin main)
git push --mirror
git push --all --force origin
/usr/bin/git push -f origin main
git push -f origin main 2>&1
sudo -E git push -f origin main
echo done | git push -f origin main
git push -f origin feature/x main
git push --force-with-lease=main:abc123 origin main
