/**
 * The controls contract.
 *
 * Pinned here because both sides of rebinding depend on these being exactly what they are: the host
 * writes bindings against this action list, the mod maps them onto these canonical keys, and the two
 * are in different repositories. A canonical key quietly changing is a rebind that maps onto a key
 * the game never reads, which fails silently in a running game -- the hardest place to notice it.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_CONTROL_KEYS,
  CONTROL_ACTIONS,
  controlKeyForBinding,
  controlsAreDefault,
  defaultControls,
  isPadBinding,
  padAxisCode,
  padButtonCode,
  parseControls,
  type ModControls,
} from "../contract.js";

describe("the action list", () => {
  it("has a canonical key for every action, and no spares", () => {
    expect([...CONTROL_ACTIONS].sort()).toEqual(Object.keys(CANONICAL_CONTROL_KEYS).sort());
  });

  it("names the keys a default touch pad presses", () => {
    // A host's default touch pad dispatches exactly these codes. If the two tables ever disagree,
    // the default pad is pressing keys the rebind layer does not know about -- so they are
    // asserted literally rather than derived from each other.
    expect(CANONICAL_CONTROL_KEYS).toEqual({
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      confirm: "ShiftLeft",
      cancel: "KeyZ",
      retry: "KeyR",
    });
  });
});

describe("defaultControls", () => {
  it("binds each action to the key the game already reads", () => {
    const controls = defaultControls();
    for (const action of CONTROL_ACTIONS) {
      expect(controls[action]).toEqual([CANONICAL_CONTROL_KEYS[action]]);
    }
  });

  it("is a fresh object each time, so one caller's edit is not everyone's", () => {
    expect(defaultControls()).not.toBe(defaultControls());
  });
});

describe("controlsAreDefault", () => {
  it("is true for the defaults, which is what makes rebinding free when nobody rebinds", () => {
    expect(controlsAreDefault(defaultControls())).toBe(true);
  });

  it("is false once a key moves", () => {
    const moved: ModControls = { ...defaultControls(), confirm: ["Space"] };
    expect(controlsAreDefault(moved)).toBe(false);
  });

  it("is false for a second binding on an otherwise default action", () => {
    const extra: ModControls = { ...defaultControls(), cancel: ["KeyZ", "KeyX"] };
    expect(controlsAreDefault(extra)).toBe(false);
  });

  it("is false for an action the player unbound entirely", () => {
    const unbound: ModControls = { ...defaultControls(), retry: [] };
    expect(controlsAreDefault(unbound)).toBe(false);
  });

  it("is false when the same keys are in a different order", () => {
    // The first binding is the one a "primary" badge would show, so the order is the player's
    // choice and reordering it is a change.
    const reordered: ModControls = { ...defaultControls(), cancel: ["KeyX", "KeyZ"] };
    expect(controlsAreDefault(reordered)).toBe(false);
  });
});

describe("parseControls", () => {
  it("reads a full set back unchanged", () => {
    const stored = { ...defaultControls(), confirm: ["Space", "KeyC"] };
    expect(parseControls(stored)).toEqual(stored);
  });

  it("fills in an action the stored blob has never heard of", () => {
    // What makes adding an action not a migration: a blob written before `retry` existed still
    // reads, with `retry` on the key the game reads anyway.
    const old: Record<string, string[]> = {};
    for (const action of CONTROL_ACTIONS) old[action] = [CANONICAL_CONTROL_KEYS[action]];
    delete old.retry;
    expect(parseControls(old)?.retry).toEqual(["KeyR"]);
  });

  it("keeps an action the player deliberately unbound", () => {
    expect(parseControls({ ...defaultControls(), retry: [] })?.retry).toEqual([]);
  });

  it("refuses anything it only half understands", () => {
    expect(parseControls(null)).toBeNull();
    expect(parseControls("ArrowUp")).toBeNull();
    expect(parseControls([])).toBeNull();
    // A key that is not a plausible KeyboardEvent.code.
    expect(parseControls({ ...defaultControls(), up: ["Arrow Up"] })).toBeNull();
    expect(parseControls({ ...defaultControls(), up: [""] })).toBeNull();
    expect(parseControls({ ...defaultControls(), up: [42] })).toBeNull();
    expect(parseControls({ ...defaultControls(), up: "ArrowUp" })).toBeNull();
    // More bindings than the limit, and the same key twice.
    expect(
      parseControls({ ...defaultControls(), up: ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE"] }),
    ).toBeNull();
    expect(parseControls({ ...defaultControls(), up: ["KeyA", "KeyA"] })).toBeNull();
    // An action this build has no slot for: a different format, not controls.
    expect(parseControls({ ...defaultControls(), dash: ["KeyX"] })).toBeNull();
  });

  it("accepts a code this build has never seen, since the player's keyboard has it", () => {
    expect(parseControls({ ...defaultControls(), cancel: ["BrowserFavorites"] })?.cancel).toEqual([
      "BrowserFavorites",
    ]);
  });

  it("copies the lists, so the caller cannot reach back into what it passed", () => {
    const mutable = { ...defaultControls(), up: ["KeyW"] };
    const parsed = parseControls(mutable)!;
    mutable.up.push("KeyI");
    expect(parsed.up).toEqual(["KeyW"]);
  });
});

describe("controlKeyForBinding", () => {
  it("stores either shift as one key, because GameMaker has only one", () => {
    // vk_shift is either shift, so two actions each holding "a shift" would behave as one in the
    // game while the panel showed two different keys.
    expect(controlKeyForBinding("ShiftRight")).toBe("ShiftLeft");
    expect(controlKeyForBinding("ControlRight")).toBe("ControlLeft");
    expect(controlKeyForBinding("AltRight")).toBe("AltLeft");
  });

  it("agrees with the canonical key for confirm, so the default needs no collapsing", () => {
    expect(controlKeyForBinding(CANONICAL_CONTROL_KEYS.confirm)).toBe(
      CANONICAL_CONTROL_KEYS.confirm,
    );
  });

  it("leaves every other key alone", () => {
    for (const code of ["KeyZ", "Space", "ArrowUp", "F5", "Numpad3", ""]) {
      expect(controlKeyForBinding(code)).toBe(code);
    }
  });
});

describe("controller bindings", () => {
  it("recognises pad codes and nothing else", () => {
    for (const code of ["PadButton0", "PadButton15", "PadAxis0Plus", "PadAxis1Minus"]) {
      expect(isPadBinding(code)).toBe(true);
    }
    for (const code of ["KeyZ", "Space", "ShiftLeft", "", "Pad", "PadButton", "PadAxis0"]) {
      expect(isPadBinding(code)).toBe(false);
    }
  });

  it("builds codes that survive storage", () => {
    // They have to pass the same validation a key does, since they live in the same list -- this is
    // what lets a controller binding need no new field anywhere.
    const controls: ModControls = {
      ...defaultControls(),
      confirm: ["Space", padButtonCode(0)],
      left: [padAxisCode(0, "Minus")],
    };
    expect(parseControls(controls)).toEqual(controls);
  });
});

describe("controlKeyForBinding", () => {
  it("stores either shift as one key, because GameMaker has only one", () => {
    // vk_shift is either shift, so two actions each holding "a shift" would behave as one in the
    // game while the panel showed two different keys.
    expect(controlKeyForBinding("ShiftRight")).toBe("ShiftLeft");
    expect(controlKeyForBinding("ControlRight")).toBe("ControlLeft");
    expect(controlKeyForBinding("AltRight")).toBe("AltLeft");
  });

  it("agrees with the canonical key for confirm, so the default needs no collapsing", () => {
    expect(controlKeyForBinding(CANONICAL_CONTROL_KEYS.confirm)).toBe(
      CANONICAL_CONTROL_KEYS.confirm,
    );
  });

  it("leaves every other key alone", () => {
    for (const code of ["KeyZ", "Space", "ArrowUp", "F5", "Numpad3", ""]) {
      expect(controlKeyForBinding(code)).toBe(code);
    }
  });
});

describe("controller bindings", () => {
  it("recognises pad codes and nothing else", () => {
    for (const code of ["PadButton0", "PadButton15", "PadAxis0Plus", "PadAxis1Minus"]) {
      expect(isPadBinding(code)).toBe(true);
    }
    for (const code of ["KeyZ", "Space", "ShiftLeft", "", "Pad", "PadButton", "PadAxis0"]) {
      expect(isPadBinding(code)).toBe(false);
    }
  });

  it("builds codes that survive storage", () => {
    // They have to pass the same validation a key does, since they live in the same list -- this is
    // what lets a controller binding need no new field anywhere.
    const controls: ModControls = {
      ...defaultControls(),
      confirm: ["Space", padButtonCode(0)],
      left: [padAxisCode(0, "Minus")],
    };
    expect(parseControls(controls)).toEqual(controls);
  });
});
