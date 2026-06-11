import { describe, it, expect } from "vitest";
import { aggregateDatapointsByMonth, convertCostGroups, monthRangeUTC, monthOfTimestampUTC, clampEndToTomorrowUTC, extractDistributionAccountIds } from "./aws-cdn-cost.js";

describe("monthRangeUTC", () => {
  it("起点为首月 1 日，终点为末月次月 1 日（UTC）", () => {
    const { start, end } = monthRangeUTC(["2026-03", "2026-04", "2026-05"]);
    expect(start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("12 月回卷到次年 1 月", () => {
    const { end } = monthRangeUTC(["2025-12"]);
    expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("monthOfTimestampUTC", () => {
  it("按 UTC 取账期月份", () => {
    expect(monthOfTimestampUTC(new Date("2026-05-31T23:59:59Z"))).toBe("2026-05");
    expect(monthOfTimestampUTC(new Date("2026-06-01T00:00:00Z"))).toBe("2026-06");
  });
});

describe("clampEndToTomorrowUTC", () => {
  const now = new Date("2026-06-11T08:00:00Z");
  it("未来的 End 钳制到明天", () => {
    expect(clampEndToTomorrowUTC(new Date("2026-07-01T00:00:00Z"), now).toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });
  it("过去的 End 保持不变", () => {
    expect(clampEndToTomorrowUTC(new Date("2026-06-01T00:00:00Z"), now).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("aggregateDatapointsByMonth", () => {
  const GB = 1024 ** 3;

  it("按月聚合字节数和请求数", () => {
    const bytes = [
      { Timestamp: new Date("2026-05-01T00:00:00Z"), Sum: 2 * GB },
      { Timestamp: new Date("2026-05-02T00:00:00Z"), Sum: 1 * GB },
      { Timestamp: new Date("2026-06-01T00:00:00Z"), Sum: 4 * GB },
    ];
    const reqs = [
      { Timestamp: new Date("2026-05-01T00:00:00Z"), Sum: 100 },
      { Timestamp: new Date("2026-06-01T00:00:00Z"), Sum: 50 },
    ];
    const rows = aggregateDatapointsByMonth(bytes, reqs, ["2026-05", "2026-06"]);
    expect(rows).toEqual([
      { month: "2026-05", trafficGB: 3, requests: 100 },
      { month: "2026-06", trafficGB: 4, requests: 50 },
    ]);
  });

  it("不在账期列表中的数据点被忽略", () => {
    const bytes = [{ Timestamp: new Date("2026-04-01T00:00:00Z"), Sum: GB }];
    expect(aggregateDatapointsByMonth(bytes, [], ["2026-05"])).toEqual([]);
  });

  it("完全无数据的月份不输出行", () => {
    expect(aggregateDatapointsByMonth([], [], ["2026-05", "2026-06"])).toEqual([]);
  });

  it("只有请求数没有流量时仍输出", () => {
    const reqs = [{ Timestamp: new Date("2026-05-03T00:00:00Z"), Sum: 7 }];
    expect(aggregateDatapointsByMonth([], reqs, ["2026-05"])).toEqual([{ month: "2026-05", trafficGB: 0, requests: 7 }]);
  });

  it("流量保留 3 位小数", () => {
    const bytes = [{ Timestamp: new Date("2026-05-01T00:00:00Z"), Sum: GB / 3 }];
    const rows = aggregateDatapointsByMonth(bytes, [], ["2026-05"]);
    expect(rows[0].trafficGB).toBe(0.333);
  });

  it("缺失 Timestamp/Sum 的数据点被跳过", () => {
    const bytes = [{ Sum: GB }, { Timestamp: new Date("2026-05-01T00:00:00Z") }];
    expect(aggregateDatapointsByMonth(bytes as any, [], ["2026-05"])).toEqual([]);
  });
});

describe("extractDistributionAccountIds", () => {
  it("仅统计 distribution 资源的账号并去重", () => {
    const raw = [
      { Arn: "arn:aws:cloudfront::111:distribution/E1", OwningAccountId: "111" },
      { Arn: "arn:aws:cloudfront::111:distribution/E2", OwningAccountId: "111" },
      { Arn: "arn:aws:cloudfront::222:distribution/E3", OwningAccountId: "222" },
      { Arn: "arn:aws:cloudfront::333:function/fn1", OwningAccountId: "333" },
      { OwningAccountId: "444" },
    ];
    expect(extractDistributionAccountIds(raw)).toEqual(["111", "222"]);
  });

  it("空输入返回空数组", () => {
    expect(extractDistributionAccountIds([])).toEqual([]);
  });
});

describe("convertCostGroups", () => {
  it("解析 Cost Explorer 按账号分组的月度费用", () => {
    const resultsByTime = [
      {
        TimePeriod: { Start: "2026-05-01", End: "2026-06-01" },
        Groups: [
          { Keys: ["111111111111"], Metrics: { UnblendedCost: { Amount: "12.345", Unit: "USD" } } },
          { Keys: ["222222222222"], Metrics: { UnblendedCost: { Amount: "0.5", Unit: "USD" } } },
        ],
      },
      {
        TimePeriod: { Start: "2026-06-01", End: "2026-06-11" },
        Groups: [{ Keys: ["111111111111"], Metrics: { UnblendedCost: { Amount: "3", Unit: "USD" } } }],
      },
    ];
    expect(convertCostGroups(resultsByTime)).toEqual([
      { month: "2026-05", accountId: "111111111111", cost: 12.345, currency: "USD" },
      { month: "2026-05", accountId: "222222222222", cost: 0.5, currency: "USD" },
      { month: "2026-06", accountId: "111111111111", cost: 3, currency: "USD" },
    ]);
  });

  it("零费用与无效分组被跳过", () => {
    const resultsByTime = [
      {
        TimePeriod: { Start: "2026-05-01", End: "2026-06-01" },
        Groups: [
          { Keys: ["111111111111"], Metrics: { UnblendedCost: { Amount: "0", Unit: "USD" } } },
          { Keys: [], Metrics: { UnblendedCost: { Amount: "1", Unit: "USD" } } },
          { Keys: ["333333333333"], Metrics: {} },
        ],
      },
    ];
    expect(convertCostGroups(resultsByTime)).toEqual([]);
  });

  it("空输入返回空数组", () => {
    expect(convertCostGroups([])).toEqual([]);
    expect(convertCostGroups([{ TimePeriod: { Start: "2026-05-01" } }])).toEqual([]);
  });
});
