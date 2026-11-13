---
sidebar_position: 1
title: Objects
---

# Objects

## Creating a new object

You can create new GameMaker objects:

```ts
mod.resource.object.create({
  name: "hud",
  persistent: true,
  // Before writing new GML, you can register variables here
  // this is useful as it will automatically add prefixes to it
  // so you don't risk name collisions with games or other mods.
  vars: ["count"],
  events: {
    create: ({ v }) => `${v.count} = 0;`,
    step: ({ v, send }) => `
      if (keyboard_check_pressed(ord("H"))) {
        ${v.count} += 1;
        // Send a GML -> JS event
        ${send("bumped", `string(${v.count})`)}
      }
    `,
    draw: ({ v }) => `draw_text(8, 8, "count: " + string(${v.count}));`,
  },
  // React to a JS -> GML event
  receive: {
    reset: ({ v }) => `${v.count} = 0;`,
  },
});
```

The object is installed into the game with one instance of it placed in the game's first room.

| Field        | Meaning                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Prefixed for you, so a simple name is fine.                                                                                             |
| `vars`       | Instance variables. `v.count` is the renamed variable, safe from the game's own names. Letters, digits and `_`, starting with a letter. |
| `events`     | One function per event: `create`, `destroy`, `beginStep`, `step`, `endStep`, `draw`. An event left out is not created.                  |
| `receive`    | GML to run for each event the JavaScript sends. See [events](../events.md#javascript-to-gml).                                           |
| `depth`      | Lower draws later, on top. Defaults to a large negative number: a mod object is usually an overlay.                                     |
| `persistent` | Survives a room change. Defaults to `true`.                                                                                             |
| `visible`    | Defaults to `true`. A `false` object still steps but draws nothing.                                                                     |

There is no Draw GUI event: GameMaker 8 has none. Draw in `draw`, at view-relative coordinates
(`view_xview[0] + 8`) in a game that uses views.

A bare variable you did not declare in `vars` shares the game's namespace: it is resolved against
the game's assets first, so `hud = 1` does not compile in a game that has an asset called `hud`,
and the same goes for `var` locals.
