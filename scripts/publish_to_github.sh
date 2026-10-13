#!/usr/bin/env bash
# One-time publish of this folder to GitHub Pages.
#
#   bash scripts/publish_to_github.sh                # defaults: user giasmith, repo china-dashboard
#   bash scripts/publish_to_github.sh <user> <repo>
#   DRY_RUN=1 bash scripts/publish_to_github.sh      # do everything except creating the repo and pushing
#
# What it does, in order (stops at the first failure):
#   1. installs the two GitHub Actions workflows from setup/github-workflows/ into .github/workflows/
#   2. runs the data validator if Python + jsonschema are available (CI runs it again anyway)
#   3. makes sure no facility coordinates or raw source exports are staged
#   4. creates the first commit (replacing an empty, never-committed .git if one exists)
#   5. creates the public repo and pushes - with the GitHub CLI if you have it, otherwise it tells you
#      exactly what to click and then pushes over HTTPS
set -euo pipefail

USER_NAME="${1:-giasmith}"
REPO="${2:-china-dashboard}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$USER_NAME" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]] || die "'$USER_NAME' is not a valid GitHub username."
[[ "$REPO" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || die "'$REPO' is not a valid repository name."
[[ -f site/index.html && -f scripts/validate_data.py ]] || die "Run this from the china-dashboard folder (site/index.html not found)."
command -v git >/dev/null || die "git is not installed. On macOS run: xcode-select --install"

REMOTE="https://github.com/$USER_NAME/$REPO.git"
SITE="https://$USER_NAME.github.io/$REPO/"

# 1. workflows ---------------------------------------------------------------------------------------------
say "Installing GitHub Actions workflows"
mkdir -p .github/workflows
for f in setup/github-workflows/*.yml; do
  [[ -e "$f" ]] || break
  cp "$f" ".github/workflows/$(basename "$f")"
done
[[ -f .github/workflows/pages.yml && -f .github/workflows/validate.yml ]] || die "workflow files missing (expected setup/github-workflows/*.yml)"
rm -rf setup/github-workflows && rmdir setup 2>/dev/null || true

# repo link in the site footer
if grep -q "repoUrl: null" site/assets/js/config.js; then
  perl -pi -e "s#repoUrl: null,#repoUrl: 'https://github.com/$USER_NAME/$REPO',#" site/assets/js/config.js
fi

# 2. validation --------------------------------------------------------------------------------------------
say "Validating data"
if command -v python3 >/dev/null && python3 -c "import jsonschema" 2>/dev/null; then
  python3 scripts/validate_data.py || die "data validation failed - fix the errors above before publishing"
else
  echo "   (skipped: python3 + jsonschema not available; 'pip3 install -r requirements-dev.txt' enables it. CI validates on every push.)"
fi

# 3/4. commit ----------------------------------------------------------------------------------------------
say "Preparing the git repository"
if [[ -d .git ]] && ! git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  echo "   Found an empty .git with no commits (left by an earlier setup); recreating it."
  rm -rf .git
fi
[[ -d .git ]] || git init -q -b main 2>/dev/null || git init -q
git symbolic-ref -q HEAD >/dev/null && [[ "$(git symbolic-ref --short HEAD)" == "main" ]] || git checkout -q -B main

if [[ -z "$(git config user.email || true)" ]]; then
  # GitHub's no-reply form keeps your personal email out of public commit history.
  git config user.email "$USER_NAME@users.noreply.github.com"
  echo "   Set commit email for this repo to $USER_NAME@users.noreply.github.com"
fi
[[ -n "$(git config user.name || true)" ]] || git config user.name "$USER_NAME"

git add -A
if git diff --cached --name-only | grep -qiE 'datacentermap|edwc_projects|\.xlsx$'; then
  die "a raw source export (DataCenterMap / spreadsheet) is staged - only the province-level site/data files may be published"
fi
if [[ -f site/data/facilities.json ]] && grep -qE '"(lat|lon|latitude|longitude|address|city)"' site/data/facilities.json; then
  die "site/data/facilities.json contains location fields - rebuild with scripts/build_dashboard_data.py --check"
fi
if git diff --cached --name-only | grep -qE '(^|/)\.env($|\.)'; then
  die "a .env file is staged - remove it before publishing"
fi
if git diff --cached --quiet; then
  echo "   Nothing new to commit."
else
  git commit -q -m "Publish China Dashboard: plan tracker, legislation library, EDWC map" \
    -m "Static site in site/, deployed to GitHub Pages by .github/workflows/pages.yml after validation."
  echo "   Committed $(git rev-list --count HEAD) commit(s); $(git ls-files | wc -l | tr -d ' ') files tracked."
fi

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  say "DRY_RUN=1: stopping before creating the repo / pushing"
  exit 0
fi

# 5. create + push -----------------------------------------------------------------------------------------
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  say "Creating public repo $USER_NAME/$REPO with the GitHub CLI"
  gh repo view "$USER_NAME/$REPO" >/dev/null 2>&1 || gh repo create "$USER_NAME/$REPO" --public \
    --description "China five-year plan tracker, digital-economy legislation library and EDWC data-center map"
  say "Pushing"
  git push -u origin main
  say "Turning on GitHub Pages (source: GitHub Actions)"
  gh api -X POST "repos/$USER_NAME/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
    || gh api -X PUT "repos/$USER_NAME/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
    || echo "   Could not set it automatically - do step 3 below by hand."
  gh workflow run pages.yml -R "$USER_NAME/$REPO" >/dev/null 2>&1 || true
else
  say "One manual step: create the empty repository"
  cat <<MSG
   1. Open https://github.com/new
      Owner: $USER_NAME   Repository name: $REPO   Visibility: Public
      Leave "Add a README", .gitignore and licence all UNCHECKED, then click "Create repository".
MSG
  read -r -p "   Press Enter once the repo exists... " _
  say "Pushing (sign in when asked; if you use a token it needs the 'repo' and 'workflow' scopes)"
  git push -u origin main
fi

cat <<MSG

Done with the push. Remaining checks:
   2. Watch the first run:  https://github.com/$USER_NAME/$REPO/actions
   3. If the "deploy" job says Pages is not enabled: Settings -> Pages -> Build and deployment ->
      Source: "GitHub Actions", then Actions -> "Deploy to GitHub Pages" -> "Re-run all jobs".
   4. The site will be at:  $SITE
MSG
