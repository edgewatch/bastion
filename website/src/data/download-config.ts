/**
 * Download page configuration.
 *
 * Set at build time via environment variables (see website/README.md), or run
 * `npm run generate:debian-repo` to refresh `debian-repo-meta.json` from GitHub.
 */

import {
  DEBIAN_REPO_READY,
  debianRepoDebUrl,
  debianRepoMeta,
} from './debian-repo';

export const GITHUB_REPO =
  process.env.DOWNLOAD_GITHUB_REPO || debianRepoMeta.github.repo;

export const DEB_VERSION =
  process.env.DOWNLOAD_DEB_VERSION?.trim() ||
  (DEBIAN_REPO_READY ? debianRepoMeta.deb.version : '');

export const DEB_SHA256 =
  process.env.DOWNLOAD_DEB_SHA256?.trim() ||
  (DEBIAN_REPO_READY ? debianRepoMeta.deb.sha256 : '');

export const DEB_SIZE =
  process.env.DOWNLOAD_DEB_SIZE?.trim() ||
  (DEBIAN_REPO_READY ? debianRepoMeta.deb.sizeHuman : '');

export const DEB_DATE =
  process.env.DOWNLOAD_DEB_DATE?.trim() ||
  (DEBIAN_REPO_READY ? debianRepoMeta.deb.publishedAt : '');

export const APT_SOURCE_LINE = debianRepoMeta.aptSourceLine;

export const DEBIAN_REPO_BASE_URL = debianRepoMeta.repoBaseUrl;

export const DEBIAN_SUITE_INDEX_URL = debianRepoMeta.urls.suiteIndex;

const githubTag =
  process.env.DOWNLOAD_GITHUB_TAG?.trim() ||
  (DEBIAN_REPO_READY ? debianRepoMeta.github.tag : '') ||
  '';

const releasesBase = `https://github.com/${GITHUB_REPO}/releases`;

function debBasename(version: string): string {
  if (DEBIAN_REPO_READY && version === debianRepoMeta.deb.version) {
    return debianRepoMeta.deb.filename;
  }
  return `Bastion-base_${version}_amd64.deb`;
}

export function githubReleasePageUrl(): string {
  return githubTag ? `${releasesBase}/tag/${githubTag}` : `${releasesBase}/latest`;
}

export function debDownloadUrl(version: string = DEB_VERSION): string {
  if (DEBIAN_REPO_READY && (!version || version === debianRepoMeta.deb.version)) {
    return debianRepoDebUrl();
  }
  if (!version) {
    return `${releasesBase}/latest`;
  }
  const file = debBasename(version);
  if (githubTag) {
    return `${releasesBase}/download/${githubTag}/${file}`;
  }
  return `${releasesBase}/latest/download/${file}`;
}

export function debChecksumUrl(version: string = DEB_VERSION): string {
  if (!version) {
    return `${releasesBase}/latest`;
  }
  const file = `${debBasename(version)}.sha256`;
  if (githubTag) {
    return `${releasesBase}/download/${githubTag}/${file}`;
  }
  return `${releasesBase}/latest/download/${file}`;
}

export const EDGEWATCH_LOGO_URL =
  process.env.DOWNLOAD_LOGO_URL ||
  'https://assets.edgewatch.com/edgewatch-c.svg';

export const VERIFY_DOCS_PATH = '/docs/getting-started/install';
