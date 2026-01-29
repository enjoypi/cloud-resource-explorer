import { OrganizationsClient, ListAccountsCommand } from "@aws-sdk/client-organizations";
import { fromIni } from "@aws-sdk/credential-providers";
import { log } from "../utils/index.js";
import type { Resource } from "../entities/index.js";

export interface AWSAccount {
  accountId: string;
  name: string;
  email: string;
  status: string;
  arn: string;
}

export async function listAWSOrganizationAccounts(profileName: string): Promise<AWSAccount[]> {
  const accounts: AWSAccount[] = [];
  try {
    const client = new OrganizationsClient({
      credentials: fromIni({ profile: profileName }),
      region: "us-east-1",
    });
    let nextToken: string | undefined;
    do {
      const response = await client.send(new ListAccountsCommand({ NextToken: nextToken, MaxResults: 20 }));
      for (const account of response.Accounts || []) {
        if (account.Id && account.Status === "ACTIVE") {
          accounts.push({
            accountId: account.Id,
            name: account.Name || account.Id,
            email: account.Email || "",
            status: account.Status || "UNKNOWN",
            arn: account.Arn || "",
          });
        }
      }
      nextToken = response.NextToken;
    } while (nextToken);
    log.info(` AWS Organizations ${profileName}: ${accounts.length} accounts`);
  } catch (e: any) {
    log.debug(`AWS Organizations 查询失败 ${profileName}: ${e.message}`);
  }
  return accounts;
}

export function convertAWSAccountsToResources(
  accounts: AWSAccount[],
  profileName: string
): Resource[] {
  return accounts.map(account => ({
    cloud: "aws" as const,
    profile: profileName,
    accountId: account.accountId,
    type: "org-account",
    id: account.accountId,
    name: account.name,
    region: "global",
    project: "",
    tags: { email: account.email },
    status: account.status,
    collectedAt: new Date(),
  }));
}
