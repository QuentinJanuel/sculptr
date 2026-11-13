---
sidebar_position: 2
title: Mod bundles
---

# Mod bundles

A mod is distributed as a bundle: **one** ES module, served from any URL or kept as a file. It
default-exports `activate`, or an object `{ activate }`. It is evaluated as a single module, so
relative imports inside it resolve nowhere: bundle everything it uses into that one file.

A bundle says nothing about who it is. A host names it with a `ModSource`:

```json
{ "id": "hello", "version": "1.0.0", "url": "https://example.com/hello.js" }
```

- `id` is globally unique. The mod's channel is derived from it, so the GML patched into a game
  only reaches JavaScript loaded under the same id.
- `version` changes on every release; a new one makes a patched game out of date.
- `url` is where the bundle is.

`sculptr patch --mod` takes a `ModSource` as JSON, or a bare URL or path, which it installs under
that string as its id, version `0.0.0`. See the [command line](../patching/cli.md#--mod).

A package registry fits this naturally: its package name is a unique id, its version changes on
every publish, and a CDN in front of it gives each version a URL.
