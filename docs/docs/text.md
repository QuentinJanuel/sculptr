---
sidebar_position: 7
title: Drawing text
---

# Drawing text

`draw_text` draws with the _game's_ font, which doesn't cover Chinese characters, Japanese, Russian, etc.

If you need that, you can use the package `@sculptr/text`, which renders the text in the mod's JavaScript and hands the result back to the game as a picture. It can also let you import fonts easily.

```bash
npm install @sculptr/text
```

```ts
import { createMod } from "@sculptr/sdk";
import { initText } from "@sculptr/text";
import fredoka from "./fonts/fredoka.woff2?inline";

export default createMod((mod) => {
  const { drawText, createText } = initText(mod, { fonts: { fredoka } });
  const hello = createText("こんにちは", { font: "fredoka", size: 16 });

  mod.resource.object.create({
    name: "hud",
    events: {
      draw: () => `
        draw_set_color(c_yellow);
        ${drawText("8", "8", hello)}
      `,
    },
  });
});
```

`@sculptr/text` needs `@sculptr/sdk` 2.16 or a later 2.x. It draws the picture through a
[sprite](./resources/sprites.md), and works on both engines.

## `initText`

Call `initText(mod, options)` once, inside `createMod`'s callback. It returns:

- `createText(text, style)`: an ASCII stand-in for `text`. The real string stays in the
  JavaScript, so the game's text encoding cannot mangle it. `style` is `font`, `size` in pixels
  (default `12`), `wrap` (a width in pixels, `0` for one line, the default), `align` (`"left"`,
  `"center"`, `"right"`) and `valign` (`"top"`, `"middle"`, `"bottom"`). `#` and newlines break
  lines, as in GML; `\#` is a literal `#`.
- `drawText(x, y, text)`: a GML statement that draws it, with the colour and alpha the game has set
  (`draw_set_color`, `draw_set_alpha`). `text` is a stand-in, or GML that evaluates to one: for
  text that changes, `mod.send` the stand-in as an [event](./events.md) and draw the variable the
  game keeps it in. A string the game built itself works too, in the default style, read as UTF-8,
  or as Windows-1252 when it is not valid UTF-8.
- `textWidth(text)` and `textHeight(text)`: GML expressions for the picture's size, `0` until it
  is ready.

`options.fonts` maps names to fonts the mod ships, as the font file's bytes or a URL. A name is
letters, digits, `-` and `_`. Characters a font lacks, and text with no `font`, are drawn in the
host's system font.

## Limits

- Only text drawn through `drawText` changes: the game's own `draw_text` calls still use the game's
  fonts.
- The first draw of a string shows nothing until its picture has been made and loaded, so it suits
  text that changes now and then, not every frame: a counter belongs in `draw_text`.
- Font, size, wrapping and alignment come from `createText`, not from `draw_set_font` or
  `draw_set_halign`. The text is drawn unscaled and unrotated.
- A mod holds 32 pictures, and the least recently drawn is reused. When more than 32 different
  strings are drawn in one frame, some are not drawn, and the JavaScript console warns once.
- A string the game stores in another encoding (Shift-JIS, for example) comes out as the wrong
  characters.
- It needs a host that owns the game's files, as every sprite does, and whose JavaScript has
  `OffscreenCanvas`; shipped fonts also need `FontFace`.

## The player's language

`mod.getPlayer().language` is the player's locale code (`"en"`, `"pt-BR"`, ...), `"en"` when the
host did not say. It is never null. Resolve a code your mod has no translation for to your own
default rather than refusing to draw: a host can ship a language before your mod does.

```ts
export default createMod((mod) => {
  const words: Record<string, string> = { en: "Deaths", fr: "Morts" };
  const label = words[mod.getPlayer().language] ?? words.en;
  mod.resource.object.create({
    name: "lang",
    events: { draw: () => `draw_text(view_xview[0] + 8, view_yview[0] + 8, "${label}");` },
  });
});
```

The language is pinned while `createMod`'s callback runs, so what a mod declared from it cannot
change. When it changes while the game runs, `mod.onPlayerChange` is called, and the mod can send
the game new words as an [event](./events.md).
