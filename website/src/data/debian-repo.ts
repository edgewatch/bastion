import meta from './debian-repo-meta.json';

export type DebianRepoMeta = typeof meta;

export type DebianRepoRelease = {
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

export const debianRepoMeta: DebianRepoMeta = meta;

/** Every published release indexed into the apt pool (newest first). */
export const debianRepoReleases: DebianRepoRelease[] =
  (debianRepoMeta as {releases?: DebianRepoRelease[]}).releases ?? [];

export const DEBIAN_REPO_READY = Boolean(
  debianRepoMeta.deb?.filename && debianRepoMeta.deb?.version,
);

export function debianRepoDebUrl(): string {
  if (!DEBIAN_REPO_READY) {
    return debianRepoMeta.urls.poolPackageDir;
  }
  const base = debianRepoMeta.repoBaseUrl.replace(/\/$/, '');
  return `${base}/${debianRepoMeta.deb.poolRelativePath}`;
}
