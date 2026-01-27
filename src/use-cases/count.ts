import type { Config, Profile, CollectTask } from "../entities/index.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import { log } from "../utils/index.js";
import { generateTasks, expandTypes, initProfilesAndRegions, createRegionGetter } from "./collect.js";

export interface CountInput { config: Config; profileAdapter: ProfileAdapter; viewArn?: string; }
export interface TypeCount { type: string; resourceType: string; count: number; complete: boolean; }
export interface CountResult { profile: string; cloud: string; region: string; counts: TypeCount[]; total: number; }
export interface CountOutput { results: CountResult[]; grandTotal: number; }

export async function countResources(input: CountInput): Promise<CountOutput> {
  const { config, profileAdapter } = input;
  const results: CountResult[] = [];
  let grandTotal = 0;

  const { profiles: allProfiles, regionCache } = await initProfilesAndRegions(config, profileAdapter);
  const getRegions = createRegionGetter(regionCache, config);
  const expandedTypes = expandTypes(config.types);
  const tasks = generateTasks(allProfiles, expandedTypes, getRegions, undefined, config.aws.resourceExplorerViewArn);

  log.info(`开始统计资源数量，共 ${tasks.length} 个任务...`);

  for (const task of tasks) {
    const counts = await profileAdapter.countResources(task);
    if (counts.length > 0) {
      const total = counts.reduce((sum, c) => sum + c.count, 0);
      results.push({ profile: task.profile.name, cloud: task.profile.cloud, region: task.region, counts, total });
      grandTotal += total;
    }
  }

  return { results, grandTotal };
}

export function printCountSummary(output: CountOutput): void {
  console.log("\n资源数量统计：");
  console.log("─".repeat(60));

  const byType = new Map<string, number>();
  for (const result of output.results) {
    for (const c of result.counts) byType.set(c.resourceType, (byType.get(c.resourceType) || 0) + c.count);
  }

  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(40)} ${count}`);
  }

  console.log("─".repeat(60));
  console.log(`  总计: ${output.grandTotal} 个资源\n`);
}
