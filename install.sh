#!/usr/bin/env bash
set -euo pipefail

HELIX_VERSION="${HELIX_VERSION:-}"
HELIX_INSTALL_DIR="${HELIX_INSTALL_DIR:-$HOME/.local/bin}"
HELIX_NO_MODIFY_PATH="${HELIX_NO_MODIFY_PATH:-}"
REPO="devxia/helix-cli"
PATH_UPDATED_RC=""

log() { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
Usage:
  curl -fsSL https://raw.githubusercontent.com/devxia/helix-cli/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/devxia/helix-cli/main/install.sh | bash -s -- --version 0.2.1

Options:
  --version VERSION    Install a specific stable Helix version
  -h, --help           Show this help

Environment:
  HELIX_VERSION         Explicit version; defaults to latest stable release
  HELIX_INSTALL_DIR     Installation directory; default $HOME/.local/bin
  HELIX_NO_MODIFY_PATH  Skip shell PATH modification
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --version)
        [ -n "${2:-}" ] || fail "--version requires a value"
        HELIX_VERSION="$2"
        shift 2
        ;;
      --version=*) HELIX_VERSION="${1#--version=}"; shift ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
}

detect_target() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) fail "Windows is not supported by install.sh" ;;
    *) fail "unsupported OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
  if [ "$os" = "linux" ] && { [ -f /lib/libc.musl-x86_64.so.1 ] || [ -f /lib/libc.musl-aarch64.so.1 ] || ldd /bin/ls 2>&1 | grep -q musl; }; then
    fail "musl Linux is not supported by the current Helix release"
  fi
  printf '%s-%s' "$os" "$arch"
}

download() {
  local url="$1" destination="${2:-}"
  if have curl; then
    if [ -n "$destination" ]; then
      curl --fail --location --progress-bar -o "$destination" "$url"
    else
      curl --fail --location --silent "$url"
    fi
  elif have wget; then
    if [ -n "$destination" ]; then
      wget -q -O "$destination" "$url"
    else
      wget -q -O - "$url"
    fi
  else
    fail "curl or wget is required"
  fi
}

sha256() {
  if have shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif have sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "shasum or sha256sum is required"
  fi
}

checksum_for() {
  local checksums="$1" name="$2"
  local checksum file
  while read -r checksum file; do
    case "$file" in *[!A-Za-z0-9._-]*|*..*) fail "unsafe asset name in checksums.txt: $file" ;; esac
    if [ ${#checksum} -ne 64 ]; then fail "invalid checksum entry for $file"; fi
    case "$checksum" in *[!a-f0-9]*) fail "invalid checksum entry for $file" ;; esac
    [ "$file" = "$name" ] && { printf '%s' "$checksum"; return 0; }
  done <<< "$checksums"
  fail "checksums.txt does not contain $name"
}

shell_rc() {
  local name
  name="$(basename "${SHELL:-/bin/bash}")"
  case "$name" in
    zsh) printf '%s' "$HOME/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then printf '%s' "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then printf '%s' "$HOME/.bash_profile"
      elif [ -f "$HOME/.profile" ]; then printf '%s' "$HOME/.profile"
      else printf '%s' "$HOME/.bashrc"; fi
      ;;
    fish) printf '%s' "$HOME/.config/fish/config.fish" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

update_path() {
  [ -z "$HELIX_NO_MODIFY_PATH" ] || { log "Skipping PATH update"; return 0; }
  case ":$PATH:" in
    *":$HELIX_INSTALL_DIR:"*) log "$HELIX_INSTALL_DIR is already in PATH"; return 0 ;;
  esac
  local rc line
  rc="$(shell_rc)"
  mkdir -p "$(dirname "$rc")"
  case "$rc" in
    *fish*) line="fish_add_path -g \"$HELIX_INSTALL_DIR\"" ;;
    *) line="export PATH=\"$HELIX_INSTALL_DIR:\$PATH\"" ;;
  esac
  if ! grep -qsF "$HELIX_INSTALL_DIR" "$rc" 2>/dev/null; then
    printf '\n# Helix CLI\n%s\n' "$line" >> "$rc"
    PATH_UPDATED_RC="$rc"
    log "Added $HELIX_INSTALL_DIR to PATH in $rc"
  else
    log "$HELIX_INSTALL_DIR is already configured in $rc"
  fi
}

HELIX_TMP=""
cleanup() { [ -z "$HELIX_TMP" ] || rm -rf "$HELIX_TMP"; }
trap cleanup EXIT

main() {
  local target version tag asset checksum_asset asset_url checksum_url expected actual rc
  parse_args "$@"
  target="$(detect_target)"
  asset="helix-$target"

  if [ -n "$HELIX_VERSION" ]; then
    version="${HELIX_VERSION#v}"
    case "$version" in
      *[![:digit:].]*|*.*.*.*|..*|*..*) fail "version must be stable x.y.z" ;;
      *.*.*) ;;
      *) fail "version must be stable x.y.z" ;;
    esac
    tag="v$version"
  else
    log "Resolving latest stable Helix release"
    release_json="$(download "https://api.github.com/repos/$REPO/releases/latest")" || fail "could not resolve latest release"
    tag="$(printf '%s' "$release_json" | tr -d '\n\r\t' | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v\{0,1\}[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p')"
    [ -n "$tag" ] || fail "latest release does not expose a stable tag"
    version="${tag#v}"
  fi
  log "Installing Helix $version for $target"

  HELIX_TMP="$(mktemp -d 2>/dev/null || mktemp -d -t helix-install)"
  checksum_url="https://github.com/$REPO/releases/download/$tag/checksums.txt"
  asset_url="https://github.com/$REPO/releases/download/$tag/$asset"
  log "Downloading $asset"
  checksums="$(download "$checksum_url")" || fail "could not download checksums.txt"
  expected="$(checksum_for "$checksums" "$asset")"
  download "$asset_url" "$HELIX_TMP/$asset"
  actual="$(sha256 "$HELIX_TMP/$asset")"
  [ "$actual" = "$expected" ] || fail "checksum mismatch: expected $expected, got $actual"

  chmod 0755 "$HELIX_TMP/$asset"
  installed_version="$($HELIX_TMP/$asset --version)"
  [ "$installed_version" = "helix $version" ] || fail "downloaded binary reported '$installed_version'"

  mkdir -p "$HELIX_INSTALL_DIR"
  install -m 0755 "$HELIX_TMP/$asset" "$HELIX_INSTALL_DIR/helix"
  log "Installed $HELIX_INSTALL_DIR/helix"
  update_path
  log "Done. Run: helix --version"
  if [ -n "$PATH_UPDATED_RC" ]; then
    log "Restart your shell or run: source $PATH_UPDATED_RC"
  fi
}

main "$@"
