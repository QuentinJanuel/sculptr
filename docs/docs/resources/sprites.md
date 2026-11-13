---
sidebar_position: 3
title: Sprites
---

# Sprites

## Creating a new sprite

```ts
import cherry0 from "./sprites/cherry-0.png?inline";
import cherry1 from "./sprites/cherry-1.png?inline";

const cherry = mod.resource.sprite.create("cherry", { origin: { x: 10, y: 12 } });
void cherry.load([cherry0, cherry1]);
```

A sprite is being transmitted while the game is running to allow for dynamically loaded images. Therefore, the sprite isn't immediately ready and the `id` equals `-1` until it is. Check it before drawing:

```js
if (${cherry.id} >= 0) draw_sprite(${cherry.id}, 0, x, y);
```

The `?inline` imports turn each picture into a `data:` URI; the
[mod template](https://github.com/QuentinJanuel/sculptr-mod-template) is set up for them.

A sprite is declared in `createMod`'s callback and loaded with a picture whenever the mod likes.

- `id` is a GML expression holding the sprite's index, `-1` until a load has finished.
- `load(frames)` takes a list of pictures, each a URL, a `data:` URI or bytes, in PNG, JPEG or
  BMP. Several pictures become one frame each and must all be the same size. It resolves with the
  sprite's `{ width, height }` once the game has added it, and rejects if the game refuses the
  picture or does not answer within 15 seconds. It waits for the game to be running first, and
  loads run one at a time, in the order they were asked for.
- The options are `origin` (`{ x, y }`, default `{ 0, 0 }`), `frames` (how many frames each
  picture holds, laid out left to right; default `1`) and `maxSize` (scale any picture whose
  longest side is larger down to it).

The picture reaches the game as a file, so loading one needs a host that owns the game's files.
Combining several pictures, scaling, and handing a JPEG or BMP to GameMaker Studio (which gets a
PNG) draw on a canvas: the host's JavaScript must have `OffscreenCanvas` and `createImageBitmap`.
After a `game_restart()`, the SDK loads every sprite that had been loaded again.
