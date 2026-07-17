#!/usr/bin/env bash
set -euo pipefail

TARGET_TAG=${1:?Usage: resolve-release-target.sh <release-tag>}
OUTPUT=${GITHUB_OUTPUT:-/dev/stdout}

case "${TARGET_TAG}" in
  cli-v*) PACKAGE_WORKSPACE="@kontourai/cli"; PACKAGE_MANIFEST="cli/package.json"; TAG_PREFIX="cli-v" ;;
  console-core-v*) PACKAGE_WORKSPACE="@kontourai/console-core"; PACKAGE_MANIFEST="console-core/package.json"; TAG_PREFIX="console-core-v" ;;
  console-server-v*) PACKAGE_WORKSPACE="@kontourai/console-server"; PACKAGE_MANIFEST="console-server/package.json"; TAG_PREFIX="console-server-v" ;;
  v*) PACKAGE_WORKSPACE="."; PACKAGE_MANIFEST="package.json"; TAG_PREFIX="v" ;;
  *) echo "Unsupported release tag ${TARGET_TAG}" >&2; exit 1 ;;
esac
export PACKAGE_MANIFEST

if ! printf '%s' "${TARGET_TAG}" | grep -Eq '^(v|cli-v|console-core-v|console-server-v)[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "Target must be a supported immutable release tag, got ${TARGET_TAG}" >&2
  exit 1
fi

# The full refspec deliberately excludes branches and other namespaces.
git fetch --no-tags origin "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}"
git show-ref --verify --quiet "refs/tags/${TARGET_TAG}"
TARGET_SHA=$(git rev-parse "refs/tags/${TARGET_TAG}^{commit}")
git checkout --detach "${TARGET_SHA}"

PACKAGE_VERSION=$(node -p "JSON.parse(require('node:fs').readFileSync(process.env.PACKAGE_MANIFEST, 'utf8')).version")
if [ "${TAG_PREFIX}${PACKAGE_VERSION}" != "${TARGET_TAG}" ]; then
  echo "Tag ${TARGET_TAG} does not match ${PACKAGE_MANIFEST} version ${TAG_PREFIX}${PACKAGE_VERSION}" >&2
  exit 1
fi

git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
if ! git merge-base --is-ancestor "${TARGET_SHA}" refs/remotes/origin/main; then
  echo "Tagged commit ${TARGET_SHA} is not reachable from the fetched origin/main tip" >&2
  exit 1
fi

echo "target_sha=${TARGET_SHA}" >> "${OUTPUT}"
echo "workspace=${PACKAGE_WORKSPACE}" >> "${OUTPUT}"
echo "manifest=${PACKAGE_MANIFEST}" >> "${OUTPUT}"
echo "tag_prefix=${TAG_PREFIX}" >> "${OUTPUT}"
