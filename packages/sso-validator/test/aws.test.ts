import { describe, it, expect } from "vitest";
import { parseAWSSSOSessions } from "../src/aws.js";

describe("AWS SSO", () => {
  it("parseAWSSSOSessions 应返回数组", () => {
    const sessions = parseAWSSSOSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
