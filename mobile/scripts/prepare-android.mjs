// 在 `npx cap sync android` 之后运行：注入版本号、UA 标识，并按环境变量启用 release 签名。
// android/ 不入库、每次由模板生成，因此这些配置只能在这里补齐。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(mobileDir, '..');
const gradlePath = path.join(mobileDir, 'android/app/build.gradle');

const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match) throw new Error(`无法从根 package.json 解析版本号: ${version}`);

// Android 要求 versionCode 单调递增：主 * 10000 + 次 * 100 + 修订
const versionCode = Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);

let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

const hasSigning = Boolean(
  process.env.ANDROID_KEYSTORE_PATH &&
    process.env.ANDROID_KEYSTORE_PASSWORD &&
    process.env.ANDROID_KEY_ALIAS &&
    process.env.ANDROID_KEY_PASSWORD
);

// 幂等：重复执行时不再插入第二份签名配置
if (hasSigning && !gradle.includes('signingConfigs {')) {
  const signingConfigs = `    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
`;
  const before = gradle;
  gradle = gradle.replace(/(\n\s*buildTypes\s*\{)/, `\n${signingConfigs}$1`);
  gradle = gradle.replace(
    /(release\s*\{\s*\n)(\s*)minifyEnabled false/,
    `$1$2signingConfig signingConfigs.release\n$2minifyEnabled false`
  );
  // 模板变更导致正则没命中时必须失败，否则会静默产出未签名的 release 包
  if (!gradle.includes('signingConfigs.release') || gradle === before) {
    throw new Error('未能向 build.gradle 注入签名配置，Capacitor 模板可能已变更');
  }
}

fs.writeFileSync(gradlePath, gradle);
console.log(`[android] versionName=${version} versionCode=${versionCode} signed=${hasSigning}`);

// UA 标识：直接改 sync 生成的副本，版本始终取自根 package.json，不会像静态配置那样过期。
const genConfigPath = path.join(mobileDir, 'android/app/src/main/assets/capacitor.config.json');
const genConfig = JSON.parse(fs.readFileSync(genConfigPath, 'utf8'));
genConfig.android = { ...(genConfig.android ?? {}), appendUserAgent: `OSSshelfApp/${version}` };
fs.writeFileSync(genConfigPath, JSON.stringify(genConfig, null, 2) + '\n');
console.log(`[android] appendUserAgent=OSSshelfApp/${version}`);
