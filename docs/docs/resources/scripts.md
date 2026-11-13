---
sidebar_position: 2
title: Scripts
---

# Scripts

## Creating a new script

```ts
mod.resource.script.create({
  name: "clamp01",
  args: ["value"],
  body: ({ a }) => `return max(0, min(1, ${a.value}));`,
});
```

`a.value` is `argument0`, the next name `argument1`, and so on. A script name, like an argument
name, is letters, digits and `_`, starting with a letter, and two scripts of one mod cannot share
it.

Call it from any GML you generate with `call`:

```ts
mod.resource.object.create({
  // ...
  vars: ["input", "output"],
  events: {
    create: ({ v, call }) => `
      ${v.output} = ${call("clamp01", v.input)};
    `,
  },
});
```

## Changing existing code

There are two ways you can change a script code.

### Hooks

By wrapping code around using `hook`:

```ts
mod.resource.script.hook(
  "killPlayer",
  ({ original, send }) => `
  ${send("died")}
  return ${original.call()};
`,
);
```

The game's script runs this instead, and `original` is the body it replaced:

- `original.call()` calls it with the arguments this call received, up to 16;
  `original.call("0", "1")` calls it with those instead.
- `original.arg(index)` is one of this call's arguments as GML, and `original.argumentCount` how
  many there are.

Only the game's own scripts can be hooked, not builtins and not another mod's scripts. Several
hooks on one script chain in load order.

### Insertions

Or by splicing new GML around one statement found in the game's own code.

```ts
mod.resource.script.insert({
  at: someStatement,
  place: "after", // or "before"
  body: () => `show_message("hi");`,
});
```

`mod.content` contains the decompiled GML statements, use it to find what to hook or insert around.
For example, after the last statement of the game's `savedata_save` script:

```ts
const save = mod.content.scripts.find((script) => script.name === "savedata_save");
const last = save?.body.at(-1);
if (last?.at) {
  mod.resource.script.insert({
    at: last,
    place: "after",
    body: ({ send }) => send("saved"),
  });
}
```

`at` is the statement itself, taken from `mod.content`: one of the game's scripts, or of its
object events (`mod.content.events`). `place` is:

- `"before"` the statement starts;
- `"after"` it finishes, once on every way out of it (after a loop, once when the loop ends; point
  at the last statement of its body to run per iteration). Refused after an `exit`, which nothing
  follows;
- `"instead"`: the body runs and the statement does not. For an `if`, a loop or a `with`, that
  removes its whole body. Refused on GameMaker Studio.

The body sees `self`, `other`, globals and builtins, but not the game code's `var` locals or its
arguments. Insertions run even when a hook calls the original, and several at one statement run in
declaration order.

A statement the engine could not place (the parts of a `for` header, a compiler temporary) has no
`at`, and `insert` refuses it.
