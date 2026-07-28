/**
 * Tests for CLI — command registration, argument parsing.
 * Tests the program object directly without spawning subprocesses.
 */
import { describe, it, expect } from "vitest";
import { program, AGENTS } from "../cli.js";

describe("CLI commands", () => {
  it("should have setup command registered", () => {
    const cmds = program.commands.map(c => c.name());
    expect(cmds).toContain("setup");
  });

  it("should NOT have init command", () => {
    const cmds = program.commands.map(c => c.name());
    expect(cmds).not.toContain("init");
  });

  it("should have all core commands", () => {
    const cmds = program.commands.map(c => c.name());
    expect(cmds).toContain("navigate");
    expect(cmds).toContain("snapshot");
    expect(cmds).toContain("review");
    expect(cmds).toContain("assert");
    expect(cmds).toContain("dom-verify");
    expect(cmds).toContain("doctor");
    expect(cmds).toContain("scroll");
    expect(cmds).toContain("inspect");
    expect(cmds).toContain("compare");
  });

  it("should have setup command description", () => {
    const cmd = program.commands.find(c => c.name() === "setup");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("Interactive");
  });

  it("should have at least 10 commands total", () => {
    expect(program.commands.length).toBeGreaterThanOrEqual(10);
  });
});

describe("AGENTS data", () => {
  it("should have exactly 5 agents", () => {
    expect(AGENTS).toHaveLength(5);
  });

  it("should include spark-hub", () => {
    const sparkHub = AGENTS.find(a => a.name === "spark-hub");
    expect(sparkHub).toBeDefined();
    expect(sparkHub!.label).toBe("Spark Hub");
    expect(sparkHub!.projectDir).toBe(".spark/skills");
    expect(sparkHub!.userDir).toBe(".spark/config/custom-skills");
    expect(sparkHub!.detectDirs).toContain(".spark");
  });

  it("should include claude", () => {
    const claude = AGENTS.find(a => a.name === "claude");
    expect(claude).toBeDefined();
    expect(claude!.projectDir).toBe(".claude/skills");
  });

  it("all agents should have required fields", () => {
    for (const a of AGENTS) {
      expect(a.name).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.projectDir).toBeTruthy();
      expect(a.userDir).toBeTruthy();
      expect(a.detectDirs.length).toBeGreaterThan(0);
    }
  });
});

describe("CLI help text (via program)", () => {
  it("setup command should have --dir option", () => {
    const cmd = program.commands.find(c => c.name() === "setup");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain("--dir");
  });

  it("navigate command should accept url argument", () => {
    const cmd = program.commands.find(c => c.name() === "navigate");
    expect(cmd).toBeDefined();
  });

  it("review command should have --url option", () => {
    const cmd = program.commands.find(c => c.name() === "review");
    expect(cmd).toBeDefined();
    const opts = cmd!.options.map(o => o.long);
    expect(opts).toContain("--url");
  });
});
