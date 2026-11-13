# sculptr

Takes a GameMaker game file and the resources mods declare, and returns a modded
game file. Library and CLI, plus the mod runtime (`@sculptr/sculptr/runtime`). Depends on
[gm8-lib](https://github.com/QuentinJanuel/gm8-lib) and
[gms-lib](https://github.com/QuentinJanuel/gms-lib).

```sh
npm install @sculptr/sculptr
```

```js
import { patch, gameCode, UnsupportedFormat, PatchFailed } from "@sculptr/sculptr";

const modded = await patch("gm8", exeBytes, resources); // or "gms" with a data.win
```

```
sculptr patch <game> --mod <mod>... [--player <json>] --out <file>
sculptr patch <game> [--resources <file.json>] --out <file>
```

`<game>` is a GameMaker 8 executable or a Studio data.win; `--format gm8|gms` overrides reading
it off the file. `patch --mod` loads each mod, runs its `activate()` against the game's code, and
patches in what the mods declared plus the loader's runtime object; a game they declare nothing
for comes back unchanged. `--mod` repeats, in install order, and is a bundle's URL or path
(installed under that string as its id, version `0.0.0`) or a `ModSource` as JSON,
`{"id", "version", "url"}`. Only http(s) URLs are fetched. A bundle is one ES module that
default-exports `activate`, or `{ activate }`.

`serve(backends, format, bytes, mods, player)` (`dist/serve.js`, Node only) is the other half of
a mod: its JavaScript. Given the game and the same mods and player it was patched with, it runs
every `activate()`, listens on loopback, and resolves to `{ port, args, close }`, `args` being what
to launch the patched game with (`--emu-mod-port=<port> --emu-mod-game=sculptr`, from `PORT_ARG`,
`GAME_ARG` and `channelArgs`). The game dials in, says `HELLO` plus that game id, and its messages
reach the mods' handlers and their replies reach the game until `close()`. A mod that only declares
resources needs no `serve`. There is no window, so a mod that declares a panel is refused with
`UnsupportedCapability` naming it, and `files.write` rejects the same way. sculptr launches nothing
itself.

`renderPanels(container, host)` (`dist/panel.js`, `@sculptr/sculptr/panel`) draws the panels of a
`ModHost`'s mods into a DOM element, unstyled, and keeps them live; see
[rendering a panel yourself](docs/docs/advanced/runtime/api.md#rendering-a-panel-yourself).

`--player` is the `ModPlayer` the mods read, as JSON; left out, nobody is signed in:

```json
{
  "account": { "id": "…", "name": "…" },
  "language": "en",
  "controls": { "confirm": ["ShiftLeft"], "cancel": ["KeyZ"] }
}
```

`account` is `null` for nobody, `language` a locale code (`"en"` when left out), and `controls`
`KeyboardEvent.code`s per action (`up down left right confirm cancel retry`; an action left out
keeps its default). Any other field passes to the mods untouched.

The mod contract is importable on its own: `@sculptr/sculptr/contract` (identity, target,
controls, the loader's runtime object, the build key), `@sculptr/sculptr/resources`,
`@sculptr/sculptr/game-code`, `@sculptr/sculptr/channel` and `@sculptr/sculptr/ui`. These are plain
TypeScript that import no backend, so using them links nothing copyleft.

A format it does not handle rejects with `UnsupportedFormat`; a game or resource
the backend refuses rejects with `PatchFailed`, and the CLI writes nothing. Nor does it when a
mod fails to load or activate: it exits 1 naming the mod, and leaves an existing `--out` alone.

## Documentation

`docs/` is the mod author's documentation, published at https://quentinjanuel.github.io/sculptr/. It is a
Docusaurus site in its own workspace package: `pnpm --filter sculptr-docs build` writes
`docs/dist`.

## Build and test

Needs Node 24 with pnpm, Rust (rustup installs the 1.77 toolchain gm8-lib's
`rust-toolchain.toml` names) with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.114,
and for gms-lib the .NET 10 SDK with the `wasm-tools` workload. gm8-lib is pinned by commit in
`Cargo.toml`; gms-lib is pinned as the `gms-lib` submodule, which has submodules of its own.

```sh
git clone --recurse-submodules https://github.com/QuentinJanuel/sculptr && cd sculptr
pnpm install
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
npm run build --prefix gms-lib   # its AOT runtime, into gms-lib/dist
pnpm build:payload
```

`build:payload` writes `dist/`: `index.js`, `serve.js`, `panel.js`, `cli.js`, the contract's
modules, each export's `.d.ts`, `gm8/` (gm8patch) and `gms/` (gms-lib's runtime), loaded relative
to `index.js`, so the directory can be served or copied as one unit. It is what the npm package
ships; `npm publish` runs both builds first (`prepublishOnly`).

### Releasing

Every pull request is checked by `.github/workflows/pull-request.yml`. A release is started by
hand: Actions, Release, Run workflow, on `main`. It takes the version from the npm registry and
increases the part you choose (patch by default), or takes an exact version. It checks and tests
the package as that version, builds the payload, publishes it to npm with trusted publishing and
provenance, and creates the `v<version>` tag and GitHub release. `package.json`'s version is only a
placeholder, so there is never a version-bump commit. The docs are deployed the same way, by hand,
with the Docs deploy workflow.

## Licence

Own source MIT; the package also carries gm8-lib (GPL-2.0-only) and gms-lib (GPL-3.0-only), which
the patcher loads, so a built sculptr is not MIT. The mod contract's entry points load neither.
Run the patcher as a separate process rather than linking it into a program whose licence cannot
accept that. See [LICENSING.md](LICENSING.md), [LICENSE](LICENSE) and [NOTICE](NOTICE).
