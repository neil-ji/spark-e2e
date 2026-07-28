/**
 * Tests for balanceJson — JSON bracket/string balancing used by extractJson.
 */
import { describe, it, expect } from "vitest";
import { balanceJson } from "../vlm/openai-compat.js";

describe("balanceJson", () => {
  it("already balanced — no change", () => {
    const [result, depth] = balanceJson('{"a":1}');
    expect(result).toBe('{"a":1}');
    expect(depth).toBe(0);
  });

  it("missing closing brace", () => {
    const [result, depth] = balanceJson('{"a":1');
    expect(result).toBe('{"a":1}');
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it("nested missing closing braces", () => {
    const [result] = balanceJson('{"outer":{"inner":42');
    expect(JSON.parse(result)).toEqual({ outer: { inner: 42 } });
  });

  it("missing closing bracket", () => {
    const [result] = balanceJson('{"items":[1,2,3');
    expect(JSON.parse(result)).toEqual({ items: [1, 2, 3] });
  });

  it("string with escaped quote — shouldn't break bracket counting", () => {
    // In a string, \" should not count as a string terminator
    const input = '{"msg":"hello \\"world\\"","ok":true}';
    const [result] = balanceJson(input);
    expect(JSON.parse(result)).toEqual({ msg: 'hello "world"', ok: true });
  });

  it("escaped backslash before quote", () => {
    const input = '{"path":"C:\\\\Users"';
    const [result] = balanceJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ path: "C:\\Users" });
  });

  it("unclosed string at end — balanceJs auto-closes the string", () => {
    const [result] = balanceJson('{"key":"unclosed value');
    // Auto-closes both the string and the brace
    expect(() => JSON.parse(result)).not.toThrow();
    expect((JSON.parse(result) as Record<string, unknown>).key).toBe("unclosed value");
  });

  it("already-balanced nested arrays and objects", () => {
    const input = '{"a":[1,{"b":[2,3]},4],"c":{"d":5}}';
    const [result] = balanceJson(input);
    expect(result).toBe(input);
    expect(JSON.parse(result)).toEqual({ a: [1, { b: [2, 3] }, 4], c: { d: 5 } });
  });

  it("empty object — no change", () => {
    const [result] = balanceJson("{}");
    expect(result).toBe("{}");
  });

  it("empty string — returns just the closing quote + brace", () => {
    const [result] = balanceJson("");
    expect(result).toBe("");
  });
});
