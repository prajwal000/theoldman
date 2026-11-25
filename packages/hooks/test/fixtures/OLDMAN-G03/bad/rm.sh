# Project root and working directory are C:\repo; home is C:\Users\me.
# expect: OLDMAN-G03@4, OLDMAN-G03@5, OLDMAN-G03@6, OLDMAN-G03@7, OLDMAN-G03@8, OLDMAN-G03@9, OLDMAN-G03@10
# expect: OLDMAN-G03@11, OLDMAN-G03@12, OLDMAN-G03@13, OLDMAN-G03@14, OLDMAN-G03@15, OLDMAN-G03@16, OLDMAN-G03@17
rm -rf /
rm -rf ~
rm -fr ../other
cd /tmp && rm -rf /etc
rm -rf /c/Windows
rm -rf C:/Users
rm -Rf /*
rm -r -f "$HOME"
rm --recursive --force /var/lib/data
sudo rm -rf /opt/app
rm -rf .
rm -rf node_modules /etc
rm -rf -- /
rm -rf ~/projects/other
