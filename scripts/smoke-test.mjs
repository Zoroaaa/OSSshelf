#!/usr/bin/env node
/**
 * 本地冒烟测试（前后端 + 关键接口 + 前端资源）
 *
 * 用法：
 *   1) 先起后端：pnpm --filter api dev        （默认 http://127.0.0.1:8787）
 *   2) 再起前端：pnpm --filter web dev        （默认 http://localhost:3000）
 *   3) 运行：   node scripts/smoke-test.mjs
 *
 * 可用环境变量覆盖：
 *   BASE_URL / API_URL / SMOKE_EMAIL / SMOKE_PASSWORD / SMOKE_NAME
 *
 * 说明：
 * - 账号不存在时自动注册（本地首个用户即管理员且邮箱已验证），存在则登录。
 * - 退出码 0 表示全部通过，1 表示有失败项（便于 CI / pre-push 挂钩）。
 */

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const API_URL = (process.env.API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const EMAIL = process.env.SMOKE_EMAIL || 'dev@example.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'dev123456';
const NAME = process.env.SMOKE_NAME || '本地测试';

const results = [];
let token = '';
let currentUser = null;

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function record(name, ok, detail = '', ms = 0) {
  results.push({ name, ok, detail, ms });
  const icon = ok ? c.green('PASS') : c.red('FAIL');
  const time = ms ? c.gray(`${ms}ms`) : '';
  console.log(`  ${icon}  ${name}${detail ? c.gray(` — ${detail}`) : ''} ${time}`);
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '', Date.now() - started);
    return true;
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error), Date.now() - started);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const { base = API_URL, auth = false, expectJson = true, timeout = 15000, ...init } = options;
  const headers = { ...(init.headers || {}) };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  const body = expectJson && contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body, contentType };
}

function expectStatus(result, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  const { response, body } = result;
  if (!list.includes(response.status)) {
    const message =
      typeof body === 'string' ? body.slice(0, 160) : body?.error?.message || body?.error?.code || JSON.stringify(body);
    throw new Error(`HTTP ${response.status}（期望 ${list.join('/')}）：${message}`);
  }
}

async function loginOrRegister() {
  // 先尝试登录（已注册过时最常用）
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, deviceName: 'smoke-test' }),
  });

  if (login.response.ok && login.body?.data?.token) {
    token = login.body.data.token;
    currentUser = login.body.data.user;
    return `登录成功：${EMAIL}（${currentUser?.role || 'user'}）`;
  }

  // 登录失败则注册（仅首次/开放注册场景可用）
  const register = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: NAME }),
  });
  expectStatus(register, 200);
  token = register.body?.data?.token;
  currentUser = register.body?.data?.user;
  assert(token, '注册响应缺少 token');
  return `注册成功：${EMAIL}（${currentUser?.role || 'user'}）`;
}

async function main() {
  console.log(c.bold('\nOSSshelf 本地冒烟测试'));
  console.log(c.gray(`  前端 ${BASE_URL}\n  后端 ${API_URL}\n`));

  console.log(c.cyan('后端 API'));

  await step('GET /health 健康检查', async () => {
    const r = await request('/health', { base: API_URL });
    expectStatus(r, 200);
    assert(r.body?.status === 'ok', 'status 字段不是 ok');
    return 'status=ok';
  });

  await step('GET /api 服务信息', async () => {
    const r = await request('/api', { base: API_URL });
    expectStatus(r, 200);
    assert(r.body?.name === 'OSSshelf API', '返回的服务名不符');
    return `${r.body.name} v${r.body.version}`;
  });

  await step('GET /api/auth/registration-config 注册配置', async () => {
    const r = await request('/api/auth/registration-config', { base: API_URL });
    expectStatus(r, 200);
    return `open=${r.body?.data?.open}`;
  });

  await step('登录 / 注册测试账号', loginOrRegister);

  await step('GET /api/auth/me 当前用户', async () => {
    const r = await request('/api/auth/me', { base: API_URL, auth: true });
    expectStatus(r, 200);
    assert(r.body?.data?.email === EMAIL, '返回用户与登录账号不一致');
    return `${r.body.data.email} / ${r.body.data.role}`;
  });

  await step('GET /api/auth/stats 用户统计', async () => {
    const r = await request('/api/auth/stats', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/files 文件列表（根目录）', async () => {
    const r = await request('/api/files?page=1&pageSize=10', { base: API_URL, auth: true });
    expectStatus(r, 200);
    const items = r.body?.data?.items ?? r.body?.data ?? [];
    assert(Array.isArray(items), '文件列表结构不是数组');
    return `${items.length} 项`;
  });

  await step('GET /api/files/trash 回收站', async () => {
    const r = await request('/api/files/trash', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/buckets 存储桶列表', async () => {
    const r = await request('/api/buckets', { base: API_URL, auth: true });
    expectStatus(r, 200);
    const list = r.body?.data ?? [];
    return `${Array.isArray(list) ? list.length : 0} 个桶`;
  });

  await step('GET /api/notifications 通知列表', async () => {
    const r = await request('/api/notifications', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/notes/:fileId 笔记路由', async () => {
    // 笔记按文件维度查询，无该文件时应返回业务错误而非 404 路由不存在
    const r = await request('/api/notes/00000000-0000-0000-0000-000000000000', { base: API_URL, auth: true });
    expectStatus(r, [403, 404]);
    // 回归断言：error.code 必须是字符串错误码，不能是 ERROR_CODES 配置对象
    assert(typeof r.body?.error?.code === 'string', 'error.code 不是字符串（错误码对象被直接写入了响应）');
    return `HTTP ${r.response.status} / code=${r.body.error.code}`;
  });

  await step('GET /api/teams 团队列表', async () => {
    const r = await request('/api/teams', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/share 分享列表', async () => {
    const r = await request('/api/share', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/permissions/all 权限总览', async () => {
    const r = await request('/api/permissions/all', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/permissions/tags/stats 标签统计', async () => {
    const r = await request('/api/permissions/tags/stats', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('GET /api/ai-config/status AI 配置状态', async () => {
    const r = await request('/api/ai-config/status', { base: API_URL, auth: true });
    expectStatus(r, 200);
    return 'ok';
  });

  let teamId = '';
  await step('POST /api/teams 创建团队（写入链路）', async () => {
    const r = await request('/api/teams', {
      base: API_URL,
      auth: true,
      method: 'POST',
      body: JSON.stringify({ name: `smoke-${Date.now()}`, description: '本地冒烟测试自动创建' }),
    });
    expectStatus(r, 200);
    teamId = r.body?.data?.id;
    assert(teamId, '创建团队未返回 id');
    return `id=${teamId}`;
  });

  await step('GET /api/teams/:id 团队详情', async () => {
    assert(teamId, '前置步骤未创建团队');
    const r = await request(`/api/teams/${teamId}`, { base: API_URL, auth: true });
    expectStatus(r, 200);
    assert(r.body?.data?.id === teamId, '团队详情 id 不一致');
    return r.body.data.name;
  });

  await step('DELETE /api/teams/:id 清理团队', async () => {
    assert(teamId, '前置步骤未创建团队');
    const r = await request(`/api/teams/${teamId}`, { base: API_URL, auth: true, method: 'DELETE' });
    expectStatus(r, 200);
    return 'ok';
  });

  let keyId = '';
  await step('POST /api/keys 创建 API Key（写入链路）', async () => {
    const r = await request('/api/keys', {
      base: API_URL,
      auth: true,
      method: 'POST',
      body: JSON.stringify({ name: `smoke-key-${Date.now()}`, scopes: ['files:read'] }),
    });
    expectStatus(r, 200);
    keyId = r.body?.data?.id;
    assert(keyId, '创建 API Key 未返回 id');
    assert(typeof r.body?.data?.key === 'string' && r.body.data.key.startsWith('osk_'), '返回的密钥格式异常');
    return `id=${keyId} prefix=${r.body.data.keyPrefix}`;
  });

  await step('DELETE /api/keys/:id 清理 API Key', async () => {
    assert(keyId, '前置步骤未创建 API Key');
    const r = await request(`/api/keys/${keyId}`, { base: API_URL, auth: true, method: 'DELETE' });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('未认证请求被拒绝（401）', async () => {
    const r = await request('/api/files', { base: API_URL });
    expectStatus(r, 401);
    return '已正确返回 401';
  });

  await step('CORS 允许本地前端来源', async () => {
    const r = await request('/api', { base: API_URL, method: 'OPTIONS', headers: { Origin: BASE_URL } });
    const allow = r.response.headers.get('access-control-allow-origin');
    assert(allow === BASE_URL || allow === '*', `allow-origin=${allow}`);
    return `allow-origin=${allow}`;
  });

  console.log(c.cyan('\n前端服务'));

  await step('GET / 首屏 HTML', async () => {
    const r = await request('/', { base: BASE_URL, expectJson: false });
    expectStatus(r, 200);
    assert(r.body.includes('id="root"'), '缺少 #root 挂载点');
    assert(r.body.includes('ossshelf-theme'), '缺少主题前置脚本（首屏防闪烁）');
    return `${Math.round(r.body.length / 1024)}KB`;
  });

  await step('SPA 深链回退 /files', async () => {
    const r = await request('/files', { base: BASE_URL, expectJson: false });
    expectStatus(r, 200);
    assert(r.body.includes('id="root"'), '深链未回退到 index.html');
    return 'ok';
  });

  await step('PWA manifest 可访问', async () => {
    const r = await request('/manifest.json', { base: BASE_URL, expectJson: false });
    expectStatus(r, 200);
    return 'ok';
  });

  await step('Vite 代理 /api → 后端', async () => {
    const r = await request('/api', { base: BASE_URL });
    expectStatus(r, 200);
    assert(r.body?.name === 'OSSshelf API', '代理未转发到后端');
    return 'ok';
  });

  await step('Vite 代理 /api/auth/me 携带令牌', async () => {
    const r = await request('/api/auth/me', { base: BASE_URL, auth: true });
    expectStatus(r, 200);
    assert(r.body?.data?.email === EMAIL, '代理登录态异常');
    return 'ok';
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

  console.log('');
  if (failed === 0) {
    console.log(c.green(c.bold(`✓ 全部通过：${passed}/${results.length}，耗时 ${totalMs}ms`)));
  } else {
    console.log(c.red(c.bold(`✗ 失败 ${failed} 项 / 共 ${results.length} 项，耗时 ${totalMs}ms`)));
    console.log(c.red('  失败明细：'));
    for (const r of results.filter((x) => !x.ok)) console.log(c.red(`   - ${r.name}: ${r.detail}`));
  }
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(c.red(`\n冒烟测试异常终止：${error instanceof Error ? error.stack : String(error)}\n`));
  process.exit(1);
});
