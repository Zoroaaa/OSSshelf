# OSSshelf Android 客户端

Capacitor 壳，加载已部署站点（`server.url`），站点更新无需重新发版。`mobile/` 不在 pnpm workspace 内，独立使用 npm，不影响根锁文件与线上部署。

## 发版

1. 一次性配置（仓库 Settings → Secrets and variables → Actions）：
   - Variable `APP_URL`：站点地址，如 `https://files.example.com`（也可在运行 workflow 时填 `app_url`）
   - Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
2. 确认 Release `v<根 package.json 版本>` 已存在
3. Actions → **Build Android APK** → Run workflow，`release_tag` 填 `v<版本>`

产物 `OSSshelf-Android-<版本>.apk` 会上传到该 Release。未配置签名时只构建 debug 包并留在 Actions 产物里，不会上传。

## 约定

- 版本号取自根 `package.json`；`versionCode = 主 * 10000 + 次 * 100 + 修订`
- `appId` 为 `uk.wort.ossshelf`，发布后不可更改，否则会被系统视为另一个应用
- 密钥丢失后已安装的应用无法覆盖升级，需离线备份
- `android/` 由 CI 从模板生成，不入库
