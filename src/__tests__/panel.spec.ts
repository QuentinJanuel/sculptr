// @vitest-environment happy-dom
// The renderer builds DOM, which Node has none of; happy-dom supplies one for this file only.
import { describe, expect, it, vi } from "vitest";
import { renderPanels, type PanelHost } from "../panel.js";
import { ModHost, noFiles, type ModApi } from "../runtime/index.js";
import type { UiNode } from "../ui.js";

/** Patches leave on a microtask. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function render(activate: (api: ModApi) => void) {
  const host = ModHost.load(
    [{ identity: { id: "test.mod", version: "1.0.0" }, activate }],
    { engine: "gms" },
    undefined,
    undefined,
    { files: noFiles() },
  );
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  renderPanels(container, host);
  return container;
}

describe("renderPanels", () => {
  it("renders a panel, and its button, toggle, input, select and keybind work", async () => {
    const clicks = vi.fn();
    let count: { value: number } | undefined;
    let shared: { value: boolean } | undefined;
    let name: { value: string } | undefined;
    let pick: { value: string } | undefined;
    let key: { value: string } | undefined;
    const container = render((api) => {
      const c = (count = api.ui.state(0));
      const s = (shared = api.ui.state(false));
      const n = (name = api.ui.state("pie"));
      const p = (pick = api.ui.state("a"));
      const k = (key = api.ui.state("KeyH"));
      const lines = api.ui.state<string[]>([]);
      api.ui.panel({ title: "Settings" }, (ui) => [
        ui.section({ title: "Main" }, [
          ui.text(() => `${c.value} clicks`),
          ui.button({
            label: "Go",
            onClick: () => {
              clicks();
              c.value += 1;
              lines.value = [...lines.value, `line ${c.value}`];
            },
          }),
          ui.toggle({ label: "Share", value: s }),
          ui.text(() => (s.value ? "sharing" : "private")),
          ui.input({ label: "Name", value: n }),
          ui.select({
            label: "Pick",
            value: p,
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          }),
          ui.keybind({ label: "Hit", value: k }),
          ui.dynamic(() => (s.value ? [ui.badge("on", { tone: "ok" })] : [])),
          ui.scroll(ui.each(lines, (line) => ui.text(line), { key: (line) => line })),
        ]),
      ]);
    });

    expect(container.querySelector("h2")?.textContent).toBe("Settings (test.mod)");
    expect(container.textContent).toContain("0 clicks");

    container.querySelector("button")!.click();
    await settle();
    expect(clicks).toHaveBeenCalledOnce();
    expect(count!.value).toBe(1);
    expect(container.textContent).toContain("1 clicks");
    expect(container.textContent).toContain("line 1");

    const box = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    box.click();
    expect(shared!.value).toBe(true);
    await settle();
    expect(container.textContent).toContain("sharing");
    expect(container.textContent).toContain("[on]");

    const field = container.querySelector<HTMLInputElement>("input:not([type=checkbox])")!;
    expect(field.value).toBe("pie");
    field.value = "cake";
    field.dispatchEvent(new Event("input"));
    expect(name!.value).toBe("cake");

    const select = container.querySelector("select")!;
    select.value = "b";
    select.dispatchEvent(new Event("change"));
    expect(pick!.value).toBe("b");

    const keybind = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "KeyH",
    )!;
    keybind.click();
    keybind.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
    expect(key!.value).toBe("KeyJ");
    expect(keybind.textContent).toBe("KeyJ");
  });

  it("draws a node kind it does not know as a visible placeholder", () => {
    const host: PanelHost = {
      ui: [
        {
          modId: "future.mod",
          panels: [
            {
              id: "p",
              title: "Future",
              root: [
                { id: 1, kind: "hologram" } as unknown as UiNode,
                { id: 2, kind: "text", text: "still here" },
              ],
            },
          ],
          bindings: {},
        },
      ],
      onUiPatch: () => {},
      dispatchUi: () => {},
    };
    const container = document.createElement("div");
    renderPanels(container, host);
    expect(container.querySelector("[data-unknown]")?.textContent).toBe(
      "[unsupported panel node: hologram]",
    );
    expect(container.textContent).toContain("still here");
  });
});
