# expect: OLDMAN-G01@2, OLDMAN-G01@3, OLDMAN-G01@4, OLDMAN-G01@5, OLDMAN-G01@6, OLDMAN-G01@7, OLDMAN-G01@8
git push -f origin main
git push --force origin master
$env:FOO=1; git push -f origin main
& git push -f origin main
git.exe push --force-with-lease origin main
if ($true) { git push -f origin main }
& 'C:\Program Files\Git\cmd\git.exe' push -f origin main
