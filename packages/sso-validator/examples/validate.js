#!/usr/bin/env node
import { aws, aliyun } from "@cloud-explorer/sso-validator";

async function main() {
  console.log("=== AWS SSO 验证 ===");
  const awsSessions = aws.parseAWSSSOSessions();
  console.log(`发现 ${awsSessions.length} 个 SSO Session`);
  
  for (const session of awsSessions) {
    console.log(`\n检查 Session: ${session.name}`);
    const result = await aws.validateAWSSSOSession(session.name);
    if (result.valid) {
      console.log("✓ 有效");
    } else {
      console.log(`✗ 无效 - 请运行: ${result.refreshCommand}`);
    }
  }

  console.log("\n=== 阿里云 SSO 验证 ===");
  const testProfile = "default";
  const aliyunResult = aliyun.validateAliyunCredential(testProfile);
  console.log(`Profile: ${aliyunResult.profile}`);
  if (aliyunResult.valid) {
    console.log("✓ 有效");
  } else {
    console.log(`✗ 无效 - 请运行: ${aliyunResult.refreshCommand}`);
    if (aliyunResult.expiredAt) {
      console.log(`过期时间: ${aliyunResult.expiredAt}`);
    }
  }
}

main().catch(console.error);
