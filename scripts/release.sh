#!/usr/bin/env bash
# Tags the current commit with the version in package.json and pushes the tag,
# which triggers the Release workflow. Usage: scripts/release.sh
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

version="$(node -p "require('./src/code-extension/package.json').version")"
tag="v$version"
minor="$(echo "$version" | cut -d. -f2)"
kind="stable version"
if [ $((minor % 2)) -eq 1 ]; then kind="pre-release"; fi

fail() {
  echo "error: $1" >&2
  exit 1
}

[ "$(git branch --show-current)" = "main" ] || fail "releases are tagged from main."
git diff --quiet HEAD -- src/code-extension || fail "src/code-extension has uncommitted changes."

git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main is not in sync with origin/main. Push or pull first."
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  fail "the tag $tag already exists. Bump the version in src/code-extension/package.json."
fi
grep -q "^## $version" src/code-extension/CHANGELOG.md || fail "CHANGELOG.md has no entry for $version."

echo "This will publish $tag to the Marketplace as a $kind."
echo "Commit: $(git log -1 --format='%h %s')"
read -r -p "Continue? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || fail "cancelled."

git tag "$tag"
git push origin "$tag"
echo "Pushed $tag. Follow the run at https://github.com/dmoreano-dev/service-bus-workbench/actions"
