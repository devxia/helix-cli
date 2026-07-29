#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <x.y.z>" >&2
  exit 2
fi

VERSION="${1#v}"
TAG="v$VERSION"
ROOT="$(git rev-parse --show-toplevel)"
DIST="$ROOT/release/dist/$TAG"

fail() { echo "error: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version must be stable x.y.z"
have bun || fail "bun is required"
have gh || fail "GitHub CLI gh is required"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated"

PACKAGE_VERSION="$(bun -e 'const p = await Bun.file(process.argv[1]).json(); console.log(p.version);' "$ROOT/package.json")"
CLI_VERSION="$(sed -n 's/^export const HELIX_VERSION = "\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)";$/\1/p' "$ROOT/src/paths.ts")"
[ "$PACKAGE_VERSION" = "$VERSION" ] || fail "package.json version is $PACKAGE_VERSION, expected $VERSION"
[ "$CLI_VERSION" = "$VERSION" ] || fail "src/paths.ts HELIX_VERSION is $CLI_VERSION, expected $VERSION"
[ -z "$(git status --porcelain)" ] || fail "working tree must be clean before release"
[ "$(git branch --show-current)" = "main" ] || fail "release must be created from main"

git fetch origin main --tags
LOCAL_MAIN="$(git rev-parse main)"
REMOTE_MAIN="$(git rev-parse origin/main)"
[ "$LOCAL_MAIN" = "$REMOTE_MAIN" ] || fail "main must be synchronized with origin/main"
! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag $TAG already exists locally"
! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 || fail "tag $TAG already exists on origin"

rm -rf "$DIST"
mkdir -p "$DIST"

TARGETS=(darwin-arm64 darwin-x64 linux-arm64 linux-x64)
for target in "${TARGETS[@]}"; do
  echo "==> Building helix-$target"
  bun build --compile --target="bun-$target" --outfile "$DIST/helix-$target" "$ROOT/src/main.ts"
  chmod 0755 "$DIST/helix-$target"
done

CURRENT_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
CURRENT_ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
CURRENT_TARGET="$CURRENT_OS-$CURRENT_ARCH"
for target in "${TARGETS[@]}"; do
  if [ "$target" = "$CURRENT_TARGET" ]; then
    reported="$($DIST/helix-$target --version)"
    [ "$reported" = "helix $VERSION" ] || fail "helix-$target reported '$reported'"
  fi
done

(
  cd "$DIST"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 helix-* > checksums.txt
  else
    sha256sum helix-* > checksums.txt
  fi
)

echo "==> Creating and pushing tag $TAG"
git tag "$TAG"
git push origin "$TAG"

echo "==> Creating GitHub Release $TAG"
gh release create "$TAG" \
  --title "Helix $TAG" \
  --notes "Helix $TAG" \
  "$DIST"/helix-* \
  "$DIST/checksums.txt"

echo "==> Published $TAG"
