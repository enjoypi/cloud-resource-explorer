import { describe, it, expect, vi } from "vitest";
import { convertBillItems, parseUsage, isSiteMismatchError, alternateEndpoint, queryWithSiteFallback } from "./aliyun-cdn-cost.js";

describe("parseUsage", () => {
  it("GB 直接累加，MB/TB 换算为 GB", () => {
    expect(parseUsage("10.5", "GB")).toEqual({ trafficGB: 10.5, requests: 0 });
    expect(parseUsage("1024", "MB")).toEqual({ trafficGB: 1, requests: 0 });
    expect(parseUsage("2", "TB")).toEqual({ trafficGB: 2048, requests: 0 });
  });

  it("万次/次 归入请求数", () => {
    expect(parseUsage("3", "万次")).toEqual({ trafficGB: 0, requests: 30000 });
    expect(parseUsage("500", "次")).toEqual({ trafficGB: 0, requests: 500 });
  });

  it("未知单位或非数字用量忽略", () => {
    expect(parseUsage("5", "个")).toEqual({ trafficGB: 0, requests: 0 });
    expect(parseUsage("abc", "GB")).toEqual({ trafficGB: 0, requests: 0 });
    expect(parseUsage(undefined, undefined)).toEqual({ trafficGB: 0, requests: 0 });
  });
});

describe("convertBillItems", () => {
  it("财务托管账单按 资源账号+大区+产品 聚合，accountId 取 ownerID、domain 取大区码", () => {
    // 同一成员账号同一大区的流量项与请求项应合并；instanceID 形如 账号ID;大区
    const items = [
      { instanceID: "5024168270807259;AP1", ownerID: "5024168270807259", productCode: "cdn", billAccountID: "100", pretaxAmount: 1.5, usage: "10", usageUnit: "GB", currency: "USD" },
      { instanceID: "5024168270807259;AP1", ownerID: "5024168270807259", productCode: "cdn", billAccountID: "100", pretaxAmount: 0.5, usage: "2", usageUnit: "万次", currency: "USD" },
      { instanceID: "5963464832928127;EU", ownerID: "5963464832928127", productCode: "dcdn", billAccountID: "100", pretaxAmount: 3, usage: "20", usageUnit: "GB", currency: "USD" },
    ];
    const rows = convertBillItems(items, "2026-05");
    expect(rows).toEqual([
      { month: "2026-05", accountId: "5024168270807259", domain: "AP1", product: "CDN", trafficGB: 10, requests: 20000, cost: 2, currency: "USD" },
      { month: "2026-05", accountId: "5963464832928127", domain: "EU", product: "DCDN", trafficGB: 20, requests: null, cost: 3, currency: "USD" },
    ]);
  });

  it("instanceID 无分号大区后缀时 domain 回退为 ACCOUNT_TOTAL", () => {
    const items = [{ instanceID: "5024168270807259", ownerID: "5024168270807259", productCode: "cdn", billAccountID: "100", pretaxAmount: 9, currency: "USD" }];
    expect(convertBillItems(items, "2026-04")).toEqual([
      { month: "2026-04", accountId: "5024168270807259", domain: "ACCOUNT_TOTAL", product: "CDN", trafficGB: null, requests: null, cost: 9, currency: "USD" },
    ]);
  });

  it("无 ownerID 时 accountId 回退为 billAccountID（兼容单账号）", () => {
    const items = [{ instanceID: "100;NA", productCode: "cdn", billAccountID: "100", pretaxAmount: 1, usage: "5", usageUnit: "GB", currency: "CNY" }];
    expect(convertBillItems(items, "2026-05")).toEqual([
      { month: "2026-05", accountId: "100", domain: "NA", product: "CDN", trafficGB: 5, requests: null, cost: 1, currency: "CNY" },
    ]);
  });

  it("缺 instanceID 的条目跳过，空输入返回空", () => {
    expect(convertBillItems([{ pretaxAmount: 1 }], "2026-05")).toEqual([]);
    expect(convertBillItems([], "2026-05")).toEqual([]);
  });

  it("用 productName 优先于 productCode 大写", () => {
    const items = [{ instanceID: "1;AP1", ownerID: "1", productCode: "dcdn", productName: "全站加速", billAccountID: "1", pretaxAmount: 1, currency: "CNY" }];
    expect(convertBillItems(items, "2026-05")[0].product).toBe("全站加速");
  });
});

describe("isSiteMismatchError", () => {
  it("识别国内/国际站不匹配错误", () => {
    expect(isSiteMismatchError(new Error("NotApplicable: code: 400, You are not authorized to call the API operation. Please check whether the caller site matches the API domain regionId."))).toBe(true);
  });
  it("其他错误不误判", () => {
    expect(isSiteMismatchError(new Error("InvalidAccessKeyId"))).toBe(false);
  });
});

describe("alternateEndpoint", () => {
  it("国内站与国际站互换", () => {
    expect(alternateEndpoint("business.aliyuncs.com")).toBe("business.ap-southeast-1.aliyuncs.com");
    expect(alternateEndpoint("business.ap-southeast-1.aliyuncs.com")).toBe("business.aliyuncs.com");
  });
});

describe("queryWithSiteFallback", () => {
  it("首选 endpoint 成功时不重试", async () => {
    const query = vi.fn(async (ep: string) => ep);
    const resolved: string[] = [];
    const result = await queryWithSiteFallback("business.aliyuncs.com", query, ep => resolved.push(ep));
    expect(result).toBe("business.aliyuncs.com");
    expect(query).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual(["business.aliyuncs.com"]);
  });

  it("站点不匹配时切换另一站点重试并记录", async () => {
    const query = vi.fn(async (ep: string) => {
      if (ep === "business.aliyuncs.com") throw new Error("caller site matches the API domain regionId");
      return "ok";
    });
    const resolved: string[] = [];
    const result = await queryWithSiteFallback("business.aliyuncs.com", query, ep => resolved.push(ep));
    expect(result).toBe("ok");
    expect(query).toHaveBeenCalledTimes(2);
    expect(resolved).toEqual(["business.ap-southeast-1.aliyuncs.com"]);
  });

  it("非站点错误直接抛出不重试", async () => {
    const query = vi.fn(async () => { throw new Error("Forbidden"); });
    await expect(queryWithSiteFallback("business.aliyuncs.com", query, () => {})).rejects.toThrow("Forbidden");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
