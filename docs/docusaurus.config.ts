import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "sculptr",
  tagline: "Mods for GameMaker games",

  // The real origin: it builds the absolute URLs in the sitemap.
  url: "https://quentinjanuel.github.io",
  baseUrl: "/sculptr/",

  onBrokenLinks: "throw",

  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          // Docs-only site: the guides are the site, so there is no landing page to keep in sync.
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "sculptr",
      items: [{ type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" }],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      // Not bundled by default, and the install and CLI snippets are shell.
      additionalLanguages: ["bash"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
