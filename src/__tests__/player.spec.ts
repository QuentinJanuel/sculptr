import { describe, expect, it } from "vitest";
import { defaultControls, noPlayer } from "../contract.js";

describe("noPlayer", () => {
  it("is nobody, in a language, with the default controls, and nothing a host adds", () => {
    expect(noPlayer()).toEqual({ account: null, language: "en", controls: defaultControls() });
    expect(noPlayer("pt-BR").language).toBe("pt-BR");
  });
});
