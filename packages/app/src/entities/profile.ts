export interface SSOSession {
  name: string;
  startUrl: string;
  region: string;
  isValid: boolean;
}

export interface CloudSSOSession {
  profileName: string;
  isValid: boolean;
  rdAccounts?: RDAccount[];
}

export interface RDAccount {
  accountId: string;
  displayName: string;
  status: string;
}

export interface Profile {
  name: string;
  cloud: "aws" | "aliyun";
  accountId?: string;
  accountName?: string;
  ssoSession?: SSOSession;
  cloudSSOSession?: CloudSSOSession;
  isValid: boolean;
}

export interface CollectTask {
  profile: Profile;
  type: string;
  region: string;
  rdAccount?: RDAccount;
  resourceDirectoryId?: string;
  viewArn?: string;
}

export type CollectErrorType = "AUTH_FAILED" | "API_ERROR" | "RATE_LIMITED" | "TIMEOUT" | "UNKNOWN";

export interface CollectError {
  task: CollectTask;
  errorType: CollectErrorType;
  message: string;
}

export interface SSOSessionError {
  session: SSOSession;
  affectedProfiles: string[];
  errorType: "EXPIRED" | "INVALID";
}
