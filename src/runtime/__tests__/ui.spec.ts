/**
 * What a mod's panel promises, on both sides of the wire.
 *
 * The panel system's whole value is that a mod describes its UI once and the traffic afterwards is
 * small and addressed: one binding per value however many places show it, one patch per change, one
 * insert when a list grows by one. None of that is visible from a running app -- a panel that
 * re-described itself on every keystroke would look exactly right and be completely wrong -- so the
 * shape of what crosses is pinned here rather than left to be noticed.
 */
import { describe, expect, it, vi } from "vitest";
import type { ModUiPatch, UiNode } from "../../ui.js";
import type { ModSettings } from "../../contract.js";
import { ModHost, noFiles, type LoadableMod, type ModApi, type ModHostOptions } from "../index.js";

const target = { engine: "gms" } as const;

function mod(id: string, activate: (api: ModApi) => void): LoadableMod {
  return { identity: { id, version: "1.0.0" }, activate };
}

/** Patches leave on a microtask, so every assertion about them waits one turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function load(activate: (api: ModApi) => void, options: Partial<ModHostOptions> = {}) {
  const patches: ModUiPatch[] = [];
  const host = ModHost.load([mod("test.mod", activate)], target, undefined, undefined, {
    files: noFiles(),
    ...options,
  });
  host.onUiPatch((patch) => patches.push(patch));
  return { host, patches, flat: () => patches.flatMap((one) => one.patches) };
}

/** Every node in the first panel, flattened, so a test can find one by kind. */
function nodes(host: ModHost): UiNode[] {
  const out: UiNode[] = [];
  const walk = (list: readonly UiNode[]) => {
    for (const node of list) {
      out.push(node);
      if ("children" in node) walk(node.children);
    }
  };
  for (const state of host.ui) for (const panel of state.panels) walk(panel.root);
  return out;
}

const byKind = (host: ModHost, kind: UiNode["kind"]) => nodes(host).filter((n) => n.kind === kind);

describe("declaring a panel", () => {
  it("hands over the tree and the values it refers to", () => {
    const { host } = load((api) => {
      const name = api.ui.state("pie");
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.section({ title: "One" }, [ui.text(name), ui.button({ label: "Go" })]),
      ]);
    });

    const [state] = host.ui;
    expect(state?.modId).toBe("test.mod");
    expect(state?.panels).toHaveLength(1);
    const text = byKind(host, "text")[0] as { text: { $bind: number } };
    // A ref reaches the host as a binding, not as a value -- that indirection is what makes a change
    // one small patch instead of a re-description.
    expect(text.text).toEqual({ $bind: expect.any(Number) });
    expect(state?.bindings[text.text.$bind]).toBe("pie");
  });

  it("gives one binding to a value shown in several places", async () => {
    const { host, flat } = load((api) => {
      const name = api.ui.state("pie");
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.text(name),
        ui.badge(name),
        ui.input({ value: name }),
      ]);
      queueMicrotask(() => (name.value = "tart"));
    });

    const bound = nodes(host)
      .map(
        (node) =>
          node as {
            text?: { $bind: number };
            label?: { $bind: number };
            value?: { $bind: number };
          },
      )
      .flatMap((node) => [node.text, node.label, node.value])
      .filter((one): one is { $bind: number } => !!one && typeof one === "object");
    expect(new Set(bound.map((one) => one.$bind)).size).toBe(1);

    await settle();
    // ...and therefore one patch, not three.
    expect(flat()).toEqual([{ t: "bind", id: bound[0]!.$bind, value: "tart" }]);
  });

  it("refuses a panel declared after activate", () => {
    let escaped: ModApi["ui"] | null = null;
    ModHost.load([mod("test.mod", (api) => (escaped = api.ui))], target);
    expect(() => escaped!.panel({ title: "Late" }, (ui) => ui.text("x"))).toThrow(/activate/);
  });
});

describe("values changing", () => {
  it("batches everything one handler did into a single delivery", async () => {
    let a = { value: 0 };
    let b = { value: 0 };
    const { host, patches } = load((api) => {
      const first = api.ui.state(0);
      const second = api.ui.state(0);
      a = first;
      b = second;
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.text(() => `${first.value}`),
        ui.progress(second),
      ]);
    });
    void host;

    a.value = 1;
    b.value = 2;
    a.value = 3;
    await settle();

    expect(patches).toHaveLength(1);
    expect(patches[0]!.patches).toHaveLength(2);
  });

  it("says nothing when a write does not change the value", async () => {
    let ref = { value: "same" };
    const { patches } = load((api) => {
      const value = api.ui.state("same");
      ref = value;
      api.ui.panel({ title: "Test" }, (ui) => ui.text(value));
    });

    ref.value = "same";
    await settle();
    // What keeps a text field from fighting the person typing in it: the host applies a change
    // optimistically and the mod writing the same value back produces no patch at all.
    expect(patches).toEqual([]);
  });

  it("moves a placeholder, which is a label like any other", async () => {
    // A mod whose words follow the player's language has no way to redescribe a field it already
    // declared, so the one label that was a plain string had to become a binding like the rest.
    let language = { value: "en" };
    const { host, flat } = load((api) => {
      const chosen = api.ui.state("en");
      language = chosen;
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.input({
          value: api.ui.state(""),
          placeholder: () => (chosen.value === "fr" ? "ta chaîne" : "your channel"),
        }),
      ]);
    });

    const field = byKind(host, "input")[0] as { placeholder: { $bind: number } };
    expect(host.ui[0]?.bindings[field.placeholder.$bind]).toBe("your channel");
    language.value = "fr";
    await settle();
    expect(flat()).toEqual([{ t: "bind", id: field.placeholder.$bind, value: "ta chaîne" }]);
  });

  it("recomputes a derived value from what it reads", async () => {
    let count = { value: 1 };
    const { host, flat } = load((api) => {
      const value = api.ui.state(1);
      count = value;
      const label = api.ui.computed(() => `${value.value} hits`);
      api.ui.panel({ title: "Test" }, (ui) => ui.text(label));
    });

    const text = byKind(host, "text")[0] as { text: { $bind: number } };
    expect(host.ui[0]?.bindings[text.text.$bind]).toBe("1 hits");
    count.value = 4;
    await settle();
    expect(flat()).toEqual([{ t: "bind", id: text.text.$bind, value: "4 hits" }]);
  });
});

describe("what the player does", () => {
  it("writes a two-way control's value and then tells the mod", () => {
    let ref = { value: false };
    const onChange = vi.fn();
    const { host } = load((api) => {
      const on = api.ui.state(false);
      ref = on;
      api.ui.panel({ title: "Test" }, (ui) => ui.toggle({ label: "On", value: on, onChange }));
    });

    const toggle = byKind(host, "toggle")[0] as { writes: number };
    host.dispatchUi("test.mod", { t: "set", binding: toggle.writes, value: true });
    expect(ref.value).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("leaves a derived value read-only", () => {
    const { host } = load((api) => {
      const on = api.ui.state(false);
      const flipped = api.ui.computed(() => !on.value);
      api.ui.panel({ title: "Test" }, (ui) => ui.toggle({ label: "On", value: flipped }));
    });
    // No `writes`, so the host renders it and cannot write back into something with no setter.
    expect((byKind(host, "toggle")[0] as { writes?: number }).writes).toBeUndefined();
  });

  it("rebinds a key", () => {
    let bound = { value: "KeyH" };
    const onChange = vi.fn();
    const { host } = load((api) => {
      const key = api.ui.state("KeyH");
      bound = key;
      api.ui.panel({ title: "Test" }, (ui) => ui.keybind({ label: "Hit", value: key, onChange }));
    });

    const node = byKind(host, "keybind")[0] as { writes: number };
    // A physical key code, not the letter on it -- see `UiKeybindNode` in the protocol.
    host.dispatchUi("test.mod", { t: "set", binding: node.writes, value: "ArrowLeft" });
    expect(bound.value).toBe("ArrowLeft");
    expect(onChange).toHaveBeenCalledWith("ArrowLeft");

    // Clearing is an ordinary write of the empty string, so a mod needs no second code path.
    host.dispatchUi("test.mod", { t: "set", binding: node.writes, value: "" });
    expect(bound.value).toBe("");
  });

  it("runs a button's handler", () => {
    const onClick = vi.fn();
    const { host } = load((api) => {
      api.ui.panel({ title: "Test" }, (ui) => ui.button({ label: "Go", onClick }));
    });
    host.dispatchUi("test.mod", { t: "click", node: byKind(host, "button")[0]!.id });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("survives a mod throwing from a handler", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = load((api) => {
      api.ui.panel({ title: "Test" }, (ui) =>
        ui.button({
          label: "Go",
          onClick: () => {
            throw new Error("nope");
          },
        }),
      );
    });
    expect(() =>
      host.dispatchUi("test.mod", { t: "click", node: byKind(host, "button")[0]!.id }),
    ).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("lists", () => {
  const listHost = () => {
    let items = { value: [] as { id: number }[] };
    const loaded = load((api) => {
      const source = api.ui.state<{ id: number }[]>([]);
      items = source;
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.each(source, (item) => ui.text(`#${item.id}`), { key: (item) => item.id }),
      ]);
    });
    return { ...loaded, items };
  };

  it("appends one row with one patch", async () => {
    const { items, flat } = listHost();
    items.value = [{ id: 1 }, { id: 2 }];
    await settle();
    expect(flat()).toHaveLength(1);

    items.value = [...items.value, { id: 3 }];
    await settle();
    const last = flat().at(-1)!;
    // The promise that makes a five-hundred-line chat cheap: one row arriving is one insert at the
    // end, not a re-description of the list.
    expect(last).toMatchObject({ t: "insert", at: 2 });
    expect((last as unknown as { children: UiNode[] }).children).toHaveLength(1);
  });

  it("prepends without touching the rows below", async () => {
    const { items, flat } = listHost();
    items.value = [{ id: 1 }, { id: 2 }];
    await settle();
    const before = flat().length;

    items.value = [{ id: 0 }, ...items.value];
    await settle();
    expect(flat().slice(before)).toEqual([
      { t: "insert", node: expect.any(Number), at: 0, children: [expect.anything()] },
    ]);
  });

  it("removes a run of rows in one patch", async () => {
    const { items, flat } = listHost();
    items.value = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    await settle();
    const before = flat().length;

    items.value = [{ id: 1 }, { id: 4 }];
    await settle();
    expect(flat().slice(before)).toEqual([
      { t: "remove", node: expect.any(Number), at: 1, count: 2 },
    ]);
  });

  it("keeps a row's handler pointing at its own item after a reorder", async () => {
    const clicked: number[] = [];
    let items = { value: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const { host } = load((api) => {
      const source = api.ui.state([{ id: 1 }, { id: 2 }, { id: 3 }]);
      items = source;
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.each(
          source,
          (item) => ui.button({ label: `${item.id}`, onClick: () => clicked.push(item.id) }),
          {
            key: (item) => item.id,
          },
        ),
      ]);
    });

    const third = byKind(host, "button")[2]!.id;
    items.value = [{ id: 3 }, { id: 2 }, { id: 1 }];
    await settle();
    host.dispatchUi("test.mod", { t: "click", node: third });
    // The node that was row 3 is still row 3's handler, wherever the diff moved it. A list keyed by
    // position would have rebound this to whatever is third now.
    expect(clicked).toEqual([3]);
  });
});

describe("shape", () => {
  it("replaces a dynamic region and sends the values its new nodes need", async () => {
    let flag = { value: false };
    const { patches } = load((api) => {
      const on = api.ui.state(false);
      flag = on;
      const label = api.ui.state("fresh");
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.dynamic(() => (on.value ? ui.text(label) : ui.text("off"))),
      ]);
    });

    flag.value = true;
    await settle();
    const [patch] = patches[0]!.patches as unknown as [
      { t: string; children: UiNode[]; bindings: Record<number, unknown> },
    ];
    expect(patch.t).toBe("replace");
    expect(patch.children).toHaveLength(1);
    // The new node refers to a binding the host has never seen; it rides along so the row never
    // renders a frame of fallback.
    expect(Object.values(patch.bindings)).toContain("fresh");
  });

  it("stops reporting for a subtree that is gone", async () => {
    let flag = { value: true };
    let hidden = { value: "a" };
    const { patches } = load((api) => {
      const on = api.ui.state(true);
      const label = api.ui.state("a");
      flag = on;
      hidden = label;
      api.ui.panel({ title: "Test" }, (ui) => [
        ui.dynamic(() => (on.value ? ui.text(label) : ui.text("gone"))),
      ]);
    });

    flag.value = false;
    await settle();
    patches.length = 0;

    hidden.value = "b";
    await settle();
    // The binding's effect belonged to the branch that was replaced. Left alive it would keep
    // emitting patches for nodes the host has already thrown away.
    expect(patches).toEqual([]);
  });
});

describe("persistence", () => {
  it("starts from what was saved and reports every change", async () => {
    const save = vi.fn<(modId: string, settings: ModSettings) => void>();
    let ref = { value: "" };
    const { host } = load(
      (api) => {
        const channel = api.ui.state("default", { persist: "channel" });
        ref = channel;
        api.ui.panel({ title: "Test" }, (ui) => ui.input({ value: channel }));
      },
      { settings: { initial: { "test.mod": { channel: "saved" } }, save } },
    );

    const input = byKind(host, "input")[0] as { value: { $bind: number } };
    expect(host.ui[0]?.bindings[input.value.$bind]).toBe("saved");
    // Nothing is written just for having read it back.
    expect(save).not.toHaveBeenCalled();

    ref.value = "changed";
    await settle();
    expect(save).toHaveBeenCalledWith("test.mod", { channel: "changed" });
  });

  it("refuses two values persisted under one name", () => {
    expect(() =>
      ModHost.load(
        [
          mod("test.mod", (api) => {
            api.ui.state(1, { persist: "same" });
            api.ui.state(2, { persist: "same" });
          }),
        ],
        target,
      ),
    ).toThrow(/persist/);
  });
});

describe("the host's side", () => {
  it("only lists mods that actually declared a panel", () => {
    const host = ModHost.load(
      [
        mod("quiet.mod", () => {}),
        mod("loud.mod", (api) => api.ui.panel({ title: "Hi" }, (ui) => ui.text("hello"))),
      ],
      target,
    );
    expect(host.ui.map((one) => one.modId)).toEqual(["loud.mod"]);
  });

  it("keeps patches produced before anyone subscribed", async () => {
    const host = ModHost.load(
      [
        mod("test.mod", (api) => {
          const value = api.ui.state(1);
          api.ui.panel({ title: "Test" }, (ui) => ui.text(() => `${value.value}`));
          value.value = 2;
        }),
      ],
      target,
    );
    await settle();

    const seen: ModUiPatch[] = [];
    host.onUiPatch((patch) => seen.push(patch));
    // A mod can move its own panel from activate(); the host subscribes once the engine exists, which
    // is later. Dropping these would leave the first render stale.
    expect(seen.flatMap((one) => one.patches)).toEqual([
      { t: "bind", id: expect.any(Number), value: "2" },
    ]);
  });
});
