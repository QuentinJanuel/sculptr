---
sidebar_position: 1
title: Objects
---

# Objects

:::note
This is the raw `api.resource.create()` form that the SDK writes for you. Writing a mod with the SDK? See [Objects](../../resources/objects.md) and `mod.resource.object.create` instead.
:::

```js
api.resource.create({
  kind: "object",
  name: "counter_mod",
  events: {
    create: "counter_mod_count = 0;",
    step: `if (keyboard_check_pressed(ord("H"))) {
      counter_mod_count += 1;
      ${api.gml.send("string(counter_mod_count)")}
    }`,
    draw: 'draw_text(view_xview[0] + 8, view_yview[0] + 8, "count: " + string(counter_mod_count));',
  },
});
```

The object is installed into the game and one instance of it is placed in the game's first room.

| Field        | Meaning                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | The asset name, which the game's own GML sees too. Prefix it with something only this mod uses.                                                               |
| `events`     | GML source per event: `create`, `destroy`, `beginStep`, `step`, `endStep`, `draw`. These six mean the same on both engines; an event left out is not created. |
| `depth`      | Lower draws later, on top. Defaults to a large negative number: a mod object is usually an overlay.                                                           |
| `persistent` | Survives a room change. Defaults to `true`.                                                                                                                   |
| `visible`    | Defaults to `true`. A `false` object still steps but draws nothing.                                                                                           |

There is no Draw GUI event: GameMaker 8 has none. Draw in `draw` at view-relative coordinates.

## Names

Your GML shares the game's namespace. A bare instance variable is resolved against the game's
assets first, so `hud = "x"` does not compile in a game that has an asset called `hud`, and the same
goes for `var` locals. Prefix every variable too: `counter_mod_count`, not `count`.

`activate()` refuses a resource name another mod already installed.
