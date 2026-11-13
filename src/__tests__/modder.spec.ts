import { describe, expect, it, vi } from "vitest";
import type { Resource } from "../resources.js";
import type { At } from "../game-code.js";
import { modder, PatchFailed, UnsupportedFormat, type Backend, type Format } from "../index.js";
import { gmsBackend, type GmsEntry } from "../gms.js";
import { gm8Backend } from "../gm8.js";

const bytes = new Uint8Array([1, 2, 3]);
const fake = (overrides: Partial<Backend> = {}): Backend => ({
  gameCode: () => "{}",
  patch: (input) => input,
  ...overrides,
});

describe("modder", () => {
  it("names a format it cannot handle, without loading anything", async () => {
    const gm8 = vi.fn(async () => fake());
    const { patch } = modder({ gm8, gms: gm8 });
    await expect(patch("gm9" as Format, bytes, [])).rejects.toBeInstanceOf(UnsupportedFormat);
    await expect(patch("toString" as Format, bytes, [])).rejects.toBeInstanceOf(UnsupportedFormat);
    expect(gm8).not.toHaveBeenCalled();
  });

  it("turns a backend's refusal, string or Error, into PatchFailed", async () => {
    const { patch, gameCode } = modder({
      gm8: async () =>
        fake({
          patch: () => {
            throw "object o_mod clashes with the game's own";
          },
        }),
      gms: async () =>
        fake({
          gameCode: () => {
            throw new Error("not a data.win");
          },
        }),
    });
    await expect(patch("gm8", bytes, [])).rejects.toThrow(
      new PatchFailed("object o_mod clashes with the game's own"),
    );
    await expect(gameCode("gms", bytes)).rejects.toThrow(new PatchFailed("not a data.win"));
  });

  it("loads each backend once, and again after a failed load", async () => {
    let attempts = 0;
    const gms = vi.fn(async () => {
      if (attempts++ === 0) throw new Error("boot failed");
      return fake();
    });
    const { prepare, gameCode } = modder({ gm8: async () => fake(), gms });
    await expect(prepare("gms")).rejects.toThrow("boot failed");
    await gameCode("gms", bytes);
    await gameCode("gms", bytes);
    expect(gms).toHaveBeenCalledTimes(2);
  });
});

const resources: Resource[] = [
  { kind: "object", name: "o", events: { step: "a();" } },
  { kind: "hook", script: "s", original: "s_original", source: "b();" },
  { kind: "insert", at: "gml_Object_x_Create_0:3" as At, place: "before", call: "c" },
  { kind: "script", name: "c", source: "return 1;" },
];

describe("backends", () => {
  it("gms installs scripts, insertions, hooks, then objects, after clearing", () => {
    const calls: string[] = [];
    const entry = new Proxy({} as GmsEntry, {
      get: (_, name: string) => (arg: unknown) => {
        calls.push(name);
        return name === "PatchDataWin" ? arg : "";
      },
    });
    expect(gmsBackend(entry).patch(bytes, resources)).toBe(bytes);
    expect(calls).toEqual([
      "ClearMods",
      "AddModScript",
      "AddModInsert",
      "AddModHook",
      "AddModObject",
      "AddModObjectEvent",
      "PatchDataWin",
    ]);
  });

  it("gm8 hands gm8patch the lowered resources as JSON", () => {
    const patch_gm8_exe = vi.fn((exe: Uint8Array) => exe);
    gm8Backend({ game_code_gm8: () => "", patch_gm8_exe }).patch(bytes, resources);
    const [, scripts, inserts, hooks, objects] = patch_gm8_exe.mock.calls[0] as unknown as string[];
    expect(JSON.parse(scripts!).map((s: { name: string }) => s.name)).toEqual(["c"]);
    expect(JSON.parse(inserts!)).toHaveLength(1);
    expect(JSON.parse(hooks!)).toHaveLength(1);
    expect(JSON.parse(objects!)[0].events).toEqual([{ event: "step", source: "a();" }]);
  });
});
