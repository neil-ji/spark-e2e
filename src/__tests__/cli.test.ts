import { describe, it, expect } from "vitest";

describe("CLI commands", () => {
  it("has core commands", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).toContain("setup");
    expect(names).toContain("review");
    expect(names).toContain("assert");
    expect(names).toContain("inspect");
    expect(names).toContain("test");
    expect(names).toContain("doctor");
  });

  it("has dom analysis commands", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).toContain("dom-lint");
    expect(names).toContain("dom-get");
  });

  it("test command requires --screenshot", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "test");
    expect(cmd).toBeDefined();
    expect(cmd.description()).toContain("visual verification");
  });

  it("review command has --screenshot required and --dom optional", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "review");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--screenshot" && o.required)).toBe(true);
    expect(cmd.options.some((o: any) => o.long === "--dom")).toBe(true);
    expect(cmd.options.some((o: any) => o.long === "--mode")).toBe(true);
  });

  it("assert command requires --screenshot", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "assert");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--screenshot" && o.required)).toBe(true);
  });

  it("dom-lint has --dom required", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "dom-lint");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--dom" && o.required)).toBe(true);
  });

  it("dom-get accepts ref argument and requires --dom", async () => {
    const { program } = await import("../cli.js");
    const cmd = program.commands.find((c: any) => c.name() === "dom-get");
    expect(cmd).toBeDefined();
    expect(cmd.options.some((o: any) => o.long === "--dom" && o.required)).toBe(true);
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

  it("old browser commands are removed", async () => {
    const { program } = await import("../cli.js");
    const names = program.commands.map((c: any) => c.name());
    expect(names).not.toContain("navigate");
    expect(names).not.toContain("snapshot");
    expect(names).not.toContain("click");
    expect(names).not.toContain("type");
    expect(names).not.toContain("hover");
    expect(names).not.toContain("run");
    expect(names).not.toContain("dom-verify");
    expect(names).not.toContain("compare");
  });

  it("setup has --dir option", async () => {
    const { program } = await import("../cli.js");
    const setup = program.commands.find((c: any) => c.name() === "setup");
    expect(setup).toBeDefined();
    expect(setup.options.some((o: any) => o.long === "--dir")).toBe(true);
  });
});
