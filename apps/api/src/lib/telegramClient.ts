/**
 * telegramClient.ts
 * Telegram Bot API 存储客户端
 *
 * 功能:
 * - 通过 Telegram Bot API 上传文件（document/photo/video/audio）
 * - 通过 file_id 下载文件
 * - 删除消息（等同于删除文件）
 * - 测试 Bot 连通性
 * - 支持自定义 Bot API 代理地址
 *
 * 限制说明：
 * - 单文件最大 2GB（Bot API 限制）
 * - Telegram 不支持真正删除已发送文件，删除操作为删除消息
 * - file_id 需持久化到 telegram_file_refs 表
 */

export interface TelegramBotConfig {
  botToken: string;          // Bot Token (来自 @BotFather)
  chatId: string;            // 目标 Chat ID（频道/群组/私聊）
  apiBase?: string;          // 可选代理，默认 https://api.telegram.org
}

export interface TgUploadResult {
  fileId: string;            // Telegram file_id（永久引用）
  messageId: number;         // 消息 ID（删除时使用）
  fileSize: number;
  mimeType?: string;
}

export interface TgFileInfo {
  fileId: string;
  filePath: string;          // Telegram 内部路径，用于构造下载 URL
  fileSize: number;
}

// 最大文件大小：50MB (Telegram Bot API multipart 上传上限)
// 超过此限制需要使用 Telegram MTProto API（本实现不涉及）
export const TG_MAX_FILE_SIZE = 50 * 1024 * 1024;

// 较大文件警告阈值（20MB）- 仍可上传但提示速度较慢
export const TG_WARN_FILE_SIZE = 20 * 1024 * 1024;

function getApiBase(config: TelegramBotConfig): string {
  return (config.apiBase || 'https://api.telegram.org').replace(/\/$/, '');
}

function botUrl(config: TelegramBotConfig, method: string): string {
  return `${getApiBase(config)}/bot${config.botToken}/${method}`;
}

/**
 * 根据 MIME 类型选择最合适的 Telegram 上传方法
 * 使用 sendDocument 作为通用方法，可保留原始文件名和大小
 */
function selectSendMethod(mimeType?: string | null): string {
  if (!mimeType) return 'sendDocument';
  if (mimeType.startsWith('image/') && !mimeType.includes('gif')) return 'sendDocument'; // 避免压缩，用 document
  if (mimeType.startsWith('audio/')) return 'sendAudio';
  if (mimeType.startsWith('video/')) return 'sendDocument'; // video 用 document 避免被压缩
  return 'sendDocument';
}

/**
 * 上传文件到 Telegram
 * 使用 multipart/form-data，将文件内容直接发送
 */
export async function tgUploadFile(
  config: TelegramBotConfig,
  fileBuffer: ArrayBuffer,
  fileName: string,
  mimeType: string | null | undefined,
  caption?: string
): Promise<TgUploadResult> {
  const method = selectSendMethod(mimeType);
  const url = botUrl(config, method);

  const formData = new FormData();
  formData.append('chat_id', config.chatId);

  // 根据方法选择字段名
  const fieldName = method === 'sendAudio' ? 'audio' : 'document';
  const blob = new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' });
  formData.append(fieldName, blob, fileName);

  // 添加 caption，存储文件元信息
  if (caption) {
    formData.append('caption', caption.slice(0, 1024)); // Telegram caption 上限 1024 字符
  }

  // 禁用通知（静默发送）
  formData.append('disable_notification', 'true');

  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Telegram API HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as any;
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description || JSON.stringify(json)}`);
  }

  const msg = json.result;
  const msgId: number = msg.message_id;

  // 从响应中提取 file_id
  let tgFileId: string | null = null;
  let tgFileSize = 0;

  if (msg.document) {
    tgFileId = msg.document.file_id;
    tgFileSize = msg.document.file_size || fileBuffer.byteLength;
  } else if (msg.audio) {
    tgFileId = msg.audio.file_id;
    tgFileSize = msg.audio.file_size || fileBuffer.byteLength;
  } else if (msg.video) {
    tgFileId = msg.video.file_id;
    tgFileSize = msg.video.file_size || fileBuffer.byteLength;
  } else if (msg.photo) {
    // photo 数组，取最大尺寸
    const photos = msg.photo as any[];
    const largest = photos.sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0))[0];
    tgFileId = largest.file_id;
    tgFileSize = largest.file_size || fileBuffer.byteLength;
  }

  if (!tgFileId) {
    throw new Error('Telegram 响应中未找到 file_id，上传可能失败');
  }

  return {
    fileId: tgFileId,
    messageId: msgId,
    fileSize: tgFileSize,
    mimeType: mimeType || undefined,
  };
}

/**
 * 获取文件的下载路径（用于流式下载）
 */
export async function tgGetFileInfo(config: TelegramBotConfig, tgFileId: string): Promise<TgFileInfo> {
  const url = botUrl(config, 'getFile');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: tgFileId }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`getFile HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as any;
  if (!json.ok) {
    throw new Error(`getFile error: ${json.description}`);
  }

  const f = json.result;
  return {
    fileId: f.file_id,
    filePath: f.file_path,
    fileSize: f.file_size || 0,
  };
}

/**
 * 构造文件下载 URL
 */
export function tgGetDownloadUrl(config: TelegramBotConfig, filePath: string): string {
  return `${getApiBase(config)}/file/bot${config.botToken}/${filePath}`;
}

/**
 * 下载文件，返回 Response（用于流式传输）
 */
export async function tgDownloadFile(config: TelegramBotConfig, tgFileId: string): Promise<Response> {
  const info = await tgGetFileInfo(config, tgFileId);
  const downloadUrl = tgGetDownloadUrl(config, info.filePath);
  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    throw new Error(`Telegram 文件下载失败: HTTP ${resp.status}`);
  }
  return resp;
}

/**
 * 删除消息（等同于"删除"文件引用，但 Telegram 服务器上文件仍可能存在一段时间）
 * Telegram Bot 只能删除自己发送的或有管理员权限的消息
 * 如果删除失败（权限不足），静默忽略
 */
export async function tgDeleteMessage(
  config: TelegramBotConfig,
  messageId: number
): Promise<void> {
  try {
    const url = botUrl(config, 'deleteMessage');
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, message_id: messageId }),
    });
    if (!resp.ok) return; // 静默失败
    const json = (await resp.json()) as any;
    if (!json.ok) {
      console.warn(`[TelegramClient] deleteMessage failed: ${json.description}`);
    }
  } catch (e) {
    console.warn('[TelegramClient] deleteMessage exception:', e);
  }
}

/**
 * 测试 Bot 连通性和 Chat 可达性
 */
export async function tgTestConnection(config: TelegramBotConfig): Promise<{
  connected: boolean;
  message: string;
  botName?: string;
  chatTitle?: string;
}> {
  // Step 1: 验证 Bot Token
  try {
    const meUrl = botUrl(config, 'getMe');
    const meResp = await fetch(meUrl);
    if (!meResp.ok) {
      return { connected: false, message: `Bot Token 无效 (HTTP ${meResp.status})` };
    }
    const meJson = (await meResp.json()) as any;
    if (!meJson.ok) {
      return { connected: false, message: `Bot Token 验证失败: ${meJson.description}` };
    }
    const botName = meJson.result.username || meJson.result.first_name;

    // Step 2: 验证 Chat 可达性
    const chatUrl = botUrl(config, 'getChat');
    const chatResp = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId }),
    });
    if (!chatResp.ok) {
      return {
        connected: false,
        message: `Bot @${botName} 验证成功，但 Chat ID 无法访问 (HTTP ${chatResp.status})`,
        botName,
      };
    }
    const chatJson = (await chatResp.json()) as any;
    if (!chatJson.ok) {
      return {
        connected: false,
        message: `Chat "${config.chatId}" 不可达: ${chatJson.description}（请确认 Bot 已加入目标聊天）`,
        botName,
      };
    }
    const chatTitle =
      chatJson.result.title || chatJson.result.username || `Chat ${config.chatId}`;

    return {
      connected: true,
      message: `连接成功！Bot @${botName} → ${chatTitle}`,
      botName,
      chatTitle,
    };
  } catch (e: any) {
    return { connected: false, message: `连接异常: ${e?.message || e}` };
  }
}
