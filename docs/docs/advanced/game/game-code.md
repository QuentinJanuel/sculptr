---
sidebar_position: 2
title: Game code
---

# Game code

`api.game` is the game's own code as a mod sees it. A host gets the same JSON from the library's
`gameCode(format, bytes)` and checks it with `parseGameCode` from `@sculptr/sculptr/game-code`. It is for finding things, never for printing back into GML: what a summary cannot model
collapses into `{ "k": "unknown" }`. To run the game's code, hook or insert around it.

| Field     | What it holds                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`  | `4`. A loader refuses any other.                                                                                                                      |
| `scripts` | `{ name, body }` per script.                                                                                                                          |
| `objects` | `{ name, events }`, with only the six events a mod object can carry.                                                                                  |
| `events`  | Every event every object declares, as `{ name, body }`, named `<object>.<event>` in the engine's own words (`world.KeyPress_82`).                     |
| `rooms`   | Room creation code (`<room>.room`) and instance creation code (`<room>.instance_<id>`), with `room` and `object`.                                     |
| `sounds`  | `{ name, exclusive }`. `exclusive` is true for a GameMaker 8 sound played through the single music slot, which stops whatever else was playing there. |

`events` and `rooms` are empty on a backend that cannot address them, which is not the same as a
game with none.

## Statements and expressions

A body is a list of statements, `k` being its kind: `assign`, `call`, `if`, `with`, `loop`,
`switch`, `exit` or `unknown`. Dialects are normalised, so a mod never asks which engine produced a
node: GameMaker 8's `=` in an expression is `==`, `and` is `&&`, `argument0` and `argument[0]` are
both `{ "k": "arg", "index": 0 }`, and a name that is one of the game's assets is an `asset`.

```json
{
  "at": "savedata_default#s,20,48",
  "k": "call",
  "call": {
    "k": "call",
    "kind": "script",
    "name": "savedata_select",
    "args": [{ "k": "arg", "index": 0 }]
  }
}
```

`at` is an opaque token naming the statement, for an [insertion](../raw-resources/scripts.md). It is only
good for the game it came from and for this run: compare it as a string, and never store it.
Statements the backend cannot locate have none.

`walk(block)` from `@sculptr/sculptr/game-code` yields every statement of a block, descending into branches,
bodies and cases. A bundle is one file, so a mod that uses it bundles it in.
