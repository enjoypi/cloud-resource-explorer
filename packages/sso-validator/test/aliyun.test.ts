import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";

vi.mock("node:child_process");
const mockExecSync = vi.mocked(childProcess.execSync);

describe("validateAliyunCredential", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("有效的 CloudSSO 凭证返回 valid=true", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      mode: "CloudSSO",
      access_key_id: "LTAI5xxx",
      sts_token: "token-xxx",
      sts_expiration: Math.floor(Date.now() / 1000) + 3600,
    }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("prod");
    expect(result.valid).toBe(true);
    expect(result.profile).toBe("prod");
  });

  it("缺少 access_key_id 时返回无效", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      mode: "CloudSSO",
      sts_token: "token-xxx",
    }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("test");
    expect(result.valid).toBe(false);
    expect(result.refreshCommand).toContain("aliyun configure");
  });

  it("缺少 sts_token 时返回无效", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      mode: "CloudSSO",
      access_key_id: "LTAI5xxx",
    }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("test");
    expect(result.valid).toBe(false);
  });

  it("凭证过期时返回无效并包含过期时间", async () => {
    const expiredTime = Math.floor(Date.now() / 1000) - 3600;
    mockExecSync.mockReturnValue(JSON.stringify({
      mode: "CloudSSO",
      access_key_id: "LTAI5xxx",
      sts_token: "token-xxx",
      sts_expiration: expiredTime,
    }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("expired");
    expect(result.valid).toBe(false);
    expect(result.expiredAt).toBeInstanceOf(Date);
    expect(result.refreshCommand).toBe("aliyun configure --mode CloudSSO --profile expired");
  });

  it("非 CloudSSO 模式的有效凭证返回 valid=true", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      mode: "AK",
      access_key_id: "LTAI5xxx",
      access_key_secret: "secret",
    }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("ak-profile");
    expect(result.valid).toBe(true);
  });

  it("CLI 执行失败时返回无效", async () => {
    mockExecSync.mockImplementation(() => { throw new Error("CLI not found"); });
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    const result = validateAliyunCredential("fail");
    expect(result.valid).toBe(false);
    expect(result.refreshCommand).toContain("aliyun configure");
  });

  it("无效的 profile 名称抛出错误", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({ mode: "AK" }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    expect(() => validateAliyunCredential("invalid;rm -rf /")).toThrow("无效的 profile 名称");
    expect(() => validateAliyunCredential("test$(whoami)")).toThrow("无效的 profile 名称");
    expect(() => validateAliyunCredential("a b c")).toThrow("无效的 profile 名称");
  });

  it("合法的 profile 名称格式通过验证", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({ mode: "AK", access_key_id: "x" }));
    const { validateAliyunCredential } = await import("../src/aliyun.js");
    expect(() => validateAliyunCredential("valid-profile_123")).not.toThrow();
    expect(() => validateAliyunCredential("PROD")).not.toThrow();
  });
});
