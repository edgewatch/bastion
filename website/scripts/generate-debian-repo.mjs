#!/usr/bin/env node
/**
 * Generate a static Debian APT repository under static/debian/bastion/
 * with Apache-style directory index pages, Release, and Packages metadata.
 *
 * Fetches the latest .deb from GitHub Releases (edgewatch/bastion) unless
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
const LABEL = 'bastion-base';
const SUITE = process.env.DEBIAN_REPO_SUITE || 'trixie';
const COMPONENT = process.env.DEBIAN_REPO_COMPONENT || 'main';
const ARCH = process.env.DEBIAN_REPO_ARCH || 'amd64';
const BINARY_DIR = `binary-${ARCH}`;
// Debian Policy §5.6.7 requires Package names to be lowercase.
const PKG_NAME = 'bastion-base';
// The .deb filename uses a capital 'B' so the published asset filename is
// `Bastion-base_<version>_<arch>.deb`. Debian/apt tooling accepts this since
// only the `Package:` control field is required to be lowercase.
const PKG_FILE_PREFIX = 'Bastion-base';
const PKG_FILE_PREFIX_LC = PKG_FILE_PREFIX.toLowerCase();
const POOL_LETTER = PKG_NAME.charAt(0).toLowerCase();
const GITHUB_REPO = process.env.DOWNLOAD_GITHUB_REPO || 'edgewatch/bastion';
const SITE_URL =
  process.env.DOCS_URL || 'https://download.edgewatch.com';
const REPO_BASE_PATH = `/debian/${REPO_SLUG}`;
const REPO_BASE_URL = `${SITE_URL.replace(/\/$/, '')}${REPO_BASE_PATH}`;
const SKIP_DOWNLOAD = process.env.DEBIAN_REPO_SKIP_DOWNLOAD === '1';
const LOCAL_DEB = process.env.DEBIAN_REPO_DEB_PATH?.trim() || '';

const OUT_ROOT = path.join(WEBSITE_ROOT, 'static', 'debian', REPO_SLUG);
const POOL_PKG_DIR = path.join(OUT_ROOT, 'pool', COMPONENT, POOL_LETTER, PKG_NAME);
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
  if (!name.toLowerCase().endsWith(`_${ARCH}.deb`)) {
    return false;
  }
  return name.toLowerCase().startsWith(`${PKG_FILE_PREFIX_LC}_`);
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

function normalizeRelease(rel) {
  const debAsset = (rel.assets || []).find(
    (a) =>
      isPkgDebAsset(a.name) &&
      a.content_type === 'application/vnd.debian.binary-package',
  );
  if (!debAsset) {
    return null;
  }
  const shaMatch = rel.body?.match(
    new RegExp(`${debAsset.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*SHA256:\\s*([a-f0-9]{64})`, 'i'),
  );
  return {
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
      const info = normalizeRelease(rel);
      if (!info) {
        continue;
      }
      // Deduplicate by .deb filename. The API returns releases newest-first,
      // so the first occurrence (newest) wins if a version was re-released.
      if (seen.has(info.deb.name)) {
        continue;
      }
      seen.add(info.deb.name);
      collected.push(info);
    }
    if (releases.length < 100) {
      break;
    }
  }
  if (collected.length === 0) {
    throw new Error(
      `No releases expose a ${PKG_FILE_PREFIX}_*_${ARCH}.deb asset in ${GITHUB_REPO}`,
    );
  }
  return collected;
}

function releaseInfoFromLocal(filePath) {
  const name = path.basename(filePath);
  if (!isPkgDebAsset(name)) {
    throw new Error(
      `DEBIAN_REPO_DEB_PATH=${filePath} basename does not match ${PKG_FILE_PREFIX}_*_${ARCH}.deb`,
    );
  }
  return {
    tag: process.env.DEBIAN_REPO_GITHUB_TAG?.trim() || '',
    publishedAt:
      process.env.DEBIAN_REPO_PUBLISHED_AT?.trim() ||
      new Date().toISOString(),
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
  await mkdir(POOL_PKG_DIR, {recursive: true});
  const dest = path.join(POOL_PKG_DIR, releaseInfo.deb.name);

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

async function reuseExistingPoolDebs() {
  const existing = (await readdir(POOL_PKG_DIR).catch(() => [])).filter((f) =>
    isPkgDebAsset(f),
  );
  if (existing.length === 0) {
    throw new Error(
      'DEBIAN_REPO_SKIP_DOWNLOAD=1 but no .deb in pool; set DEBIAN_REPO_DEB_PATH or allow download',
    );
  }
  // Newest filename first for a stable "latest" selection when offline.
  existing.sort((a, b) => b.localeCompare(a));
  return existing.map((name) => ({
    path: path.join(POOL_PKG_DIR, name),
    info: {tag: '', publishedAt: '', prerelease: false, deb: {name, sha256: ''}},
  }));
}

function generatePackages() {
  // Run with cwd=OUT_ROOT and pass the pool directory as a RELATIVE path so
  // both dpkg-scanpackages and apt-ftparchive emit `Filename: pool/...`
  // instead of leaking the absolute repo path of the build host.
  const cwd = OUT_ROOT;
  const relPool = 'pool';
  let packagesText;
  try {
    // --multiversion keeps every version of the package in the pool; without
    // it dpkg-scanpackages emits only the newest version per package name.
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

    // Strip any leading absolute prefix that matches OUT_ROOT (and its
    // ancestors). The published path must always be repo-relative.
    for (const prefix of [OUT_ROOT, ...leakNeedles]) {
      if (prefix && value.startsWith(prefix + path.sep)) {
        value = value.slice(prefix.length + 1);
      } else if (prefix && value.startsWith(prefix)) {
        value = value.slice(prefix.length).replace(/^[\\/]+/, '');
      }
    }

    // If still absolute, drop the leading '/' as a last resort and then
    // verify there is no residual leak before continuing.
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
      // Acceptable formats are repo-relative paths under pool/.
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
  body += `Description: Edgewatch Bastion Base OpenResty stack\n`;
  body += 'MD5Sum:\n';

  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const md5 = createHash('md5').update(buf).digest('hex');
    const size = buf.length;
    body += ` ${md5} ${size} ${rel}\n`;
  }

  body += 'SHA256:\n';
  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const size = buf.length;
    body += ` ${sha256} ${size} ${rel}\n`;
  }

  body += 'SHA512:\n';
  for (const [name, buf] of files) {
    const rel = `${COMPONENT}/${BINARY_DIR}/${name}`;
    const sha512 = createHash('sha512').update(buf).digest('hex');
    const size = buf.length;
    body += ` ${sha512} ${size} ${rel}\n`;
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

async function writeAllIndexes() {
  const dirs = [
    {abs: OUT_ROOT, display: `${REPO_BASE_PATH}/`, parent: null},
    {abs: path.join(OUT_ROOT, 'dists'), display: `${REPO_BASE_PATH}/dists/`, parent: '../'},
    {abs: DIST_SUITE, display: `${REPO_BASE_PATH}/dists/${SUITE}/`, parent: '../'},
    {
      abs: path.join(DIST_SUITE, COMPONENT),
      display: `${REPO_BASE_PATH}/dists/${SUITE}/${COMPONENT}/`,
      parent: '../',
    },
    {
      abs: DIST_BINARY,
      display: `${REPO_BASE_PATH}/dists/${SUITE}/${COMPONENT}/${BINARY_DIR}/`,
      parent: '../',
    },
    {abs: path.join(OUT_ROOT, 'pool'), display: `${REPO_BASE_PATH}/pool/`, parent: '../'},
    {
      abs: path.join(OUT_ROOT, 'pool', COMPONENT),
      display: `${REPO_BASE_PATH}/pool/${COMPONENT}/`,
      parent: '../',
    },
    {
      abs: path.join(OUT_ROOT, 'pool', COMPONENT, POOL_LETTER),
      display: `${REPO_BASE_PATH}/pool/${COMPONENT}/${POOL_LETTER}/`,
      parent: '../',
    },
    {
      abs: POOL_PKG_DIR,
      display: `${REPO_BASE_PATH}/pool/${COMPONENT}/${POOL_LETTER}/${PKG_NAME}/`,
      parent: '../',
    },
  ];

  for (const {abs, display, parent} of dirs) {
    await mkdir(abs, {recursive: true});
    await writeIndexForDir(abs, display, parent);
  }
}

function parseDebVersion(filename) {
  // Case-insensitive prefix so both `bastion-base_..._amd64.deb` and
  // `Bastion-base_..._amd64.deb` are accepted.
  const re = new RegExp(`^${PKG_FILE_PREFIX_LC}_(.+)_${ARCH}\\.deb$`, 'i');
  const m = filename.match(re);
  return m ? m[1] : '';
}

async function buildReleaseMeta(poolEntry) {
  const {path: debPath, info} = poolEntry;
  const st = await stat(debPath);
  const sha256 = info.deb.sha256 || (await sha256File(debPath));
  const version = parseDebVersion(path.basename(debPath));
  return {
    filename: path.basename(debPath),
    version,
    sizeBytes: st.size,
    sizeHuman: `${(st.size / (1024 * 1024)).toFixed(1)} MB`,
    sha256,
    poolRelativePath: path
      .relative(OUT_ROOT, debPath)
      .split(path.sep)
      .join('/'),
    publishedAt: info.publishedAt?.slice(0, 10) || '',
    tag: info.tag || '',
    releaseUrl: info.tag
      ? `https://github.com/${GITHUB_REPO}/releases/tag/${info.tag}`
      : `https://github.com/${GITHUB_REPO}/releases`,
    isLatest: false,
  };
}

async function main() {
  log(`Output: ${OUT_ROOT}`);

  let poolEntries;
  let latestInfo;

  if (SKIP_DOWNLOAD && !LOCAL_DEB) {
    // Offline mode: rebuild metadata from whatever .deb files already exist
    // in the pool, without wiping the tree or hitting the network.
    log('DEBIAN_REPO_SKIP_DOWNLOAD=1: reusing existing pool .deb files');
    await mkdir(DIST_BINARY, {recursive: true});
    poolEntries = await reuseExistingPoolDebs();
    latestInfo = poolEntries[0].info;
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

    // "latest" mirrors GitHub's /releases/latest: newest non-prerelease.
    latestInfo = releases.find((r) => !r.prerelease) || releases[0];
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

  await writeAllIndexes();

  const releaseMetas = [];
  for (const entry of poolEntries) {
    releaseMetas.push(await buildReleaseMeta(entry));
  }
  // Newest first by publish date (fall back to filename for offline mode).
  releaseMetas.sort((a, b) => {
    if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
      return b.publishedAt.localeCompare(a.publishedAt);
    }
    return b.filename.localeCompare(a.filename);
  });

  const latestFilename = latestInfo?.deb?.name || releaseMetas[0].filename;
  const latestMeta =
    releaseMetas.find((m) => m.filename === latestFilename) || releaseMetas[0];
  latestMeta.isLatest = true;

  const aptSourceLine = `deb [trusted=yes] ${REPO_BASE_URL} ${SUITE} ${COMPONENT}`;
  const meta = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    label: LABEL,
    suite: SUITE,
    component: COMPONENT,
    architecture: ARCH,
    packageName: PKG_NAME,
    repoBasePath: REPO_BASE_PATH,
    repoBaseUrl: REPO_BASE_URL,
    aptSourceLine,
    deb: {
      filename: latestMeta.filename,
      version: latestMeta.version,
      sizeBytes: latestMeta.sizeBytes,
      sizeHuman: latestMeta.sizeHuman,
      sha256: latestMeta.sha256,
      poolRelativePath: latestMeta.poolRelativePath,
      publishedAt: latestMeta.publishedAt,
    },
    releases: releaseMetas,
    github: {
      repo: GITHUB_REPO,
      tag: latestMeta.tag,
      releaseUrl: latestMeta.releaseUrl,
    },
    urls: {
      suiteIndex: `${REPO_BASE_URL}/dists/${SUITE}/`,
      release: `${REPO_BASE_URL}/dists/${SUITE}/Release`,
      packages: `${REPO_BASE_URL}/dists/${SUITE}/${COMPONENT}/${BINARY_DIR}/Packages`,
      poolPackageDir: `${REPO_BASE_URL}/pool/${COMPONENT}/${POOL_LETTER}/${PKG_NAME}/`,
    },
  };

  await writeFile(META_JSON, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  log(`Wrote ${META_JSON}`);
  log(
    `Indexed ${releaseMetas.length} release .deb(s); latest=${latestMeta.filename}`,
  );
  log(`APT source: ${aptSourceLine}`);
  log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
