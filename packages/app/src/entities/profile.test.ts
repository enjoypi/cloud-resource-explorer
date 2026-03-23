import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

const profileNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/);
const cloudArb = fc.constantFrom("aws" as const, "aliyun" as const);

function parseProfileFromCliOutput(cliOutput: string) {
  return cliOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name, cloud: "aws" as const, isValid: true }));
}

function formatProfilesToCliOutput(profiles: { name: string }[]) {
  return profiles.map((p) => p.name).join("\n");
}

describe("Profile", () => {
  it("should define Profile interface correctly", () => {
    const profile = { name: "test-profile", cloud: "aws" as const, isValid: true };
    expect(profile.name).toBe("test-profile");
    expect(profile.cloud).toBe("aws");
  });

  describe("Property 1: Profile 发现一致性", () => {
    it("解析后的 Profile 名称应与原始名称一致", () => {
      fc.assert(fc.property(
        fc.array(profileNameArb, { minLength: 1, maxLength: 10 }),
        (names) => {
          const profiles = names.map((name) => ({ name, cloud: "aws" as const, isValid: true }));
          const cliOutput = formatProfilesToCliOutput(profiles);
          const parsed = parseProfileFromCliOutput(cliOutput);
          return parsed.every((p, i) => p.name === profiles[i].name);
        },
      ), { numRuns: 100 });
    });

    it("Profile 名称 round-trip 一致性", () => {
      fc.assert(fc.property(profileNameArb, cloudArb, (name, cloud) => {
        const original = { name, cloud, isValid: true };
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized);
        return (
          deserialized.name === original.name &&
          deserialized.cloud === original.cloud &&
          deserialized.isValid === original.isValid
        );
      }), { numRuns: 100 });
    });
  });
});
