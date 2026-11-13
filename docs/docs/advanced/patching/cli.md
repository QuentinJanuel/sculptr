---
sidebar_position: 1
title: Command line
---

# Command line

```bash
npm install @sculptr/sculptr
```

The package carries both GameMaker libraries, so there is nothing else to build. It installs the
`sculptr` command, whose one command is `patch`:

```
sculptr patch <game> [--format gm8|gms] --mod <mod>... [--player <json>] --out <file>
sculptr patch <game> [--format gm8|gms] [--resources <file.json>] --out <file>
```

A game in, a new game out. `<game>` is a GameMaker 8 executable or a GameMaker Studio `data.win`.
`--format` overrides reading it off the file: a file that starts with `FORM` is a `data.win`,
anything else is taken for an executable. A self-contained GameMaker Studio export or an archive is
neither: run [GM-Unpack](https://www.npmjs.com/package/@sculptr/gm-unpack) on it first and patch the
game it writes.

A wrong combination of arguments prints the usage and exits 2. Any other failure prints
`<ErrorName>: <message>`, exits 1, and writes nothing, leaving an existing `--out` alone.

## `--mod`

Reads the game's code, runs every mod's `activate()` against it, and patches in what they declared
plus the loader's runtime object. A game they declare nothing for comes back unchanged.

Repeatable; mods install in the order given. Each is either:

- a bundle's URL or path, installed under that string as its id, version `0.0.0`;
- or a [`ModSource`](../runtime/bundles.md) as JSON, `{"id", "version", "url"}`.

Only `http(s)` URLs are fetched; anything else is read as a path.

```bash
sculptr patch game.exe --mod ./hello.js --out modded.exe
sculptr patch data.win --mod '{"id":"hello","version":"1.0.0","url":"./hello.js"}' --out modded.win
```

A mod built from the [mod template](https://github.com/QuentinJanuel/sculptr-mod-template) is
patched with its bundle, `dist/index.js`. The patched game holds the mods' GML, ready to run like
the original; their JavaScript runs in a host built on the
[runtime](../runtime/api.md#running-mods-in-a-host), which the game dials over
[the channel](../game/channel.md) when launched with the channel's arguments. `patch` itself
launches nothing. Mods declare resources at patch time: after you edit a mod's resources, patch the
original game again.

## `--player`

Who is playing, as the [`ModPlayer`](../runtime/contract.md#the-player) JSON that `activate()` reads. Left
out, nobody is signed in.

```bash
sculptr patch data.win --mod ./hello.js --player '{"account":{"id":"1","name":"Kid"},"language":"fr"}' --out modded.win
```

`account` is `null` or `{ id, name }`, `language` a locale code (`"en"` when left out), `controls`
the [bindings](../runtime/contract.md#controls) per action. Any other field passes to the mods untouched.

## `--resources`

Installs a JSON list of [resources](../raw-resources/objects.md) as they are, with no mod and no runtime
object. Left out along with `--mod`, nothing is installed.

```json title="resources.json"
[
  { "kind": "script", "name": "hello_greet", "source": "show_debug_message(\"hello\");" },
  { "kind": "object", "name": "hello_obj", "events": { "create": "hello_greet();" } }
]
```

```bash
sculptr patch data.win --resources resources.json --out res.win
```

`--resources` and `--mod` cannot be combined.

## Errors

A mod that fails to activate names itself:

```
Error: mod ./broken.js failed to activate: mod ./broken.js: cannot hook "no_such_script", which is not one of this game's scripts
```

A game the backend cannot read, or resources it refuses, fail with `PatchFailed`:

```
PatchFailed: mod patch: could not read this game: invalid exe header
```
