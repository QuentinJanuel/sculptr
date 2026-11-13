---
sidebar_position: 5
title: The panel
---

# The panel

A mod can put its own control panel beside the game, in the host's window. This can be useful for putting configuration settings or visual cues that wouldn't fit inside the game area.

```ts
export default createMod((mod) => {
  const key = mod.ui.state("KeyH", { persist: "hitKey" });
  const hits = mod.ui.state(0);

  mod.ui.panel({ title: "My mod" }, (ui) => [
    ui.section({ title: "Controls" }, [
      ui.keybind({ label: "Do the thing", value: key }),
      ui.text(() => `${hits.value} so far`, { tone: "muted" }),
      ui.button({ label: "Reset", onClick: () => (hits.value = 0) }),
    ]),
  ]);
});
```

The mod describes the panel as data; the host renders it with its own components and owns how it
looks. A panel needs a host with a window to render it: the patched game knows nothing about it.

`panel()` is only valid inside `createMod`'s callback. A mod may declare several; the host shows
the mod's name beside each panel's title.

## States

States are variables that will automatically trigger re-renders when their value gets updated. They function like Vue `ref`s and `computed`s.

```ts
const name = mod.ui.state("world", { persist: "name" });
const greeting = mod.ui.computed(() => `hello ${name.value}`);

name.value = "there"; // will trigger a re-render
```

`persist` keeps the value under that key in the mod's settings, which the host stores. With a host
that stores none, every value starts from its default.

Texts, labels, values and `disabled` take a fixed value, a `state`, a `computed`, or a function
of them.

## Nodes

- Layout: `section`, `row`, `col`, `grid`, `scroll`, `separator`, `spacer`.
- Display: `text`, `badge`, `progress`.
- Controls: `button`, `toggle`, `input`, `select`, `keybind`. A control bound to a `state` writes
  it back; `onClick`, `onChange` and `onSubmit` are there for anything else.
- Regions: `dynamic(fn)` re-runs when what it reads changes; `each(source, render, { key })` is a
  keyed list.

A node says what it is (`tone: "danger"`, `variant: "primary"`), never how it looks: there are no
colours, sizes or CSS. `keybind` holds a `KeyboardEvent.code`, `""` when unbound.
