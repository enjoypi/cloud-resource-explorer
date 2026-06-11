import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs");
vi.mock("node:os", () => ({ homedir: () => "/home/test" }));
vi.mock("@aws-sdk/client-sso", () => ({
  SSOClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  ListAccountsCommand: vi.fn(),
}));

const mockFs = vi.mocked(fs);

describe("parseAWSSSOSessions", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("配置文件不存在时返回空数组", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const { parseAWSSSOSessions } = await import("../src/aws.js");
    expect(parseAWSSSOSessions()).toEqual([]);
  });

  it("正确解析单个 SSO Session", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(`
[sso-session my-sso]
sso_start_url = https://my-sso.awsapps.com/start
sso_region = ap-northeast-1
sso_role_name = AdminRole
`);
    const { parseAWSSSOSessions } = await import("../src/aws.js");
    const sessions = parseAWSSSOSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      name: "my-sso",
      startUrl: "https://my-sso.awsapps.com/start",
      region: "ap-northeast-1",
      roleName: "AdminRole",
    });
  });

  it("正确解析多个 SSO Session", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(`
[sso-session prod]
sso_start_url = https://prod.awsapps.com/start
sso_region = us-east-1

[sso-session dev]
sso_start_url = https://dev.awsapps.com/start
sso_region = us-west-2
`);
    const { parseAWSSSOSessions } = await import("../src/aws.js");
    const sessions = parseAWSSSOSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe("prod");
    expect(sessions[1].name).toBe("dev");
  });

  it("缺少 region 时使用默认值 us-east-1", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(`
[sso-session minimal]
sso_start_url = https://minimal.awsapps.com/start
`);
    const { parseAWSSSOSessions } = await import("../src/aws.js");
    const sessions = parseAWSSSOSessions();
    expect(sessions[0].region).toBe("us-east-1");
    expect(sessions[0].roleName).toBeUndefined();
  });
});

describe("parseAWSProfileSSORef", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("解析 profile 的 sso_session 引用与角色名", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(`
[profile aws-main-ro]
sso_session = aws-zf
sso_account_id = 172169962929
sso_role_name = ReadOnly
`);
    const { parseAWSProfileSSORef } = await import("../src/aws.js");
    expect(parseAWSProfileSSORef("aws-main-ro")).toMatchObject({ sessionName: "aws-zf", roleName: "ReadOnly" });
  });

  it("profile 不存在返回 null", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(`[profile other]\nregion = us-east-1\n`);
    const { parseAWSProfileSSORef } = await import("../src/aws.js");
    expect(parseAWSProfileSSORef("missing")).toBeNull();
  });
});

describe("validateAWSSSOSession", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.clearAllMocks());

  it("Session 不存在时返回无效结果", async () => {
    mockFs.existsSync.mockReturnValue(false);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("non-existent");
    expect(result.valid).toBe(false);
    expect(result.session).toBe("non-existent");
    expect(result.refreshCommand).toBe("aws sso login --sso-session non-existent");
  });

  it("缓存目录不存在时返回无效结果", async () => {
    mockFs.existsSync.mockImplementation((p) => {
      const pathStr = p.toString();
      return pathStr.includes("config") && !pathStr.includes("cache");
    });
    mockFs.readFileSync.mockReturnValue(`
[sso-session test]
sso_start_url = https://test.awsapps.com/start
sso_region = us-east-1
`);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("test");
    expect(result.valid).toBe(false);
  });

  it("profile 引用 sso_session 时刷新命令使用实际 session 名", async () => {
    mockFs.existsSync.mockImplementation((p) => !p.toString().includes("cache"));
    mockFs.readFileSync.mockReturnValue(`
[sso-session aws-zf]
sso_start_url = https://corp.awsapps.com/start
sso_region = us-west-2

[profile aws-main-ro]
sso_session = aws-zf
sso_account_id = 172169962929
sso_role_name = ReadOnly
`);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("aws-main-ro");
    expect(result.valid).toBe(false);
    expect(result.refreshCommand).toBe("aws sso login --sso-session aws-zf");
  });

  it("profile 引用 sso_session 且 token 有效时返回有效", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation((p) => {
      if (p.toString().includes("config")) {
        return `
[sso-session aws-zf]
sso_start_url = https://corp.awsapps.com/start
sso_region = us-west-2

[profile aws-main-ro]
sso_session = aws-zf
`;
      }
      return JSON.stringify({
        startUrl: "https://corp.awsapps.com/start",
        accessToken: "fresh-token",
        expiresAt: "2099-01-01T00:00:00Z",
      });
    });
    mockFs.readdirSync.mockReturnValue(["cache.json"] as unknown as fs.Dirent[]);
    const { SSOClient } = await import("@aws-sdk/client-sso");
    vi.mocked(SSOClient).mockImplementation(() => ({ send: vi.fn().mockResolvedValue({ accountList: [] }) }) as unknown as InstanceType<typeof SSOClient>);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("aws-main-ro");
    expect(result.valid).toBe(true);
    expect(result.refreshCommand).toBe("aws sso login --sso-session aws-zf");
  });

  it("旧式 profile 内联 sso_start_url 时刷新命令使用 --profile", async () => {
    mockFs.existsSync.mockImplementation((p) => !p.toString().includes("cache"));
    mockFs.readFileSync.mockReturnValue(`
[profile legacy]
sso_start_url = https://legacy.awsapps.com/start
sso_region = us-east-1
sso_account_id = 111
`);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("legacy");
    expect(result.valid).toBe(false);
    expect(result.refreshCommand).toBe("aws sso login --profile legacy");
  });

  it("Token 过期时返回无效结果", async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation((p) => {
      const pathStr = p.toString();
      if (pathStr.includes("config")) {
        return `
[sso-session test]
sso_start_url = https://test.awsapps.com/start
sso_region = us-east-1
`;
      }
      return JSON.stringify({
        startUrl: "https://test.awsapps.com/start",
        accessToken: "expired-token",
        expiresAt: "2020-01-01T00:00:00Z",
      });
    });
    mockFs.readdirSync.mockReturnValue(["cache.json"] as unknown as fs.Dirent[]);
    const { validateAWSSSOSession } = await import("../src/aws.js");
    const result = await validateAWSSSOSession("test");
    expect(result.valid).toBe(false);
  });
});
