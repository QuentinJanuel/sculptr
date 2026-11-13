---
sidebar_position: 2
title: Library
---

# Library

`@sculptr/sculptr` is the same patcher as the [command line](./cli.md), as JavaScript. It runs in
Node and in a browser worker: each GameMaker backend is loaded on first use, relative to the
module.

```js
import {
  gameCode,
  patch,
  parseGameCode,
  PatchFailed,
  prepare,
  UnsupportedFormat,
} from "@sculptr/sculptr";
```

- `patch(format, bytes, resources)` resolves with the game with `resources` installed. `format` is
  `"gm8"` for a GameMaker 8 executable or `"gms"` for a GameMaker Studio `data.win`, and
  `resources` is a list of [resources](../raw-resources/objects.md).
- `gameCode(format, bytes)` resolves with the game's code as JSON; `parseGameCode(json)` checks it
  and returns it as [`api.game`](../game/game-code.md).
- `prepare(format)` starts loading a backend ahead of the first call.

A format other than `"gm8"` and `"gms"` rejects with `UnsupportedFormat`; a game or resource the
backend refuses rejects with `PatchFailed`.

## Patching mods in

`patch` takes resources, not mods. To patch mods in, run their `activate()` with the
[runtime](../runtime/api.md#running-mods-in-a-host) and patch what they declared, as
`sculptr patch --mod` does:

```js
import { readFile, writeFile } from "node:fs/promises";
import { gameCode, parseGameCode, patch } from "@sculptr/sculptr";
import { asModActivate, ModHost } from "@sculptr/sculptr/runtime";

const bytes = new Uint8Array(await readFile("data.win"));
const mod = {
  identity: { id: "hello", version: "1.0.0" },
  activate: asModActivate(await import("./hello.js"), "./hello.js"),
};
const game = parseGameCode(await gameCode("gms", bytes));
const { installed } = ModHost.load([mod], { engine: "gms" }, game);
await writeFile("modded.win", installed.length > 0 ? await patch("gms", bytes, installed) : bytes);
```

`asModActivate` reads `activate` out of whatever the bundle exported, and throws when it finds
none. In a browser, `importMods` fetches and evaluates [`ModSource`](../runtime/bundles.md)s
instead.

## Serving the JavaScript in Node

`serve(backends, format, bytes, mods, player)` from `@sculptr/sculptr/serve` (Node only) is the
other half of a mod: its JavaScript. Given the game and the same mods and player it was patched
with, it runs every `activate()`, listens on loopback, and resolves to `{ port, args, close }`,
`args` being what to launch the patched game with. The game dials in, and its messages reach the
mods' handlers and their replies reach the game until `close()`. `backends` is an object with
`gameCode`, such as the `@sculptr/sculptr` module itself.

There is no window, so a mod that declares a panel is refused with `UnsupportedCapability`, and
`files.write` rejects the same way. sculptr launches nothing itself.
