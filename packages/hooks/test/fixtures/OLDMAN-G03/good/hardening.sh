# Project root and working directory are C:\repo. Script clean = rm -rf dist coverage
cd packages && rm -rf dist
cd .. && cd repo && rm -rf dist
pushd packages && rm -rf dist && popd && rm -rf coverage
cd /c/repo/packages && rm -rf ../dist
npm run clean
bash -c "rm -rf dist"
# A cd the guard cannot follow leaves relative paths unresolved, so they are allowed.
cd "$SOMEWHERE" && rm -rf build
cd - && rm -rf build
