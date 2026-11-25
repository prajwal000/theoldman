# Project root and working directory are C:\repo; home is C:\Users\me. Script nuke = rm -rf ../shared
# expect: OLDMAN-G03@4, OLDMAN-G03@5, OLDMAN-G03@6, OLDMAN-G03@7, OLDMAN-G03@8, OLDMAN-G03@9, OLDMAN-G03@10, OLDMAN-G03@11
# expect: OLDMAN-G03@12, OLDMAN-G03@13
cd .. && rm -rf other
cd /tmp && rm -rf build
pushd /var && rm -rf log
cd packages && rm -rf ../../other
bash -c "rm -rf /"
sudo -E bash -c 'rm -rf ~'
npm run nuke
cd ~ && rm -rf projects
cd && rm -rf projects
cd packages; cd ..; cd ..; rm -rf repo2
