#!/usr/bin/env node
// The command line over the library: resources as JSON, or mods, whose activate() decides them.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gameCode, patch, type Format } from "./index.js";
import { formatOf, installMods, parsePlayer } from "./install.js";
import { asModActivate, type LoadableMod, type ModSource } from "./runtime/index.js";

const USAGE = `usage: sculptr patch <game> [--format gm8|gms] --mod <mod>... [--player <json>] --out <file>
       sculptr patch <game> [--format gm8|gms] [--resources <file.json>] --out <file>

<game> is a GameMaker 8 executable or a GameMaker Studio data.win; --format is read off the file
when left out.

--mod, repeatable, installs in the order given. Either a bundle's URL or path, installed under
that string as its id and version 0.0.0, or a JSON {"id", "version", "url"} naming the identity to
install it under. Only http(s) URLs are fetched; anything else is a path.

--player is the JSON of who is playing, for activate() to read. Left out, nobody is signed in:
  {"account": {"id": string, "name": string} | null,
   "language": string,                       locale code, "en" when left out
   "controls": {"up": [code], ...}}          KeyboardEvent codes per action; defaults when left out
Any other field is passed to the mods untouched.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: "string" },
    resources: { type: "string" },
    mod: { type: "string", multiple: true },
    player: { type: "string" },
    out: { type: "string" },
  },
});
const [command, game] = positionals;

if (
  !game ||
  command !== "patch" ||
  !values.out ||
  (values.mod && values.resources) ||
  (values.player && !values.mod)
) {
  console.error(USAGE);
  process.exit(2);
}

/** Fetched or read as text and evaluated as one module, the way a browser host evaluates a bundle. */
async function loadMod(spec: string): Promise<LoadableMod> {
  const { url, id, version } = (
    spec.startsWith("{") ? JSON.parse(spec) : { id: spec, version: "0.0.0", url: spec }
  ) as ModSource;
  if (![url, id, version].every((field) => typeof field === "string")) {
    throw new Error(`--mod ${spec}: id, version and url are strings`);
  }
  let source: string;
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`mod at ${url}: fetch failed (${response.status})`);
    source = await response.text();
  } else {
    source = await readFile(url, "utf8");
  }
  const module: unknown = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return { identity: { id, version }, activate: asModActivate(module, url) };
}

try {
  const player = values.player ? parsePlayer(values.player) : undefined;
  const bytes = new Uint8Array(await readFile(game));
  const format = (values.format ?? formatOf(bytes)) as Format;
  // Built in full before anything is written, so a refusal leaves no half-written file.
  const modded = values.mod
    ? await installMods(
        { gameCode, patch },
        format,
        bytes,
        await Promise.all(values.mod.map(loadMod)),
        player,
      )
    : await patch(
        format,
        bytes,
        values.resources ? JSON.parse(await readFile(values.resources, "utf8")) : [],
      );
  await writeFile(values.out, modded);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // Read off the file, "gm8" only means "not a data.win": a Studio export or an archive lands here.
  const unpack =
    !values.format && /could not read this game/.test(message)
      ? "\nnot a GameMaker 8 executable or a data.win: run GM-Unpack on it first and patch what it writes"
      : "";
  console.error(message + unpack);
  process.exit(1);
}
