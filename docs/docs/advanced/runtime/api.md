---
sidebar_position: 1
title: The mod API
---

# The mod API

A mod bundle default-exports one function, `activate(api)`, or an object `{ activate }`. The host
calls it once, before the game exists, with the API object. That object is the whole surface a mod
is written against. Its type is `ModApi`, exported by `@sculptr/sculptr/runtime` in this repository.

```js
export default function activate(api) {
  // declare resources and subscribe to events here
}
```

| Member                                            | What it is                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `api.identity`                                    | `{ id, version }`: who the installer says this mod is. See [bundles](./bundles.md).                            |
| `api.target`                                      | `{ engine }`, `"gm8"` or `"gms"`. The two engines do not accept the same GML, so read it before declaring any. |
| `api.game`                                        | The game's code, read-only. See [game code](../game/game-code.md).                                             |
| `api.getPlayer()`                                 | Who is playing. See [the player](./contract.md#the-player).                                                    |
| `api.resource.create(resource)`                   | Declares a [resource](../raw-resources/objects.md). Only during `activate()`.                                  |
| `api.gml.send(expr)`, `api.gml.receive(variable)` | GML that reaches this mod's JavaScript. See [the channel](../game/channel.md).                                 |
| `api.send(message)`                               | Sends a string to this mod's GML.                                                                              |
| `api.on(event, handler)`                          | `"message"`, `"start"` or `"player"`. Any other name throws.                                                   |
| `api.files.write(name, bytes, at)`                | Hands a file to the game. See [sprites](../raw-resources/sprites.md).                                          |
| `api.ui`                                          | This mod's [panel](../../panel.md) and the reactive values behind it.                                          |

## Mods written with the SDK

[`createMod(init)`](../../sdk.md) returns `{ activate }`, so an SDK mod loads like any other. When
the host calls `activate(api)`, the SDK calls `init(mod)` once, then turns what it declared into
[resources](../raw-resources/objects.md) with `api.resource.create()`. Everything on this page
still applies: the two phases, what `activate()` refuses, and what each capability needs from the
host. As for any bundle, the SDK is bundled into the mod's one file.

What it adds:

- **Names.** Every object, script, sprite and declared variable is renamed with a prefix derived
  from the mod's id, so a mod writes `name: "main"` without prefixing it itself.
- **Events.** Named events with a string payload, in both directions, instead of raw channel
  messages. See [events](../../events.md).
- **GML as functions.** An event body, a script body, a hook or an insertion is a function that is
  handed what it needs (`send`, `call`, `engine`, the declared variables) and returns GML.
- **Sprites** the mod fills with a picture while the game runs.

Several `mod` members are this API under another name: `mod.engine` is `api.target.engine`,
`mod.content` is `api.game`, `mod.getPlayer()` is `api.getPlayer()`, `mod.onPlayerChange(handler)`
is `api.on("player", handler)`, `mod.onStart(handler)` is `api.on("start", handler)`, and `mod.ui`
is `api.ui`, unchanged.

## Two phases

1. **Activate.** Every mod's `activate()` runs against the game's code, before the game is built.
   Resources are declared here and only here: `resource.create()` after `activate()` returns
   throws. Messages sent now are queued.
2. **Run.** The game starts and connects. Queued messages are delivered in order, then every
   `"start"` handler runs. Messages from the game reach the `"message"` handlers.

A mod that waits for an answer from the game starts its clock in `"start"`, not in `activate()`:
before `"start"`, it would also be timing the engine's startup.

## Events

- `api.on("message", (message) => ...)`: one string from this mod's GML. No other mod's traffic
  arrives here.
- `api.on("start", () => ...)`: the game exists and can answer. Registering after that calls the
  handler straight away.
- `api.on("player", (player) => ...)`: `getPlayer()` would now answer differently. Never fired
  during `activate()`.

A handler that throws is reported and skipped; the game and the other mods keep running.

## What `activate()` refuses

The mod is named in every error, and the install stops:

- the same mod id loaded twice, or two ids whose [channels](./contract.md#mailboxes) collide;
- a resource whose name another mod already installed;
- a script whose name the game already uses (use a hook);
- a hook on something that is not one of the game's scripts, or whose `original` the game already
  uses;
- an insertion with no `at`, a `place` other than `before`, `after` or `instead`, an `at` from
  another game, or a `call` naming a script this mod did not declare.

## Capabilities

What the runtime can offer a mod depends on the host it runs in:

- **The channel** (`api.send`, `api.on("message")`, `api.on("start")`) needs a host attached to
  the running game.
- **`api.ui.panel`** needs a host with a window to render it. The runtime only describes the panel.
- **`api.files.write`** needs a host that owns the game's files. With none, it rejects.
- **Persisted settings** need a host that stores them. With none, every value starts from its
  default.
- **`api.on("player")`** fires only when the host changes the player while the game runs.

## Running mods in a host

`@sculptr/sculptr/runtime` is the library a host is built on:

1. `importMods(sources)` fetches and evaluates each [`ModSource`](./bundles.md);
2. `ModHost.load(mods, { engine }, game, player, options)` runs every `activate()` and holds what
   they declared. `installed` is what to patch into the game; `options` hands down the host's
   files and settings store;
3. once the game is running, `attach(transport)` connects [the channel](../game/channel.md), and
   `pump()` delivers the game's messages, once per frame;
4. `ui`, `onUiPatch` and `dispatchUi` carry the [panels](../../panel.md) to the host's renderer and the
   player's input back; `setPlayer` moves `getPlayer()`.

Load the mods with the same player and the same original game's code as the patch did, or the GML
and the JavaScript disagree about what was declared.

## Rendering a panel yourself

`@sculptr/sculptr/panel` draws every loaded mod's panels into an element of your page,
unstyled, and keeps them live:

```js
import { renderPanels } from "@sculptr/sculptr/panel";

renderPanels(document.getElementById("panels"), host);
```

`host` is a `ModHost` from `@sculptr/sculptr/runtime`, or anything with its `ui`, `onUiPatch` and
`dispatchUi`. Clicks, toggles, text and keys go back to the mod; its changes update the page. A
node kind the renderer does not know is drawn as `[unsupported panel node: <kind>]`, and the rest
of the panel still works.
