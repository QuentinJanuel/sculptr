---
sidebar_position: 1
slug: /
title: Introduction
---

# sculptr

:::note
This documentation is not yet complete, but it should still give you enough context to play around the mod loader and create your first mods!
:::

sculptr is a mod loader that lets you define a mod once. It supports GameMaker 8.x games as well as GameMaker Studio games, whether they are emulated to run in the browser or not.

A mod is written in JavaScript. This language was chosen because it has to work in a browser.

The mod can install resources only at build time (objects, scripts, ...), but you can then communicate between your new resources and JavaScript at runtime by sending events.

### Start from the template

The quickest way to write a mod is the
[mod template](https://github.com/QuentinJanuel/sculptr-mod-template): a working mod in TypeScript,
ready to build. [Getting started](./getting-started.md) walks through it.

### Quick demo

```ts
import { createMod } from "@sculptr/sdk";

export default createMod((mod) => {
  mod.resource.object.create({
    name: "greeter",
    persistent: true,
    events: {
      create: ({ send }) => send("hello", "string(room)"),
    },
  });
  mod.on("hello", (room) => console.log(`hello from room ${room}`));
});
```
