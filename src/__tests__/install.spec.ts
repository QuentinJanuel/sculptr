import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { defaultControls, loaderRuntime, noPlayer, type ModPlayer } from "../contract.js";
import { emptyGameCode } from "../game-code.js";
import { installMods, parsePlayer } from "../install.js";
import type { LoadableMod } from "../runtime/index.js";

const bytes = new Uint8Array([1, 2, 3]);
const backends = () => ({
  gameCode: vi.fn(async () => JSON.stringify(emptyGameCode())),
  patch: vi.fn(async () => new Uint8Array([9])),
});
const declaring = (id: string, seen?: ModPlayer[]): LoadableMod => ({
  identity: { id, version: "1.0.0" },
  activate: (api) => {
    seen?.push(api.getPlayer());
    api.resource.create({
      kind: "object",
      name: `${id}_o`,
      events: { step: api.gml.send('"hi"') },
    });
  },
});

describe("installMods", () => {
  it("patches in the loader's runtime, then what the mods declared, for the given player", async () => {
    const b = backends();
    const seen: ModPlayer[] = [];
    const player = { ...noPlayer("fr"), account: { id: "1", name: "a" }, room: { id: "r" } };
    const out = await installMods(b, "gm8", bytes, [declaring("a", seen)], player);
    expect(out).toEqual(new Uint8Array([9]));
    const [, , resources] = b.patch.mock.calls[0] as unknown as [unknown, unknown, unknown[]];
    expect(resources[0]).toEqual(loaderRuntime(["a"]));
    expect(resources).toHaveLength(2);
    expect(seen).toEqual([player]);
  });

  it("answers with the game's own bytes when nothing is declared", async () => {
    const b = backends();
    const quiet: LoadableMod = { identity: { id: "q", version: "1" }, activate: () => {} };
    expect(await installMods(b, "gms", bytes, [quiet])).toBe(bytes);
    expect(b.patch).not.toHaveBeenCalled();
  });

  it("is nobody signed in when no player is given", async () => {
    const seen: ModPlayer[] = [];
    await installMods(backends(), "gm8", bytes, [declaring("a", seen)]);
    expect(seen).toEqual([noPlayer()]);
  });

  it("names the mod whose activate() throws, and never patches", async () => {
    const b = backends();
    const broken: LoadableMod = {
      identity: { id: "broken", version: "1" },
      activate: () => {
        throw new Error("boom");
      },
    };
    await expect(installMods(b, "gm8", bytes, [declaring("a"), broken])).rejects.toThrow(
      "mod broken failed to activate: boom",
    );
    expect(b.patch).not.toHaveBeenCalled();
  });
});

describe("parsePlayer", () => {
  it("fills what is left out as nobody signed in, and keeps a host's own fields", () => {
    expect(parsePlayer("{}")).toEqual(noPlayer());
    const player = parsePlayer('{"account":{"id":"1","name":"a"},"language":"ja","skin":{"x":1}}');
    expect(player).toEqual({
      account: { id: "1", name: "a" },
      language: "ja",
      controls: defaultControls(),
      skin: { x: 1 },
    });
  });

  it("refuses what is not the documented shape", () => {
    expect(() => parsePlayer("[]")).toThrow("not a JSON object");
    expect(() => parsePlayer('{"account":{"id":1}}')).toThrow("account");
    expect(() => parsePlayer('{"language":2}')).toThrow("language");
    expect(() => parsePlayer('{"controls":{"jump":["KeyZ"]}}')).toThrow("controls");
  });
});

describe("the built payload", () => {
  // Every module `sculptr patch` and the built `serve` can load, other than the two backends loaded
  // by URL at runtime: no emulator, and no browser or UI framework behind the mods.
  it("loads no emulator", async () => {
    const { metafile } = await build({
      entryPoints: ["../cli.ts", "../serve.ts"].map((entry) =>
        path.join(import.meta.dirname, entry),
      ),
      bundle: true,
      write: false,
      outdir: "unused", // esbuild wants one for two entry points, even when it writes nothing
      metafile: true,
      platform: "neutral",
      format: "esm",
      external: ["node:*"],
    });
    expect(Object.keys(metafile.inputs).filter((input) => !input.startsWith("src/"))).toEqual([]);
  });
});
