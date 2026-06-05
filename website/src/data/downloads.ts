import {
  APT_SOURCE_LINE,
  DEB_DATE,
  DEB_SHA256,
  DEB_SIZE,
  DEB_VERSION,
  DEBIAN_REPO_BASE_URL,
  DEBIAN_SUITE_INDEX_URL,
  debChecksumUrl,
  debDownloadUrl,
  githubReleasePageUrl,
  GITHUB_REPO,
  VERIFY_DOCS_PATH,
} from './download-config';
import {
  DEBIAN_REPO_READY,
  debianRepoMeta,
  debianRepoReleases,
} from './debian-repo';

export {APT_SOURCE_LINE, DEBIAN_REPO_BASE_URL, DEBIAN_SUITE_INDEX_URL};

export type SecondaryAction = {
  label: string;
  href: string;
  title?: string;
};

export type DownloadArtifact = {
  id: string;
  filename: string;
  size: string;
  date: string;
  sha256: string;
  sha256Placeholder?: boolean;
  downloadHref: string;
  secondaryActions: SecondaryAction[];
  olderVersions: DownloadArtifact[];
};

export type ProductSection = {
  id: string;
  title: string;
  description: string;
  artifacts: DownloadArtifact[];
};

const sha256Display =
  DEB_SHA256 ||
  'Configure DOWNLOAD_DEB_SHA256 at build time, or download the matching .sha256 file from GitHub Releases.';

const releasesIndex = `https://github.com/${GITHUB_REPO}/releases`;

const debFilename = DEBIAN_REPO_READY
  ? debianRepoMeta.deb.filename
  : DEB_VERSION
    ? `Bastion-base_${DEB_VERSION}_amd64.deb`
    : 'Bastion-base_<version>_amd64.deb';

const repoBaseUrl = debianRepoMeta.repoBaseUrl.replace(/\/$/, '');

function poolDownloadUrl(poolRelativePath: string): string {
  return `${repoBaseUrl}/${poolRelativePath}`;
}

function releaseChecksumUrl(tag: string, filename: string): string {
  if (!tag) {
    return releasesIndex;
  }
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${filename}.sha256`;
}

// Older versions are derived from the generated apt-repo metadata so the
// download page mirrors exactly what is published on GitHub Releases. Each
// .deb is served from our own static archive (pool/...), while the checksum
// sidecar and notes link back to the matching GitHub release.
const olderVersionsFromMeta: DownloadArtifact[] = debianRepoReleases
  .filter((release) => !release.isLatest)
  .map((release) => ({
    id: `bastion-deb-${release.version}`,
    filename: release.filename,
    size: release.sizeHuman || 'Previous release',
    date: release.publishedAt || '—',
    sha256:
      release.sha256 ||
      'Download the matching .sha256 asset from the release tag on GitHub.',
    sha256Placeholder: !release.sha256,
    downloadHref: poolDownloadUrl(release.poolRelativePath),
    secondaryActions: [
      {
        label: 'CHECKSUM',
        href: releaseChecksumUrl(release.tag, release.filename),
        title: 'Download the published SHA256 sidecar from GitHub',
      },
      {
        label: 'RELEASE',
        href: release.releaseUrl,
        title: 'Open the GitHub release page (notes and assets)',
      },
    ],
    olderVersions: [],
  }));

const olderVersionsFallback: DownloadArtifact[] = [
  {
    id: 'bastion-deb-older-example',
    filename: 'Bastion-base_<previous-version>_amd64.deb',
    size: 'Previous release',
    date: '—',
    sha256: 'Download the matching .sha256 asset from the release tag on GitHub.',
    sha256Placeholder: true,
    downloadHref: releasesIndex,
    secondaryActions: [
      {
        label: 'RELEASES',
        href: releasesIndex,
        title: 'Browse all published versions',
      },
    ],
    olderVersions: [],
  },
];

const currentDeb: DownloadArtifact = {
  id: 'bastion-deb-current',
  filename: debFilename,
  size: DEB_SIZE || 'See GitHub Releases asset size',
  date: DEB_DATE || 'See GitHub Releases publish date',
  sha256: sha256Display,
  sha256Placeholder: !DEB_SHA256,
  downloadHref: debDownloadUrl(),
  secondaryActions: [
    {
      label: 'REPO',
      href: DEBIAN_SUITE_INDEX_URL,
      title: 'Browse the Debian archive (dists/trixie)',
    },
    {
      label: 'CHECKSUM',
      href: debChecksumUrl(),
      title: 'Download the published SHA256 sidecar file',
    },
    {
      label: 'RELEASE',
      href: githubReleasePageUrl(),
      title: 'Open the GitHub release page (notes and assets)',
    },
    {
      label: 'VERIFY',
      href: VERIFY_DOCS_PATH,
      title: 'Installation and checksum verification steps',
    },
  ],
  olderVersions: olderVersionsFromMeta.length
    ? olderVersionsFromMeta
    : olderVersionsFallback,
};

export const downloadSections: ProductSection[] = [
  {
    id: 'bastion-deb',
    title: 'Edgewatch Bastion Base — Debian package',
    description:
      'Installable amd64 package for Debian 13 (Trixie), suite trixie, component main. Served as a static Debian archive under /debian/bastion/ (Apache-style indexes) and mirrored from GitHub Releases on tagged pipelines. Use apt with the sources.list line on the downloads page or install the .deb directly.',
    artifacts: [currentDeb],
  },
  {
    id: 'bastion-iso',
    title: 'Live / ISO images',
    description:
      'No pre-built ISO or live image is published from this repository today. Use the Debian package above, or build from source with the Docker/Makefile workflow documented in the project README.',
    artifacts: [
      {
        id: 'bastion-iso-placeholder',
        filename: 'Not published (build from source or use .deb)',
        size: '—',
        date: '—',
        sha256: 'N/A — ISO artifacts are not part of the current release pipeline.',
        sha256Placeholder: true,
        downloadHref: VERIFY_DOCS_PATH,
        secondaryActions: [
          {
            label: 'BUILD',
            href: VERIFY_DOCS_PATH,
            title: 'How to build and install locally',
          },
          {
            label: 'GITHUB',
            href: githubReleasePageUrl(),
            title: 'Published .deb releases',
          },
        ],
        olderVersions: [],
      },
    ],
  },
];
