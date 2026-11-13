---
sidebar_position: 3
title: Sprites
---

# Sprites

:::note
This is the raw route that the SDK's sprites are built on. Writing a mod with the SDK? See [Sprites](../../resources/sprites.md) and `mod.resource.sprite.create` instead.
:::

There is no sprite resource: a mod installs objects, scripts, hooks and insertions only. A picture
reaches the game as a file instead, written at run time and loaded from GML:

1. The mod's GML sends the directory the game reads files from (for example `working_directory`).
2. The JavaScript writes the bytes there with `api.files.write(name, bytes, at)`, where `at` is
   that directory, and sends back the path it answers with.
3. The GML loads that path with `sprite_add`.

`name` is letters, digits, `.`, `-` and `_`, and is namespaced per mod: two mods writing
`cherry.png` get two files. The path that comes back is meaningful to the game, not to the host;
hand it to GML as it is.

Writing a file needs a host that owns the game's files. Without one, `api.files.write` rejects.

[The SDK](../../resources/sprites.md) builds a sprite resource on this route.
