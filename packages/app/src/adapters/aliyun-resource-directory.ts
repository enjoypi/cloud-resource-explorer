import type { Resource } from "../entities/index.js";
import { createAliyunConfig } from "./aliyun-credentials.js";
import { log, logAliyunAuthError } from "../utils/index.js";

export interface RDAccount {
  accountId: string;
  displayName: string;
  folderId: string;
  joinMethod: string;
  joinTime: string;
  status: string;
  type: string;
}

export async function collectAliyunRDAccounts(profileName: string): Promise<Resource[]> {
  const config = await createAliyunConfig(profileName, "cn-hangzhou");
  if (!config) return [];
  config.endpoint = "resourcedirectory.aliyuncs.com";
  try {
    const rdModule = await import("@alicloud/resourcedirectorymaster20220419");
    const RD = (rdModule.default as any).default || rdModule.default;
    const { ListAccountsRequest } = rdModule;
    const client = new RD(config);
    const accounts: RDAccount[] = [];
    let pageNumber = 1;
    while (true) {
      const resp = await client.listAccounts(new ListAccountsRequest({ pageNumber, pageSize: 100 }));
      const items = resp.body?.accounts?.account || [];
      for (const a of items as any[]) {
        accounts.push({
          accountId: a.accountId || "", displayName: a.displayName || "", folderId: a.folderId || "",
          joinMethod: a.joinMethod || "", joinTime: a.joinTime || "", status: a.status || "", type: a.type || "",
        });
      }
      if (items.length < 100) break;
      pageNumber++;
    }
    log.debug(` RD Accounts ${profileName}: ${accounts.length}`);
    return accounts.map(a => ({
      cloud: "aliyun" as const, profile: profileName, type: "rd-account", id: a.accountId, name: a.displayName,
      accountId: a.accountId, region: "global", project: "", tags: {}, status: a.status, collectedAt: new Date(),
    }));
  } catch (e: any) {
    logAliyunAuthError(profileName, e);
    return [];
  }
}

export async function getResourceDirectoryId(profileName: string): Promise<string | undefined> {
  const config = await createAliyunConfig(profileName, "cn-hangzhou");
  if (!config) return undefined;
  config.endpoint = "resourcemanager.aliyuncs.com";
  try {
    const rmModule = await import("@alicloud/resourcemanager20200331");
    const RM = (rmModule.default as any).default || rmModule.default;
    return (await new RM(config).getResourceDirectory({})).body?.resourceDirectory?.resourceDirectoryId;
  } catch (e: any) {
    logAliyunAuthError(profileName, e);
    return undefined;
  }
}
