/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorialSidebar: [
    'getting-started/install',
    {
      type: 'category',
      label: 'vhostctl',
      items: [
        'vhostctl/architecture',
        'vhostctl/rollout',
        'vhostctl/runbook',
      ],
    },
  ],
};

module.exports = sidebars;
