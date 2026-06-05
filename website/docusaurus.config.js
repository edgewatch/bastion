// @ts-check

const organizationName = process.env.ORGANIZATION_NAME || 'edgewatch';
/** GitHub repo Docusaurus pushes to (`npm run deploy`); not the public URL path. */
const projectName = process.env.PROJECT_NAME || 'bastion';
const deploymentBranch = process.env.DEPLOYMENT_BRANCH || 'gh-pages';
/** Production custom domain; override for github.io-only project pages. */
const url = process.env.DOCS_URL || 'https://download.edgewatch.com';
const baseUrl = process.env.BASE_URL || '/';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Edgewatch Bastion Base',
  tagline: 'Download Debian packages and release artifacts for bastion-base.',
  url,
  baseUrl,
  organizationName,
  projectName,
  deploymentBranch,
  trailingSlash: false,
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: 'docs',
          sidebarPath: require.resolve('./sidebars.js'),
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        items: [],
      },
      footer: {
        style: 'dark',
        links: [],
        copyright: `Copyright © ${new Date().getFullYear()} Edgewatch Bastion.`,
      },
      prism: {
        additionalLanguages: ['bash', 'nginx'],
      },
    }),
};

module.exports = config;
