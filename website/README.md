# Edgewatch Bastion Base Documentation Site

This directory contains an isolated Docusaurus site for the `bastion-base` project (formerly `edgewatch-bastion-base`). It is intentionally separate from the GitLab `.deb` build and release pipeline.

## Local development

```bash
npm install
npm run start
```

## Build

```bash
npm run build
npm run serve
```

## Debian APT archive (`/debian/bastion/`)

Before `npm run build` or deploy, `prebuild` runs `scripts/generate-debian-repo.mjs`, which:

1. Fetches the latest `Bastion-base_*_amd64.deb` from [GitHub Releases](https://github.com/edgewatch/bastion/releases) (case-insensitive prefix match — `bastion-base_*` is also accepted).
2. Places it under `static/debian/bastion/pool/main/b/bastion-base/` (Debian pool layout).
3. Writes `dists/trixie/main/binary-amd64/Packages`, `Packages.gz`, and `Release`. The `Packages` `Filename:` lines are repo-relative (`pool/...`) — never absolute paths.
4. Emits Apache-style `index.html` directory listings for each level.
5. Updates `src/data/debian-repo-meta.json` for the downloads page.

Example APT source (on the site home page `/`):

```sourceslist
deb [trusted=yes] https://download.edgewatch.com/debian/bastion trixie main
```

| Variable | Purpose |
| --- | --- |
| `DEBIAN_REPO_SKIP_DOWNLOAD` | Set to `1` to reuse an existing pool `.deb` (no GitHub download) |
| `DEBIAN_REPO_DEB_PATH` | Use a local `.deb` instead of downloading |
| `DEBIAN_REPO_SUITE` | Suite/codename (default: `trixie`) |
| `DOCS_URL` | Site origin for URLs in `Release` and meta (default: `https://download.edgewatch.com`) |

Regenerate only the archive:

```bash
npm run generate:debian-repo
```

## Downloads landing page (`/`)

The home page is a custom React page (`src/pages/index.tsx`) with no global navbar or Docusaurus footer. Installation documentation lives at `/docs/getting-started/install` (linked from the page, not in the navbar). Legacy `/iso` redirects to `/`.

Optional build-time environment variables pin a specific release on the page (overrides generated meta when set):

| Variable | Purpose |
| --- | --- |
| `DOWNLOAD_DEB_VERSION` | Debian package version string embedded in filenames and URLs |
| `DOWNLOAD_DEB_SHA256` | Full SHA256 hex digest shown in the checksum box |
| `DOWNLOAD_DEB_SIZE` | Human-readable size (e.g. `42 MB`) |
| `DOWNLOAD_DEB_DATE` | Publish date (e.g. `2026-05-21`) |
| `DOWNLOAD_GITHUB_TAG` | GitHub release tag (defaults to `DOWNLOAD_DEB_VERSION`) |
| `DOWNLOAD_GITHUB_REPO` | `owner/repo` (default: `edgewatch/bastion`) |
| `DOWNLOAD_LOGO_URL` | Override Edgewatch logo URL |

Example:

```bash
DOWNLOAD_DEB_VERSION='1.0.0+gitabc1234' \
DOWNLOAD_DEB_SHA256='abcdef…' \
DOWNLOAD_DEB_SIZE='38 MB' \
DOWNLOAD_DEB_DATE='2026-05-21' \
npm run build
```

Edit `src/data/downloads.ts` to add product sections or older-version entries.

## Automated GitHub Pages deployment (default)

GitHub Pages (`download.edgewatch.com`) now redeploys automatically so the site
and the static Debian archive always reflect the releases on
[`edgewatch/bastion`](https://github.com/edgewatch/bastion). Flow:

1. A tag is pushed to GitLab → the `.deb` pipeline builds and `publish:github-release`
   creates/updates the GitHub Release with the `.deb` + `.sha256` assets.
2. The GitLab job `mirror:website-github` pushes this `website/` source plus the
   GitHub Actions workflow (`ci/github/deploy-pages.yml` →
   `.github/workflows/deploy-pages.yml`) to `edgewatch/bastion` `main`.
3. The GitHub Actions workflow runs on `release` events (and on `main` pushes that
   touch `website/**`). Its `prebuild` step (`scripts/generate-debian-repo.mjs`)
   reads the GitHub Releases API live, rebuilds the apt repo from **all** published
   releases, builds the site, and deploys `website/build` to the `gh-pages` branch.

Because the build queries the Releases API at run time, Pages reconverges to match
GitHub even for releases created directly on GitHub, and removed releases drop out
of the archive on the next run.

Requirements:

- GitLab CI/CD variable `PUBLIC_GH_TOKEN` must allow pushing to `edgewatch/bastion`
  `main` (contents:write / `repo` scope) — the same variable also creates the
  GitHub Release. A release-only token is not enough for the mirror push.
- No extra GitHub secrets are needed: the workflow uses the built-in
  `GITHUB_TOKEN` to read releases and push to `gh-pages` in the same repo.
- The repo's GitHub Pages source must remain the `gh-pages` branch (with the
  `CNAME` custom domain), which is preserved automatically via `static/CNAME`.

Bootstrap: the workflow must exist on `main` before `release` events can trigger
it. The first `mirror:website-github` run (or a manual GitHub "Run workflow")
seeds `website/` + the workflow; subsequent releases are fully automatic.

## Manual GitHub Pages deployment (fallback)

The manual Docusaurus deploy below remains available as a fallback (for example to
seed the site, or to deploy without a tag).

Before the first `npm run deploy`, the target GitHub repository must already have a `gh-pages` branch. If it does not, initialize it once:

```bash
ORGANIZATION_NAME=<github-user-or-org>
PROJECT_NAME=<github-pages-repo>
DEPLOYMENT_BRANCH=gh-pages
GIT_USER=<github-username>
REMOTE="https://${GIT_USER}@github.com/${ORGANIZATION_NAME}/${PROJECT_NAME}.git"
TMP_DIR="$(mktemp -d)"

git clone --depth 1 "${REMOTE}" "${TMP_DIR}"
cd "${TMP_DIR}"
git checkout --orphan "${DEPLOYMENT_BRANCH}"
git rm -rf . || true
printf '%s\n' "GitHub Pages branch for ${ORGANIZATION_NAME}/${PROJECT_NAME}." > README.md
touch .nojekyll
git add README.md .nojekyll
git commit -m "Initialize GitHub Pages"
git push origin "${DEPLOYMENT_BRANCH}"
cd -
rm -rf "${TMP_DIR}"
```

**Production (custom domain `download.edgewatch.com`)** — site is served at the domain root, so `BASE_URL` must be `/`:

```bash
GIT_USER=<github-username> npm run deploy:production
```

Equivalent manual form:

```bash
ORGANIZATION_NAME=edgewatch \
PROJECT_NAME=bastion \
DOCS_URL=https://download.edgewatch.com \
BASE_URL=/ \
GIT_USER=<github-username> \
npm run deploy
```

`static/CNAME` is copied into the build so `gh-pages` keeps the custom domain. If CSS looks unstyled, you almost certainly deployed with `BASE_URL=/bastion/` while using the custom domain — redeploy with `BASE_URL=/`.

**GitHub project URL only** (`https://edgewatch.github.io/bastion/`, no custom domain):

```bash
ORGANIZATION_NAME=<github-user-or-org> \
PROJECT_NAME=<github-pages-repo> \
DOCS_URL=https://<github-user-or-org>.github.io \
BASE_URL=/<github-pages-repo>/ \
GIT_USER=<github-username> \
npm run deploy
```

`PROJECT_NAME` is the GitHub repository Docusaurus pushes to. `BASE_URL` is the public path where browsers load assets; it must match how Pages actually serves the site (`/` on a custom domain, `/<repo>/` on default project pages).

Organization pages repository:

```bash
ORGANIZATION_NAME=<github-user-or-org> \
PROJECT_NAME=<github-user-or-org>.github.io \
DOCS_URL=https://<github-user-or-org>.github.io \
BASE_URL=/ \
GIT_USER=<github-username> \
npm run deploy
```

For SSH-based deployment, use `REMOTE="git@github.com:${ORGANIZATION_NAME}/${PROJECT_NAME}.git"` when initializing the branch and replace `GIT_USER=...` with `USE_SSH=true` when running `npm run deploy`. Configure GitHub Pages to publish from the `gh-pages` branch unless you use an organization pages repository with a different publishing setup.
