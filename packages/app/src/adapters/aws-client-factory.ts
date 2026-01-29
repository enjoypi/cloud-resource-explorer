import { fromIni } from "@aws-sdk/credential-providers";
import { getSSOCredentials, parseAWSSSOSessions } from "./aws-sso.js";

export async function resolveAWSCredentials(profile: string, accountId?: string): Promise<any> {
  const ssoSession = parseAWSSSOSessions().find(s => s.name === profile);
  if (ssoSession && accountId) {
    const creds = await getSSOCredentials(ssoSession, accountId, ssoSession.roleName || "ReadOnlyAccess");
    if (creds) {
      return {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      };
    }
  }
  return fromIni({ profile });
}
