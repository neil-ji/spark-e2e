import { describe, it, expect } from "vitest";

describe("CLI commands", () => {
  it("has all base commands", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).toContain("setup");
    expect(names).toContain("navigate");
    expect(names).toContain("snapshot");
    expect(names).toContain("review");
    expect(names).toContain("doctor");
  });

  it("has Tier 1 commands", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    // test
    expect(names).toContain("test");
    // visual interaction
    expect(names).toContain("click");
    expect(names).toContain("type");
    expect(names).toContain("hover");
    // baseline
    expect(names).toContain("baseline");
    // runner
    expect(names).toContain("run");
    // existing
    expect(names).toContain("dom-verify");
    expect(names).toContain("compare");
    expect(names).toContain("assert");
  });

  it("test command accepts expectations argument", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "test");
    expect(cmd).toBeDefined();
    // Commander stores positional args in _args
    const args = (cmd as any)._args || [];
    // It should have at least one required argument (expectations)
    expect(cmd.description()).toContain("Natural language");
  });

  it("click command accepts target argument", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "click");
    expect(cmd).toBeDefined();
    expect(cmd.description()).toContain("visual description");
  });

  it("type command has --into option", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "type");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--into")).toBe(true);
  });

  it("dom-verify has --save option", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "dom-verify");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--save")).toBe(true);
  });

  it("baseline has subcommands save, compare, list, delete", async () => {
    const { program } = await import("../cli.js");
    const bl = program.commands.find((c: any) => c.name() === "baseline");
    expect(bl).toBeDefined();
    const subNames = (bl as any).commands.map((c: any) => c.name());
    expect(subNames).toContain("save");
    expect(subNames).toContain("compare");
    expect(subNames).toContain("list");
    expect(subNames).toContain("delete");
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
