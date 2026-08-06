#!/usr/bin/env node
/**
 * Generate a static Debian APT repository under static/debian/bastion/
 * with Apache-style directory index pages, Release, and Packages metadata.
 *
 * The repository is MULTI-PACKAGE: it indexes every Edgewatch Bastion .deb
 * published on GitHub Releases (currently `bastion-base` and
 * `bastion-telemetry`). Any release asset whose filename matches
 * `Bastion-*_<version>_<arch>.deb` (case-insensitive) and is a Debian package
 * is placed in its own apt pool directory (pool/<comp>/<letter>/<pkg>/) and
 * listed in the generated Packages file, so clients can
 * `apt-get install bastion-base` and `apt-get install bastion-telemetry` from
 * the same `deb ... trixie main` source line.
 *
 * Fetches .deb assets from GitHub Releases (edgewatch/bastion) unless
 * DEBIAN_REPO_DEB_PATH points at a local file. When DEBIAN_REPO_DEB_PATH is
 * set the GitHub API call is skipped, and metadata is derived from the
 * supplied file (basename / size / sha256).
 */

import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
  copyFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {renderApacheIndex} from './lib/apache-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEBSITE_ROOT, '..');
const REPO_SLUG = 'bastion';
const ORIGIN = 'Edgewatch Bastion';
// Repo-wide Release label (the archive now hosts more than one package).
const LABEL = 'bastion';
const SUITE = process.env.DEBIAN_REPO_SUITE || 'trixie';
const COMPONENT = process.env.DEBIAN_REPO_COMPONENT || 'main';
const ARCH = process.env.DEBIAN_REPO_ARCH || 'amd64';
const BINARY_DIR = `binary-${ARCH}`;
// The primary package whose data is mirrored into the back-compat top-level
// fields of debian-repo-meta.json (kept so existing consumers keep working).
const PRIMARY_PKG = 'bastion-base';
// Any Edgewatch Bastion package asset. Debian Policy §5.6.7 requires Package
// names to be lowercase; the published .deb filename uses a capital 'B'
// (`Bastion-base`, `Bastion-telemetry`), which apt tooling accepts.
const ASSET_RE = new RegExp(`^(bastion-[a-z0-9][a-z0-9.+-]*)_(.+)_${ARCH}\\.deb$`, 'i');
const GITHUB_REPO = process.env.DOWNLOAD_GITHUB_REPO || 'edgewatch/bastion';
const SITE_URL = process.env.DOCS_URL || 'https://download.edgewatch.com';
const REPO_BASE_PATH = `/debian/${REPO_SLUG}`;
const REPO_BASE_URL = `${SITE_URL.replace(/\/$/, '')}${REPO_BASE_PATH}`;
const SKIP_DOWNLOAD = process.env.DEBIAN_REPO_SKIP_DOWNLOAD === '1';
const LOCAL_DEB = process.env.DEBIAN_REPO_DEB_PATH?.trim() || '';
// Cap pool size so the published gh-pages tree stays under GitHub Pages' ~1 GiB
// soft limit. Beyond that, git still holds the blobs but Pages starts 404'ing
// newer pool objects while Packages/meta may still list them.
const KEEP_VERSIONS = (() => {
  const raw = process.env.DEBIAN_REPO_KEEP_VERSIONS?.trim();
  if (raw === '0' || raw === 'all') return 0; // 0 = keep every version
  const n = Number(raw || '8');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
})();
const POOL_SOFT_LIMIT_BYTES = Number(
  process.env.DEBIAN_REPO_POOL_SOFT_LIMIT_BYTES || String(900 * 1024 * 1024),
);

/** Content-types GitHub assigns to .deb release assets (CI vs manual `gh`). */
const DEB_CONTENT_TYPES = new Set([
  'application/vnd.debian.binary-package',
  'application/x-debian-package',
  'application/octet-stream',
]);

const OUT_ROOT = path.join(WEBSITE_ROOT, 'static', 'debian', REPO_SLUG);
const POOL_ROOT = path.join(OUT_ROOT, 'pool');
const DIST_SUITE = path.join(OUT_ROOT, 'dists', SUITE);
const DIST_BINARY = path.join(DIST_SUITE, COMPONENT, BINARY_DIR);
const META_JSON = path.join(WEBSITE_ROOT, 'src', 'data', 'debian-repo-meta.json');

function log(msg) {
  console.log(`[debian-repo] ${msg}`);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

async function sha256File(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function isPkgDebAsset(name) {
  return ASSET_RE.test(name);
}

function isDebContentType(contentType) {
  if (!contentType || typeof contentType !== 'string') {
    // Missing type: still accept when the filename matches ASSET_RE.
    return true;
  }
  return DEB_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}

/** Lowercase Debian package name derived from a Bastion-*_*.deb filename. */
function packageNameFromFilename(name) {
  const m = name.match(ASSET_RE);
  return m ? m[1].toLowerCase() : '';
}

/** Version string embedded in a Bastion-*_<version>_<arch>.deb filename. */
function parseDebVersion(filename) {
  const m = filename.match(ASSET_RE);
  return m ? m[2] : '';
}

function poolLetter(pkgName) {
  return pkgName.charAt(0).toLowerCase();
}

function poolDirFor(pkgName) {
  return path.join(POOL_ROOT, COMPONENT, poolLetter(pkgName), pkgName);
}

function ghHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'edgewatch-bastion-docs-debian-repo',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.DOWNLOAD_GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Return one entry per matching .deb asset in a release (a single release may
 * carry both bastion-base and bastion-telemetry assets).
 */
function entriesFromRelease(rel) {
  const debAssets = (rel.assets || []).filter(
    (a) => isPkgDebAsset(a.name) && isDebContentType(a.content_type),
  );
  // Prefer the official Debian media type when the same filename appears twice
  // (should not happen) or when ranking ties later.
  debAssets.sort((a, b) => {
    const rank = (ct) =>
      ct === 'application/vnd.debian.binary-package'
        ? 0
        : ct === 'application/x-debian-package'
          ? 1
          : 2;
    return rank(a.content_type) - rank(b.content_type);
  });
  return debAssets.map((debAsset) => {
    const shaMatch = rel.body?.match(
      new RegExp(
        `${debAsset.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*SHA256:\\s*([a-f0-9]{64})`,
        'i',
      ),
    );
    return {
      packageName: packageNameFromFilename(debAsset.name),
      tag: rel.tag_name,
      publishedAt: rel.published_at,
      prerelease: Boolean(rel.prerelease),
      deb: {
        name: debAsset.name,
        size: debAsset.size,
        url: debAsset.browser_download_url,
        sha256: debAsset.digest?.replace(/^sha256:/i, '') || shaMatch?.[1] || '',
      },
    };
  });
}

async function fetchAllReleases() {
  const collected = [];
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`;
    log(`Fetching ${url}`);
    const res = await fetch(url, {headers: ghHeaders()});
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }
    const releases = await res.json();
    if (!Array.isArray(releases) || releases.length === 0) {
      break;
    }
    for (const rel of releases) {
      // Skip drafts; the GitLab publisher marks real releases draft=false.
      if (rel.draft) {
        continue;
      }
      for (const info of entriesFromRelease(rel)) {
        // Deduplicate by .deb filename. The API returns releases newest-first,
        // so the first occurrence (newest) wins if a version was re-released.
        if (seen.has(info.deb.name)) {
          continue;
        }
        seen.add(info.deb.name);
        collected.push(info);
      }
    }
    if (releases.length < 100) {
      break;
    }
  }
  if (collected.length === 0) {
    throw new Error(
      `No releases expose a Bastion-*_${ARCH}.deb asset in ${GITHUB_REPO}`,
    );
  }
  return limitVersionsPerPackage(collected, KEEP_VERSIONS);
}

/**
 * Keep at most `keep` newest .deb entries per package name so the static
 * archive fits under GitHub Pages' soft size limit. `keep <= 0` means all.
 */
function limitVersionsPerPackage(entries, keep) {
  if (!keep || keep <= 0) {
    return entries;
  }
  const byPkg = new Map();
  for (const entry of entries) {
    if (!byPkg.has(entry.packageName)) {
      byPkg.set(entry.packageName, []);
    }
    byPkg.get(entry.packageName).push(entry);
  }
  const limited = [];
  for (const [pkg, list] of byPkg) {
    list.sort((a, b) => {
      if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
        return b.publishedAt.localeCompare(a.publishedAt);
      }
      // Newer embedded timestamps / git suffixes sort later lexicographically
      // for our Bastion-*_<ver>_amd64.deb naming; reverse for newest-first.
      return b.deb.name.localeCompare(a.deb.name);
    });
    const kept = list.slice(0, keep);
    if (list.length > kept.length) {
      log(
        `Keeping ${kept.length}/${list.length} newest ${pkg} .deb(s) (DEBIAN_REPO_KEEP_VERSIONS=${keep})`,
      );
    }
    limited.push(...kept);
  }
  return limited;
}

function releaseInfoFromLocal(filePath) {
  const name = path.basename(filePath);
  if (!isPkgDebAsset(name)) {
    throw new Error(
      `DEBIAN_REPO_DEB_PATH=${filePath} basename does not match Bastion-*_${ARCH}.deb`,
    );
  }
  return {
    packageName: packageNameFromFilename(name),
    tag: process.env.DEBIAN_REPO_GITHUB_TAG?.trim() || '',
    publishedAt:
      process.env.DEBIAN_REPO_PUBLISHED_AT?.trim() || new Date().toISOString(),
    prerelease: false,
    localPath: filePath,
    deb: {
      name,
      size: 0,
      url: '',
      sha256: '',
    },
  };
}

async function placeDebInPool(releaseInfo) {
  const poolPkgDir = poolDirFor(releaseInfo.packageName);
  await mkdir(poolPkgDir, {recursive: true});
  const dest = path.join(poolPkgDir, releaseInfo.deb.name);

  if (releaseInfo.localPath) {
    log(`Copying local .deb from ${releaseInfo.localPath}`);
    await copyFile(releaseInfo.localPath, dest);
    return dest;
  }

  log(`Downloading ${releaseInfo.deb.url}`);
  // Release assets are public; browser_download_url redirects to a signed
  // CDN URL, so no auth header is sent on the download itself.
  const res = await fetch(releaseInfo.deb.url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} for ${releaseInfo.deb.url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return dest;
}

/** Recursively collect every Bastion-*.deb already present under pool/. */
async function findPoolDebs() {
  const found = [];
  async function walk(dir) {
    let names;
    try {
      names = await readdir(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const ent of names) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
      } else if (isPkgDebAsset(ent.name)) {
        found.push(abs);
      }
    }
  }
  await walk(POOL_ROOT);
  return found;
}

async function reuseExistingPoolDebs() {
  const existing = await findPoolDebs();
  if (existing.length === 0) {
    throw new Error(
      'DEBIAN_REPO_SKIP_DOWNLOAD=1 but no .deb in pool; set DEBIAN_REPO_DEB_PATH or allow download',
    );
  }
  // Newest filename first for a stable selection when offline.
  existing.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  return existing.map((abs) => {
    const name = path.basename(abs);
    return {
      path: abs,
      info: {
        packageName: packageNameFromFilename(name),
        tag: '',
        publishedAt: '',
        prerelease: false,
        deb: {name, sha256: ''},
      },
    };
  });
}

function generatePackages() {
  // Run with cwd=OUT_ROOT and pass the pool directory as a RELATIVE path so
  // both dpkg-scanpackages and apt-ftparchive emit `Filename: pool/...`
  // instead of leaking the absolute repo path of the build host. The scan is
  // recursive, so every package's pool dir is picked up automatically.
  const cwd = OUT_ROOT;
  const relPool = 'pool';
  let packagesText;
  try {
    // --multiversion keeps every version of every package in the pool.
    packagesText = run(
      'dpkg-scanpackages',
      ['--multiversion', '--arch', ARCH, relPool, '/dev/null'],
      {cwd},
    );
  } catch (e) {
    log(`dpkg-scanpackages unavailable (${e.message}); trying apt-ftparchive`);
    packagesText = run('apt-ftparchive', ['packages', relPool], {cwd});
  }

  packagesText = sanitizeFilenameLines(packagesText);

  const packagesPath = path.join(DIST_BINARY, 'Packages');
  return {packagesText, packagesPath};
}

/**
 * Belt-and-suspenders: scan the Packages text for any Filename: line that
 * leaked an absolute path and rewrite it to a relative `pool/...` path.
 * Throws if normalization still leaves an absolute path so the build fails
 * loudly instead of silently publishing usernames or local paths.
 */
function sanitizeFilenameLines(text) {
  const homeDir = os.homedir() || '';
  const envHome = process.env.HOME || '';
  const leakNeedles = [REPO_ROOT, WEBSITE_ROOT, OUT_ROOT, homeDir, envHome]
    .filter(Boolean)
    .map((p) => p.replace(/\/+$/, ''));

  const lines = text.split('\n');
  let mutated = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('Filename:')) {
      continue;
    }
    let value = line.slice('Filename:'.length).trim();
    const original = value;

    for (const prefix of [OUT_ROOT, ...leakNeedles]) {
      if (prefix && value.startsWith(prefix + path.sep)) {
        value = value.slice(prefix.length + 1);
      } else if (prefix && value.startsWith(prefix)) {
        value = value.slice(prefix.length).replace(/^[\\/]+/, '');
      }
    }

    if (path.isAbsolute(value)) {
      value = value.replace(/^[\\/]+/, '');
    }

    for (const needle of leakNeedles) {
      if (needle && value.includes(needle)) {
        throw new Error(
          `Filename line still contains local path leak after sanitize: '${original}'`,
        );
      }
    }
    if (path.isAbsolute(value)) {
      throw new Error(
        `Filename line is still absolute after sanitize: '${original}'`,
      );
    }
    if (!value.startsWith('pool/')) {
      throw new Error(
        `Filename line does not start with 'pool/': '${original}' -> '${value}'`,
      );
    }
    if (value !== original) {
      lines[i] = `Filename: ${value}`;
      mutated++;
    }
  }
  if (mutated > 0) {
    log(`Sanitized ${mutated} Filename line(s) to be repo-relative.`);
  }
  return lines.join('\n');
}

async function generateRelease(suiteDir, suiteName) {
  return writeMinimalRelease(suiteDir, suiteName);
}

async function writeMinimalRelease(suiteDir, suiteName) {
  const archDir = path.join(suiteDir, COMPONENT, BINARY_DIR);
  const packagesPath = path.join(archDir, 'Packages');
  const packagesGzPath = path.join(archDir, 'Packages.gz');
  const packages = await readFile(packagesPath);
  const packagesGz = await readFile(packagesGzPath);
  const now = new Date().toUTCString().replace(/GMT/, 'UTC');

  const files = [
    ['Packages', packages],
    ['Packages.gz', packagesGz],
  ];

  let body = `Origin: ${ORIGIN}\n`;
  body += `Label: ${LABEL}\n`;
  body += `Suite: ${suiteName}\n`;
  body += `Codename: ${suiteName}\n`;
  body += `Date: ${now}\n`;
  body += `Architectures: ${ARCH}\n`;
  body += `Components: ${COMPONENT}\n`;
  body += `Description: Edgewatch Bastion APT repository (bastion-base, bastion-telemetry)\n`;
  body += 'MD5Sum:\n';

  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const md5 = createHash('md5').update(buf).digest('hex');
    body += ` ${md5} ${buf.length} ${rel}\n`;
  }

  body += 'SHA256:\n';
  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const sha256 = createHash('sha256').update(buf).digest('hex');
    body += ` ${sha256} ${buf.length} ${rel}\n`;
  }

  body += 'SHA512:\n';
  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const sha512 = createHash('sha512').update(buf).digest('hex');
    body += ` ${sha512} ${buf.length} ${rel}\n`;
  }

  return body;
}

async function listDirEntries(absDir) {
  const names = await readdir(absDir);
  const entries = [];
  for (const name of names) {
    const abs = path.join(absDir, name);
    const st = await stat(abs);
    entries.push({
      name,
      href: name + (st.isDirectory() ? '/' : ''),
      mtime: st.mtime,
      size: st.isDirectory() ? null : st.size,
      isDir: st.isDirectory(),
    });
  }
  return entries;
}

async function writeIndexForDir(absDir, displayPath, parentHref) {
  const entries = await listDirEntries(absDir);
  const html = renderApacheIndex({displayPath, parentHref, entries});
  await writeFile(path.join(absDir, 'index.html'), html, 'utf8');
}

async function writeAllIndexes(pkgNames) {
  const rel = (abs) =>
    path.relative(OUT_ROOT, abs).split(path.sep).join('/');
  const dirs = [
    {abs: OUT_ROOT, parent: null},
    {abs: path.join(OUT_ROOT, 'dists'), parent: '../'},
    {abs: DIST_SUITE, parent: '../'},
    {abs: path.join(DIST_SUITE, COMPONENT), parent: '../'},
    {abs: DIST_BINARY, parent: '../'},
    {abs: POOL_ROOT, parent: '../'},
    {abs: path.join(POOL_ROOT, COMPONENT), parent: '../'},
  ];

  // One index per pool letter and per package directory.
  const letters = new Set(pkgNames.map((p) => poolLetter(p)));
  for (const letter of letters) {
    dirs.push({abs: path.join(POOL_ROOT, COMPONENT, letter), parent: '../'});
  }
  for (const pkg of pkgNames) {
    dirs.push({abs: poolDirFor(pkg), parent: '../'});
  }

  for (const {abs, parent} of dirs) {
    await mkdir(abs, {recursive: true});
    const relPath = rel(abs);
    const display = relPath
      ? `${REPO_BASE_PATH}/${relPath}/`
      : `${REPO_BASE_PATH}/`;
    await writeIndexForDir(abs, display, parent);
  }
}

async function buildReleaseMeta(poolEntry) {
  const {path: debPath, info} = poolEntry;
  const st = await stat(debPath);
  const sha256 = info.deb.sha256 || (await sha256File(debPath));
  const version = parseDebVersion(path.basename(debPath));
  return {
    packageName: info.packageName || packageNameFromFilename(path.basename(debPath)),
    filename: path.basename(debPath),
    version,
    sizeBytes: st.size,
    sizeHuman: `${(st.size / (1024 * 1024)).toFixed(1)} MB`,
    sha256,
    poolRelativePath: path.relative(OUT_ROOT, debPath).split(path.sep).join('/'),
    publishedAt: info.publishedAt?.slice(0, 10) || '',
    tag: info.tag || '',
    releaseUrl: info.tag
      ? `https://github.com/${GITHUB_REPO}/releases/tag/${info.tag}`
      : `https://github.com/${GITHUB_REPO}/releases`,
    isLatest: false,
  };
}

/** Build the per-package meta block from that package's release metas. */
function buildPackageMeta(pkgName, metas) {
  const sorted = [...metas].sort((a, b) => {
    if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
      return b.publishedAt.localeCompare(a.publishedAt);
    }
    return b.filename.localeCompare(a.filename);
  });
  // "latest" mirrors GitHub's /releases/latest preference for the newest.
  const latest = sorted[0];
  latest.isLatest = true;
  const letter = poolLetter(pkgName);
  const filePrefix = latest.filename.split('_')[0];
  return {
    packageName: pkgName,
    label: pkgName,
    filePrefix,
    poolLetter: letter,
    deb: {
      filename: latest.filename,
      version: latest.version,
      sizeBytes: latest.sizeBytes,
      sizeHuman: latest.sizeHuman,
      sha256: latest.sha256,
      poolRelativePath: latest.poolRelativePath,
      publishedAt: latest.publishedAt,
    },
    github: {
      repo: GITHUB_REPO,
      tag: latest.tag,
      releaseUrl: latest.releaseUrl,
    },
    urls: {
      poolPackageDir: `${REPO_BASE_URL}/pool/${COMPONENT}/${letter}/${pkgName}/`,
    },
    releases: sorted,
  };
}

async function main() {
  log(`Output: ${OUT_ROOT}`);

  let poolEntries;

  if (SKIP_DOWNLOAD && !LOCAL_DEB) {
    // Offline mode: rebuild metadata from whatever .deb files already exist
    // in the pool, without wiping the tree or hitting the network.
    log('DEBIAN_REPO_SKIP_DOWNLOAD=1: reusing existing pool .deb files');
    await mkdir(DIST_BINARY, {recursive: true});
    poolEntries = await reuseExistingPoolDebs();
  } else {
    await rm(OUT_ROOT, {recursive: true, force: true});
    await mkdir(DIST_BINARY, {recursive: true});

    const releases = LOCAL_DEB
      ? [releaseInfoFromLocal(LOCAL_DEB)]
      : await fetchAllReleases();

    poolEntries = [];
    for (const info of releases) {
      const debPath = await placeDebInPool(info);
      poolEntries.push({path: debPath, info});
    }
  }

  // IMPORTANT: write the clean Packages and Packages.gz BEFORE calling
  // generateRelease(), because generateRelease() reads them back from disk
  // to compute MD5Sum / SHA256 / SHA512 entries that go into Release.
  const {packagesText, packagesPath} = generatePackages();
  await mkdir(path.dirname(packagesPath), {recursive: true});
  await writeFile(packagesPath, packagesText, 'utf8');
  const packagesGz = gzipSync(Buffer.from(packagesText, 'utf8'));
  await writeFile(`${packagesPath}.gz`, packagesGz);

  const releaseText = await generateRelease(DIST_SUITE, SUITE);
  await writeFile(path.join(DIST_SUITE, 'Release'), releaseText, 'utf8');

  // Group release metas by package.
  const allMetas = [];
  for (const entry of poolEntries) {
    allMetas.push(await buildReleaseMeta(entry));
  }
  const byPackage = new Map();
  for (const m of allMetas) {
    if (!byPackage.has(m.packageName)) {
      byPackage.set(m.packageName, []);
    }
    byPackage.get(m.packageName).push(m);
  }

  const pkgNames = [...byPackage.keys()];
  await writeAllIndexes(pkgNames);

  const packages = pkgNames.map((pkg) =>
    buildPackageMeta(pkg, byPackage.get(pkg)),
  );
  // Stable order: primary package first, then alphabetical.
  packages.sort((a, b) => {
    if (a.packageName === PRIMARY_PKG) return -1;
    if (b.packageName === PRIMARY_PKG) return 1;
    return a.packageName.localeCompare(b.packageName);
  });

  const primary =
    packages.find((p) => p.packageName === PRIMARY_PKG) || packages[0];

  const aptSourceLine = `deb [trusted=yes] ${REPO_BASE_URL} ${SUITE} ${COMPONENT}`;
  const meta = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    label: primary.packageName,
    suite: SUITE,
    component: COMPONENT,
    architecture: ARCH,
    // Back-compat top-level fields mirror the PRIMARY package (bastion-base).
    packageName: primary.packageName,
    repoBasePath: REPO_BASE_PATH,
    repoBaseUrl: REPO_BASE_URL,
    aptSourceLine,
    deb: primary.deb,
    releases: primary.releases,
    github: primary.github,
    urls: {
      suiteIndex: `${REPO_BASE_URL}/dists/${SUITE}/`,
      release: `${REPO_BASE_URL}/dists/${SUITE}/Release`,
      packages: `${REPO_BASE_URL}/dists/${SUITE}/${COMPONENT}/${BINARY_DIR}/Packages`,
      poolPackageDir: primary.urls.poolPackageDir,
    },
    // Full multi-package view (every Edgewatch Bastion package in the archive).
    packages,
  };

  await writeFile(META_JSON, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  log(`Wrote ${META_JSON}`);
  log(
    `Indexed ${allMetas.length} .deb(s) across ${pkgNames.length} package(s): ${pkgNames.join(', ')}`,
  );

  let poolBytes = 0;
  for (const entry of poolEntries) {
    poolBytes += (await stat(entry.path)).size;
  }
  const poolMiB = (poolBytes / (1024 * 1024)).toFixed(1);
  log(`Pool size: ${poolMiB} MiB (${poolEntries.length} file(s))`);
  if (POOL_SOFT_LIMIT_BYTES > 0 && poolBytes > POOL_SOFT_LIMIT_BYTES) {
    throw new Error(
      `Pool is ${poolMiB} MiB, above soft limit ${(POOL_SOFT_LIMIT_BYTES / (1024 * 1024)).toFixed(0)} MiB. ` +
        `GitHub Pages will 404 newer .deb files once the published site exceeds ~1 GiB. ` +
        `Lower DEBIAN_REPO_KEEP_VERSIONS (currently ${KEEP_VERSIONS || 'all'}) or raise DEBIAN_REPO_POOL_SOFT_LIMIT_BYTES.`,
    );
  }

  log(`APT source: ${aptSourceLine}`);
  log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
