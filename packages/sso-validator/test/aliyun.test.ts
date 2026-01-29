import { describe, it, expect } from "vitest";
import { validateAliyunCredential } from "../src/aliyun.js";

describe("Aliyun SSO", () => {
  it("validateAliyunCredential 应返回验证结果", () => {
    const result = validateAliyunCredential("test-profile");
    expect(result).toHaveProperty("profile");
    expect(result).toHaveProperty("valid");
    expect(result.profile).toBe("test-profile");
  });
});
