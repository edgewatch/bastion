/**
 * Apache-style "Index of /path/" HTML directory listings.
 */

function padEnd(str, width) {
  const s = String(str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatSize(bytes) {
  if (bytes == null || Number.isNaN(bytes)) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes}`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function formatMtime(mtime) {
  if (!mtime) {
    return '-';
  }
  const d = mtime instanceof Date ? mtime : new Date(mtime);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const day = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const year = d.getFullYear();
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (year === now.getFullYear()) {
    return `${day}-${mon}-${year} ${hh}:${mm}`;
  }
  return `${day}-${mon}-${year}  ${hh}:${mm}`;
}

/**
 * @param {object} options
 * @param {string} options.displayPath - e.g. /debian/bastion/dists/trixie/
 * @param {string} [options.parentHref] - e.g. ../
 * @param {Array<{name: string, href: string, mtime?: Date|string, size?: number|null, isDir?: boolean}>} options.entries
 */
export function renderApacheIndex({displayPath, parentHref, entries}) {
  const nameWidth = 55;
  const dateWidth = 20;
  const sizeWidth = 10;

  const header = `${padEnd('Name', nameWidth)}${padEnd('Last modified', dateWidth)}${padEnd('Size', sizeWidth)}`;

  const lines = [header];

  if (parentHref) {
    lines.push(
      `<a href="${parentHref}">${padEnd('../', nameWidth)}</a>${padEnd('-', dateWidth)}${padEnd('-', sizeWidth)}`,
    );
  }

  const sorted = [...entries].sort((a, b) => {
    const aDir = a.isDir ? 0 : 1;
    const bDir = b.isDir ? 0 : 1;
    if (aDir !== bDir) {
      return aDir - bDir;
    }
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const label = entry.isDir ? `${entry.name}/` : entry.name;
    const href = entry.href;
    const mtime = formatMtime(entry.mtime);
    const size =
      entry.isDir ? '-' : formatSize(entry.size ?? null);
    lines.push(
      `<a href="${href}">${padEnd(label, nameWidth)}</a>${padEnd(mtime, dateWidth)}${padEnd(size, sizeWidth)}`,
    );
  }

  const preBody = lines.join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Index of ${displayPath}</title>
  <style>
    body { font-family: monospace, ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace; margin: 1.5rem; }
    h1 { font-size: 1.25rem; font-weight: normal; }
    pre { line-height: 1.35; }
    a { color: #00e; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Index of ${displayPath}</h1>
  <hr>
  <pre>${preBody}</pre>
  <hr>
  <p><small>© 2026 Edgewatch Bastion - For more information please visit our <a href="https://edgewatch.com/kb/bastion/">Knowledge base</a>.</small></p>
</body>
</html>
`;
}
