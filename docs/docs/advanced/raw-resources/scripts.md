---
sidebar_position: 2
title: Scripts, hooks and insertions
---

# Scripts, hooks and insertions

:::note
This is the raw `api.resource.create()` form that the SDK writes for you. Writing a mod with the SDK? See [Scripts](../../resources/scripts.md) and `mod.resource.script` instead.
:::

## A new script

```js
api.resource.create({
  kind: "script",
  name: "clamp_mod_01",
  source: "return max(0, min(1, argument0));",
});
```

Callable by name from any GML: `clamp_mod_01(x / room_width)`. Arguments arrive as `argument0`,
`argument1`, and so on.

A script shadows a builtin of the same name for the whole game, and `activate()` refuses a name the
game already uses. Prefix it.

## Hooking one of the game's scripts

```js
api.resource.create({
  kind: "hook",
  script: "savedata_save",
  original: "hook_mod_savedata_save",
  source: `${api.gml.send('"saving"')}
return hook_mod_savedata_save();`,
});
```

The game's script keeps its name, so every call to it now runs `source`. Its original body moves,
untouched, to a new script called `original`, which `source` calls when it wants the game's
behaviour. Several hooks on one script chain in load order. Only the game's own scripts can be
hooked, not builtins and not another mod's scripts.

## Inserting around one statement

```js
const save = api.game.scripts.find((script) => script.name === "savedata_save");
api.resource.create({
  kind: "script",
  name: "insert_mod_saved",
  source: 'show_debug_message("saved");',
});
api.resource.create({
  kind: "insert",
  at: save.body[save.body.length - 1].at,
  place: "after",
  call: "insert_mod_saved",
});
```

`at` is the token of a statement in [the game's code](../game/game-code.md). `place` is:

- `"before"` the statement starts;
- `"after"` it finishes, once on every way out of it (after a loop, once when the loop ends). Refused
  after an `exit`;
- `"instead"`: the call runs and the statement does not. For an `if`, a loop or a `with`, that
  removes its whole body. Refused on GameMaker Studio.

`call` names a script the same mod declared. It takes no arguments and its return value is
discarded; it sees `self`, `other`, globals and instance variables, never the host script's
locals. Insertions are installed before hooks, so an insertion still runs when a hook calls the
original. Several at one place run in declaration order.

A statement without an `at` (the parts of a `for` header, a compiler temporary) cannot be inserted
around, and `activate()` says so.
