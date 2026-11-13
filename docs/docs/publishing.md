---
sidebar_position: 8
title: Publishing
---

# Publishing

A mod is published as an npm package whose `main` is its [bundle](./advanced/runtime/bundles.md). The
[mod template](https://github.com/QuentinJanuel/sculptr-mod-template) is set up that way:
`npm run build` writes the bundle to `dist/index.js`, which is its `main`.

Before the first release, set `name`, `version`, `displayName` and `description` in
`package.json` to your own, and remove `"private": true`, which makes npm refuse to publish. Keep
`@sculptr/sdk` in `dependencies`, as the template does, so the package says which SDK it is built
with. Then:

```bash
npm run build
npm login
npm publish
```

A scoped name (`@you/my-mod`) needs `npm publish --access public` the first time.

An npm package fits a [`ModSource`](./advanced/runtime/bundles.md): the package name is a unique id, npm refuses to
publish a version twice, and a CDN serving npm packages gives each version's `main` a URL. A host
that names mods this way sees a renamed package as a different mod.

`displayName` and `description` are for people. sculptr reads neither, but a host that lists mods
from npm can show `displayName` in place of the package name.
