import React, {useState} from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  APT_SOURCE_LINE,
  DEBIAN_REPO_BASE_URL,
  EDGEWATCH_LOGO_URL,
} from '@site/src/data/download-config';
import {
  DEBIAN_SUITE_INDEX_URL,
  downloadSections,
  type DownloadArtifact,
} from '@site/src/data/downloads';
import {DEBIAN_REPO_READY} from '@site/src/data/debian-repo';
import styles from './index.module.css';

function resolveHref(href: string, baseUrl: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  const path = href.startsWith('/') ? href : `/${href}`;
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (!normalizedBase || normalizedBase === '/') {
    return path;
  }
  return `${normalizedBase}${path}`;
}

function DownloadCard({
  artifact,
  baseUrl,
  compact,
}: {
  artifact: DownloadArtifact;
  baseUrl: string;
  compact?: boolean;
}) {
  const [olderOpen, setOlderOpen] = useState(false);
  const hasOlder = artifact.olderVersions.length > 0;

  return (
    <article className={styles.card}>
      <div className={styles.cardInner}>
        <div className={styles.metaCol}>
          <h3 className={styles.filename}>{artifact.filename}</h3>
          <p className={styles.metaRow}>
            {artifact.size}
            {artifact.date !== '—' ? ` · ${artifact.date}` : ''}
          </p>
          <pre
            className={`${styles.shaBox} ${
              artifact.sha256Placeholder ? styles.shaBoxPlaceholder : ''
            }`}>
            {artifact.sha256}
          </pre>
        </div>
        <div className={styles.actionsCol}>
          <a
            className={styles.btnDownload}
            href={resolveHref(artifact.downloadHref, baseUrl)}
            {...(artifact.downloadHref.startsWith('http')
              ? {target: '_blank', rel: 'noopener noreferrer'}
              : {})}>
            Download
          </a>
          <div className={styles.secondaryRow}>
            {artifact.secondaryActions.map((action) => (
              <a
                key={action.label}
                className={styles.btnSecondary}
                href={resolveHref(action.href, baseUrl)}
                title={action.title}
                {...(action.href.startsWith('http')
                  ? {target: '_blank', rel: 'noopener noreferrer'}
                  : {})}>
                {action.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      {hasOlder && !compact && (
        <div className={styles.accordionWrap}>
          <button
            type="button"
            className={styles.accordionToggle}
            aria-expanded={olderOpen}
            onClick={() => setOlderOpen((open) => !open)}>
            <span>Show older versions</span>
            <span
              className={`${styles.accordionIcon} ${
                olderOpen ? styles.accordionIconOpen : ''
              }`}
              aria-hidden>
              ▼
            </span>
          </button>
          {olderOpen && (
            <div className={styles.accordionPanel}>
              {artifact.olderVersions.map((older) => (
                <div key={older.id} className={styles.olderCard}>
                  <DownloadCard
                    artifact={older}
                    baseUrl={baseUrl}
                    compact
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function Home(): React.ReactElement {
  const baseUrl = useBaseUrl('/');
  const year = new Date().getFullYear();

  return (
    <Layout
      title="Downloads"
      description="Download Edgewatch Bastion Base Debian packages and release artifacts.">
      <main className={styles.page}>
        <div className={styles.column}>
          <header className={styles.header}>
            <img
              className={styles.logo}
              src={EDGEWATCH_LOGO_URL}
              alt="Edgewatch"
              width={240}
              height={48}
            />
            <h1 className={styles.pageTitle}>Downloads</h1>
            <p className={styles.pageLead}>
              Official release artifacts for <strong>bastion-base</strong>{' '}
              (Debian 13 Trixie, amd64, component <code>main</code>). Install from the
              static Debian archive or download the <code>.deb</code> directly; verify
              SHA256 checksums before installing.
            </p>
          </header>

          <section className={styles.aptRepo}>
            <h2 className={styles.sectionTitle}>APT repository</h2>
            <p className={styles.sectionDesc}>
              Static archive at{' '}
              <a href={DEBIAN_REPO_BASE_URL}>{DEBIAN_REPO_BASE_URL}</a>
              {DEBIAN_REPO_READY ? (
                <>
                  {' '}
                  (<a href={DEBIAN_SUITE_INDEX_URL}>browse dists/trixie</a>)
                </>
              ) : (
                <> (run <code>npm run generate:debian-repo</code> before build)</>
              )}
              . Suite <code>trixie</code>, component <code>main</code>.
            </p>
            <pre className={styles.aptSource}>{APT_SOURCE_LINE}</pre>
            <p className={styles.aptHint}>
              Add to <code>/etc/apt/sources.list.d/bastion.list</code>, then{' '}
              <code>sudo apt update &amp;&amp; sudo apt install bastion-base</code>.
              The same source also serves{' '}
              <code>bastion-telemetry</code> (the node agent;{' '}
              <code>Depends: bastion-base, ca-certificates, debconf, csync2, certbot, fail2ban</code>):{' '}
              <code>sudo apt install bastion-telemetry</code>. See{' '}
              <Link to="/docs/getting-started/install">installation docs</Link>.
            </p>
          </section>

          {downloadSections.map((section) => (
            <section key={section.id} className={styles.section}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              <p className={styles.sectionDesc}>{section.description}</p>
              {section.artifacts.map((artifact) => (
                <DownloadCard
                  key={artifact.id}
                  artifact={artifact}
                  baseUrl={baseUrl}
                />
              ))}
            </section>
          ))}

          <section className={styles.linksSection}>
            <h2 className={styles.sectionTitle}>Links of interest</h2>
            <ul className={styles.linksList}>
              <li>
                <a
                  href="https://edgewatch.com/kb/bastion/"
                  target="_blank"
                  rel="noopener noreferrer">
                  Knowledge base
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/edgewatch/bastion"
                  target="_blank"
                  rel="noopener noreferrer">
                  Github repository
                </a>
              </li>
            </ul>
          </section>

          <footer className={styles.pageFooter}>
            Copyright © {year} Edgewatch Bastion.
          </footer>
        </div>
      </main>
    </Layout>
  );
}
