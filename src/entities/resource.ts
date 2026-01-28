export interface Resource {
  cloud: "aws" | "aliyun";
  profile: string;
  accountId?: string;
  type: string;
  id: string;
  name: string;
  region: string; // 'global' for Global_Resource
  project: string;
  tags?: Record<string, string>;
  collectedAt: Date;
  createdAt?: string; // 资源创建时间
  spec?: string; // 实例规格，如 db.t3.medium, ecs.c6.xlarge
  engine?: string; // 数据库引擎，如 mysql, postgres
  ip?: string;
  bucketName?: string;
  status?: string;
  cidr?: string;
  port?: number;
  dns?: string;
  origin?: string;
  recordType?: string;
  nodeCount?: number;
  userName?: string;
  userId?: string;
  policyNames?: string[];
}
