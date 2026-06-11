import meta from './debian-repo-meta.json';

export type DebianRepoMeta = typeof meta;

export type DebianRepoRelease = {
  packageName?: string;
  filename: string;
  version: string;
  sizeBytes: number;
  sizeHuman: string;
  sha256: string;
  poolRelativePath: string;
  publishedAt: string;
  tag: string;
  releaseUrl: string;
  isLatest: boolean;
};

export type DebianRepoPackage = {
  packageName: string;
  label: string;
  filePrefix: string;
  poolLetter: string;
  deb: {
    filename: string;
    version: string;
    sizeBytes: number;
    sizeHuman: string;
    sha256: string;
    poolRelativePath: string;
    publishedAt: string;
  };
  github: {repo: string; tag: string; releaseUrl: string};
  urls: {poolPackageDir: string};
  releases: DebianRepoRelease[];
};

export const debianRepoMeta: DebianRepoMeta = meta;

/** Every published release of the PRIMARY package (bastion-base), newest first. */
export const debianRepoReleases: DebianRepoRelease[] =
  (debianRepoMeta as {releases?: DebianRepoRelease[]}).releases ?? [];

/** Every Edgewatch Bastion package indexed in the apt archive. */
export const debianRepoPackages: DebianRepoPackage[] =
  (debianRepoMeta as {packages?: DebianRepoPackage[]}).packages ?? [];

export const DEBIAN_REPO_READY = Boolean(
  debianRepoMeta.deb?.filename && debianRepoMeta.deb?.version,
);

function repoBase(): string {
  return debianRepoMeta.repoBaseUrl.replace(/\/$/, '');
}

export function debianRepoDebUrl(): string {
  if (!DEBIAN_REPO_READY) {
    return debianRepoMeta.urls.poolPackageDir;
  }
  return `${repoBase()}/${debianRepoMeta.deb.poolRelativePath}`;
}

/** Absolute download URL for any pool-relative path (multi-package safe). */
export function debianRepoPoolUrl(poolRelativePath: string): string {
  return `${repoBase()}/${poolRelativePath}`;
}
