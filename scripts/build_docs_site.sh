#!/usr/bin/env bash
# Assemble user + developer doc sites into one static tree (GitHub Pages layout).
#   /                 ← docs-refreshed/
#   /developer/       ← repo-docs-refreshed/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: build_docs_site.sh <output-dir>}"

rm -rf "$OUT"
mkdir -p "$OUT/developer"

cp -R "$ROOT/docs-refreshed/." "$OUT/"
cp -R "$ROOT/repo-docs-refreshed/." "$OUT/developer/"

# Repo-root markdown linked from developer pages (e.g. DEPLOY.md on GitHub Pages).
for md in DEPLOY.md; do
  if [[ -f "$ROOT/$md" ]]; then
    cp "$ROOT/$md" "$OUT/$md"
  fi
done

# Ensure logo SVG is present at both site roots (user + developer).
LOGO="$ROOT/docs-refreshed/assets/cellseer.svg"
if [[ -f "$LOGO" ]]; then
  mkdir -p "$OUT/assets" "$OUT/developer/assets"
  cp "$LOGO" "$OUT/assets/cellseer.svg"
  cp "$LOGO" "$OUT/developer/assets/cellseer.svg"
fi

find "$OUT" -name '.DS_Store' -delete

# Bust browser cache for stylesheets after rebuild (preview + local serve).
CACHE_TAG="$(date +%s)"
while IFS= read -r -d '' f; do
  # Portable in-place edit (BSD `sed -i ''` and GNU `sed -i` disagree on the
  # backup-suffix arg, so avoid -i entirely and rewrite via a temp file).
  tmp="$(mktemp)"
  sed \
    -e "s|href=\"assets/docs.css\"|href=\"assets/docs.css?v=${CACHE_TAG}\"|g" \
    -e "s|href=\"styles.css\"|href=\"styles.css?v=${CACHE_TAG}\"|g" \
    -e "s|href=\"../styles.css\"|href=\"../styles.css?v=${CACHE_TAG}\"|g" \
    "$f" > "$tmp" && mv "$tmp" "$f"
done < <(find "$OUT" -name '*.html' -print0)

# Prevent Jekyll from stripping paths GitHub Pages might otherwise ignore.
touch "$OUT/.nojekyll"

echo "Built combined docs site at $OUT"
