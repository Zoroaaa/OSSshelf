// 构建前把站点地址写入 capacitor.config.json 的 server.url。
// OSSshelf 是自部署项目，站点域名不入库，由 APP_URL（workflow 输入或仓库变量）提供。
// 必须在 `npx cap add android` 之前运行，否则 sync 出的原生配置不含地址。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(mobileDir, 'capacitor.config.json');

const raw = (process.env.APP_URL ?? '').trim();
if (!raw) {
  throw new Error('缺少 APP_URL：请在 workflow 输入 app_url，或在仓库 Settings → Variables 配置 APP_URL（如 https://files.example.com）');
}

let url;
try {
  url = new URL(raw);
} catch {
  throw new Error(`APP_URL 不是合法地址: ${raw}`);
}
if (url.protocol !== 'https:') {
  throw new Error(`APP_URL 必须是 https（cleartext 已关闭）: ${raw}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.server = {
  ...config.server,
  // 去掉末尾斜杠，避免与 Capacitor 拼接路径时出现双斜杠
  url: url.origin,
  // 只允许站点自身导航；其它域名由 Capacitor 交给系统浏览器
  allowNavigation: [url.host],
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(`[mobile] server.url=${url.origin}`);
