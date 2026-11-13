---
sidebar_position: 3
title: The SDK
---

# The SDK

[`@sculptr/sdk`](https://www.npmjs.com/package/@sculptr/sdk) is the central package for writing a mod: it lets you declare resources and talk to the running game without worrying about what GameMaker version you're targeting. The [mod template](https://github.com/QuentinJanuel/sculptr-mod-template) already depends on it; otherwise:

```bash
npm install @sculptr/sdk
```

At its core is a single function, `createMod`, which takes a callback where you declare everything
the mod needs:

```ts
import { createMod } from "@sculptr/sdk";

export default createMod((mod) => {
  // declare resources here
});
```

The callback runs synchronously. Declare everything before it returns: a declaration made later,
from a callback or after an `await`, throws.

## The `mod` object

| Member                                   | What it is                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `mod.engine`                             | `"gm8"` or `"gms"`: the two do not accept the same GML.                                                             |
| `mod.content`                            | The game's code, read-only. See [game code](./advanced/game/game-code.md).                                          |
| `mod.getPlayer()`                        | Who is playing. See [the player](./advanced/runtime/contract.md#the-player).                                        |
| `mod.onPlayerChange(handler)`            | Called when `getPlayer()` would now answer differently.                                                             |
| `mod.resource.object.create(spec)`       | Declares an [object](./resources/objects.md).                                                                       |
| `mod.resource.script.create(spec)`       | Declares a [script](./resources/scripts.md).                                                                        |
| `mod.resource.script.hook(name, wrap)`   | [Hooks](./resources/scripts.md#hooks) one of the game's scripts.                                                    |
| `mod.resource.script.insert(spec)`       | Runs GML [around one statement](./resources/scripts.md#insertions) of the game's code.                              |
| `mod.resource.sprite.create(name, opts)` | Declares a [sprite](./resources/sprites.md).                                                                        |
| `mod.call(script, ...args)`              | A GML call to one of this mod's scripts.                                                                            |
| `mod.scratchPath(name)`                  | A GML expression for a file path the game can write to and read back. Nothing deletes the file: delete it yourself. |
| `mod.on(event, handler)`                 | Receives an [event](./events.md) from the mod's GML.                                                                |
| `mod.send(event, payload?)`              | Sends an [event](./events.md) to the mod's GML.                                                                     |
| `mod.onStart(handler)`                   | Called once the game is running and can hear the mod.                                                               |
| `mod.ui`                                 | The mod's [panel](./panel.md).                                                                                      |

## The context

Every piece of GML you write is a function of a context:

- `engine`: `"gm8"` or `"gms"`.
- `send(event, expression?)`: a GML statement that sends an [event](./events.md) to the mod's
  JavaScript.
- `call(script, ...args)`: a GML expression calling one of this mod's scripts, by the name it was
  declared with. The arguments are GML. It is an expression, so add the `;` yourself. Naming a
  script the mod never declared throws.

An object's context adds `v`, its declared variables, and a script's adds `a`, its arguments. A hook
gets `original` instead.

The functions run after the callback returns, so a body may `call` a script declared after it.
`mod.call` is the same function, for code that has no context at hand; called directly in the
callback, it only knows the scripts declared so far.

## Other exports

- `walk(block)` yields every statement of a block, descending into branches, bodies and cases, as
  on [game code](./advanced/game/game-code.md#statements-and-expressions).
- `highestArgument(block)` is the highest constant argument index a block reads, or `-1`.
- `gameMakerKey(code)` turns a `KeyboardEvent.code` into a GameMaker key code, or `0` when there is
  none. Guard with `> 0` in the GML.
- `CONTROL_ACTIONS`, `CANONICAL_CONTROL_KEYS` and `isPadBinding(code)` read the player's
  [controls](./advanced/runtime/contract.md#controls).
- `pngSize(png)` reads a PNG's `{ width, height }`; `sliceImage(png, { x, y, width, height })`
  crops one into a new PNG, and needs a canvas.

The types of everything above are exported too.
