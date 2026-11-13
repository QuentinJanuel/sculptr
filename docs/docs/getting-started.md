---
sidebar_position: 2
title: Getting started
---

# Getting started

## 1. Start from the template

First, you will need a copy of the
[mod template](https://github.com/QuentinJanuel/sculptr-mod-template). Either press **Use this
template** on its GitHub page to make your own repository from it, or copy it without its git
history:

```bash
npx degit QuentinJanuel/sculptr-mod-template my-mod
cd my-mod
npm install
```

The mod is in `src/index.ts`.

## 2. Run it

To use it in dev mode, simply run

```bash
npm run dev
```

This builds `dist/index.js` in watch mode and serves it on `http://localhost:8080`.

`npm run build` builds `dist/index.js` once, and `npm run typecheck` checks the types.

## 3. Load it into a game

In a host that runs sculptr mods, add a dev mod pointing at `http://localhost:8080/index.js`, then
start a game with your mod enabled.

The template's mod draws Japanese text, animates a sprite in the middle of the screen, and answers
<kbd>H</kbd> with a message box.

To patch a game file with `dist/index.js` yourself, see the
[command line](./advanced/patching/cli.md).

:::note
While the mod is launched on watch mode, you will still need to quit and reopen a game to see the changes as mods need to do operations at build time.
:::
