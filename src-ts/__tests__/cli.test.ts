import { describe, it, expect } from "vitest";

describe("CLI commands", () => {
  it("program exports setup, navigate, snapshot, review, doctor", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).toContain("setup");
    expect(names).toContain("navigate");
    expect(names).toContain("snapshot");
    expect(names).toContain("review");
    expect(names).toContain("doctor");
  });

  it("init command removed", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).not.toContain("init");
  });

  it("setup has --dir option", async () => {
    const { program } = await import("../cli.js");
    const setup = program.commands.find((c: any) => c.name() === "setup");
    expect(setup).toBeDefined();
    expect(setup.options.some((o: any) => o.long === "--dir")).toBe(true);
  });
});
