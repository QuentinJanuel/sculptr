---
sidebar_position: 3
title: The contract
---

# The contract

`@sculptr/sculptr/contract` is what a patched game, the runtime and every host agree on. It is plain
TypeScript, means the same for both engines, and imports no backend.

## Identity and target

`ModIdentity` is `{ id, version }`. The installer supplies it; a bundle never declares it. The id is
globally unique and is hashed into the mod's channel and its mailbox, so two mods sharing one is a
real clash. The version is only ever compared, never parsed.

`ModTarget` is `{ engine }`: `"gm8"` for GameMaker 8, `"gms"` for GameMaker Studio. Treat a value
you do not recognise as "do nothing", so a mod keeps working if a finer target is added.

## The player

`ModPlayer`, what `api.getPlayer()` returns:

| Field      | Meaning                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| `account`  | `{ id, name }`, or `null` when nobody is signed in.                                         |
| `language` | A locale code, never null. See [the player's language](../../text.md#the-players-language). |
| `controls` | The player's bindings. See below.                                                           |

A host may add fields of its own; they pass through untouched. `noPlayer()` is nobody signed in.

## Controls

Seven actions: `up`, `down`, `left`, `right`, `confirm`, `cancel`, `retry`. Each is bound to a list
of `KeyboardEvent.code`s (physical keys), at most four, or to controller inputs written
`PadButton<n>` and `PadAxis<n>Plus`/`Minus` (standard-mapping indices). An empty list means the
player unbound that action.

`CANONICAL_CONTROL_KEYS` is the key each action is assumed to be in the game: arrows,
`ShiftLeft` (confirm), `KeyZ` (cancel), `KeyR` (retry). `defaultControls()` binds every action to
it, and `controlsAreDefault()` says whether nothing was rebound. `parseControls()` reads a stored
set, filling in a missing action from the default and refusing anything malformed.

## Files

`ModFiles.write(name, bytes, at)` writes a file where the game can read it and answers with the
path to hand to GML. See [sprites](../raw-resources/sprites.md).

## Settings

`ModSettings` is one mod's persisted settings: an opaque object the host stores and never reads
into, at most `MOD_SETTINGS_MAX_BYTES` (16 KiB) as JSON. `modSettingsFit()` checks it.

## Mailboxes

`modChannel(id)` is the mod's wire prefix: `m` and eight hex digits of an FNV-1a hash of its id. It
is derived, not assigned, so GML baked at patch time and JavaScript loaded later agree without
consulting each other. `modMailbox(id)` is the GML global (`global.__mod_box_<channel>`) holding the
mod's `ds_list` of incoming messages.

## The loader's runtime

`loaderRuntime(ids)` is the one object (`mod_runtime`) the loader installs ahead of the mods' own
whenever any mod declares a resource. It creates every mailbox and, in Begin Step, drains the
engine's queue into them. See [the channel](../game/channel.md).

`LOADER_ABI` (4) is the revision of the launch protocol a patched game speaks. `modBuildKey()`
fingerprints what the enabled mods bake into a game, together with the runtime object and
`LOADER_ABI`, or is `null` when they bake nothing: a host compares it to decide whether a patched
game is out of date.
