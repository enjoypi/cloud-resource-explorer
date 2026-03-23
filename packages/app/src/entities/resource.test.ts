import { describe, it, expect } from "vitest";
import type { Resource } from "./resource.js";

describe("Resource", () => {
  it("should define Resource interface correctly", () => {
    const resource: Resource = {
      cloud: "aws", profile: "test-profile", accountId: "123456789012",
      type: "compute", id: "i-12345678", name: "test-instance",
      region: "us-east-1", project: "test-project",
      tags: { project: "test-project", Name: "test-instance" },
      collectedAt: new Date(),
    };
    expect(resource.cloud).toBe("aws");
    expect(resource.type).toBe("compute");
    expect(resource.accountId).toBe("123456789012");
    expect(resource.tags?.project).toBe("test-project");
  });

  it("should allow optional tags and accountId", () => {
    const resource: Resource = {
      cloud: "aliyun", profile: "test-profile", type: "storage",
      id: "bucket-1", name: "my-bucket", region: "global",
      project: "", collectedAt: new Date(),
    };
    expect(resource.tags).toBeUndefined();
    expect(resource.accountId).toBeUndefined();
  });
});
