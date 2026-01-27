import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { YamlConfigLoader } from "./config-loader";
import type { Config } from "../entities/index.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Property 7: 配置优先级", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const cloudArb = fc.constantFrom("aws", "aliyun", "all") as fc.Arbitrary<"aws" | "aliyun" | "all">;
  const typesArb = fc.array(fc.constantFrom("compute", "storage", "network", "slb", "database"), {
    minLength: 1,
    maxLength: 5,
  });
  const profilesArb = fc.array(fc.string({ minLength: 1, maxLength: 16 }), { minLength: 0, maxLength: 3 });
  const pathArb = fc.string({ minLength: 1, maxLength: 32 }).map((s) => `./${s.replace(/[^a-zA-Z0-9]/g, "")}`);
  const ttlArb = fc.integer({ min: 1, max: 1440 });
  const concurrencyArb = fc.integer({ min: 1, max: 20 });

  it("命令行参数优先于 YAML 配置", () => {
    fc.assert(
      fc.property(cloudArb, cloudArb, typesArb, typesArb, (yamlCloud, cliCloud, yamlTypes, cliTypes) => {
        const loader = new YamlConfigLoader();
        const yamlPath = path.join(tempDir, "config.yaml");
        fs.writeFileSync(yamlPath, `cloud: ${yamlCloud}\ntypes: [${yamlTypes.join(", ")}]`);
        const cliArgs: Partial<Config> = { cloud: cliCloud, types: cliTypes };
        const result = loader.load(yamlPath, cliArgs);
        expect(result.cloud).toBe(cliCloud);
        expect(result.types).toEqual(cliTypes);
      }),
      { numRuns: 100 }
    );
  });

  it("YAML 配置优先于默认值", () => {
    fc.assert(
      fc.property(cloudArb, ttlArb, concurrencyArb, (yamlCloud, yamlTtl, yamlConcurrency) => {
        const loader = new YamlConfigLoader();
        const yamlPath = path.join(tempDir, "config.yaml");
        fs.writeFileSync(yamlPath, `cloud: ${yamlCloud}\ncacheTtl: ${yamlTtl}\nconcurrency: ${yamlConcurrency}`);
        const result = loader.load(yamlPath, {});
        expect(result.cloud).toBe(yamlCloud);
        expect(result.cacheTtl).toBe(yamlTtl);
        expect(result.concurrency).toBe(yamlConcurrency);
      }),
      { numRuns: 100 }
    );
  });

  it("无 YAML 文件时使用默认值", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (randomName) => {
        const loader = new YamlConfigLoader();
        const nonExistentPath = path.join(tempDir, `${randomName}-nonexistent.yaml`);
        const result = loader.load(nonExistentPath, {});
        expect(result.cloud).toBe("all");
        expect(result.cacheTtl).toBe(60);
        expect(result.concurrency).toBe(5);
        expect(result.forceRefresh).toBe(false);
        expect(result.cacheDir).toBe("./.cache");
        expect(result.aliyun.regions).toEqual([]);
        expect(result.aws.regions).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it("命令行部分参数与 YAML 部分参数正确合并", () => {
    fc.assert(
      fc.property(cloudArb, pathArb, ttlArb, pathArb, (yamlCloud, yamlOutput, cliTtl, cliLogDir) => {
        const loader = new YamlConfigLoader();
        const yamlPath = path.join(tempDir, "config.yaml");
        fs.writeFileSync(yamlPath, `cloud: ${yamlCloud}\noutputDir: ${yamlOutput}`);
        const cliArgs: Partial<Config> = { cacheTtl: cliTtl, logDir: cliLogDir };
        const result = loader.load(yamlPath, cliArgs);
        expect(result.cloud).toBe(yamlCloud);
        expect(result.outputDir).toBe(yamlOutput);
        expect(result.cacheTtl).toBe(cliTtl);
        expect(result.logDir).toBe(cliLogDir);
      }),
      { numRuns: 100 }
    );
  });

  it("forceRefresh 布尔值正确处理优先级", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (yamlForce, cliForce) => {
        const loader = new YamlConfigLoader();
        const yamlPath = path.join(tempDir, "config.yaml");
        fs.writeFileSync(yamlPath, `forceRefresh: ${yamlForce}`);
        const cliArgs: Partial<Config> = { forceRefresh: cliForce };
        const result = loader.load(yamlPath, cliArgs);
        expect(result.forceRefresh).toBe(cliForce);
      }),
      { numRuns: 100 }
    );
  });
});
