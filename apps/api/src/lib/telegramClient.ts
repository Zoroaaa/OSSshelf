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
  botToken: string; // Bot Token (来自 @BotFather)
  chatId: string; // 目标 Chat ID（频道/群组/私聊）
  apiBase?: string; // 可选 Bot API 代理地址
}

import { logger } from '@osshelf/shared';

export interface TgUploadResult {
  fileId: string; // Telegram file_id（永久引用）
  messageId: number; // 消息 ID（删除时使用）
  fileSize: number;
  mimeType?: string;
}

export interface TgFileInfo {
  fileId: string;
  filePath: string; // Telegram 内部路径，用于构造下载 URL
  fileSize: number;
}

// Telegram Bot API 单次上传上限（50MB）
// 超过此大小需改用 telegramChunked.ts 的分片上传机制（分成 ≤49MB 的块）
export const TG_MAX_FILE_SIZE = 50 * 1024 * 1024;

// 触发分片上传的阈值（与 TG_CHUNK_SIZE 一致）
export const TG_CHUNKED_THRESHOLD = 49 * 1024 * 1024;

// Worker 支持的分片上传最大总大小（500MB ≈ 10 块，约 30s 内完成）
export const TG_MAX_CHUNKED_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB，Telegram Bot API 真实上限

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
  // Telegram Message 可能包含的媒体类型（按优先级检查）：
  // document, audio, video, animation, sticker, photo, video_note, voice, paid_media
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
  } else if (msg.animation) {
    // 动画 GIF 或 webp 动图
    tgFileId = msg.animation.file_id;
    tgFileSize = msg.animation.file_size || fileBuffer.byteLength;
  } else if (msg.sticker) {
    // webp 静态贴纸
    tgFileId = msg.sticker.file_id;
    tgFileSize = msg.sticker.file_size || fileBuffer.byteLength;
  } else if (msg.video_note) {
    // 圆形视频消息
    tgFileId = msg.video_note.file_id;
    tgFileSize = msg.video_note.file_size || fileBuffer.byteLength;
  } else if (msg.voice) {
    // 语音消息
    tgFileId = msg.voice.file_id;
    tgFileSize = msg.voice.file_size || fileBuffer.byteLength;
  } else if (msg.paid_media) {
    // 付费媒体 - 取第一个媒体项
    const paidMedia = msg.paid_media.paid_media?.[0];
    if (paidMedia?.type === 'photo' && paidMedia.photo) {
      const photos = paidMedia.photo as any[];
      const largest = photos.sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0))[0];
      tgFileId = largest.file_id;
      tgFileSize = largest.file_size || fileBuffer.byteLength;
    } else if (paidMedia?.type === 'video' && paidMedia.video) {
      tgFileId = paidMedia.video.file_id;
      tgFileSize = paidMedia.video.file_size || fileBuffer.byteLength;
    }
  } else if (msg.photo) {
    // photo 数组，取最大尺寸
    const photos = msg.photo as any[];
    const largest = photos.sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0))[0];
    tgFileId = largest.file_id;
    tgFileSize = largest.file_size || fileBuffer.byteLength;
  }

  if (!tgFileId) {
    logger.error('TELEGRAM', '响应缺少file_id', { response: JSON.stringify(msg).slice(0, 500) });
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
 * 流式上传文件到 Telegram（零复制转发）
 * 与 tgUploadFile 区别：接受 ReadableStream 而非 ArrayBuffer，
 * 避免在 Worker 内存中缓冲完整文件，防止 OOM。
 * 用于 /telegram-part 端点将前端分片直接 pipe 到 TG Bot API。
 */
export async function tgUploadStream(
  config: TelegramBotConfig,
  stream: ReadableStream<Uint8Array>,
  fileName: string,
  fileSize: number,
  mimeType: string | null | undefined,
  caption?: string
): Promise<TgUploadResult> {
  const method = selectSendMethod(mimeType);
  const url = botUrl(config, method);
  const fieldName = method === 'sendAudio' ? 'audio' : 'document';

  // 构造 multipart boundary
  const boundary = `----WKBoundary${crypto.randomUUID().replace(/-/g, '')}`;
  const encoder = new TextEncoder();

  // 前置 part headers
  const preamble = [
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${config.chatId}`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="disable_notification"\r\n\r\ntrue`,
    ...(caption
      ? [`\r\n--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}`]
      : []),
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${encodeURIComponent(fileName)}"\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
  ].join('');

  const epilogue = `\r\n--${boundary}--\r\n`;
  const preambleBytes = encoder.encode(preamble);
  const epilogueBytes = encoder.encode(epilogue);
  const totalLength = preambleBytes.byteLength + fileSize + epilogueBytes.byteLength;

  // 将 preamble + stream + epilogue 合并为单一 ReadableStream
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // 异步写入，不阻塞主流程
  (async () => {
    try {
      await writer.write(preambleBytes);
      const reader = stream.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.write(epilogueBytes);
      await writer.close();
    } catch (e) {
      await writer.abort(e);
    }
  })();

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(totalLength),
    },
    body: readable,
    // @ts-expect-error — Cloudflare Workers 支持 duplex fetch
    duplex: 'half',
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Telegram API HTTP ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as any;
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description || JSON.stringify(json)}`);
  }

  const msg = json.result;
  let tgFileId: string | null = null;
  let tgFileSize = 0;

  if (msg.document) {
    tgFileId = msg.document.file_id;
    tgFileSize = msg.document.file_size || fileSize;
  } else if (msg.audio) {
    tgFileId = msg.audio.file_id;
    tgFileSize = msg.audio.file_size || fileSize;
  } else if (msg.video) {
    tgFileId = msg.video.file_id;
    tgFileSize = msg.video.file_size || fileSize;
  } else if (msg.animation) {
    tgFileId = msg.animation.file_id;
    tgFileSize = msg.animation.file_size || fileSize;
  } else if (msg.sticker) {
    tgFileId = msg.sticker.file_id;
    tgFileSize = msg.sticker.file_size || fileSize;
  } else if (msg.video_note) {
    tgFileId = msg.video_note.file_id;
    tgFileSize = msg.video_note.file_size || fileSize;
  } else if (msg.voice) {
    tgFileId = msg.voice.file_id;
    tgFileSize = msg.voice.file_size || fileSize;
  } else if (msg.paid_media) {
    const paidMedia = msg.paid_media.paid_media?.[0];
    if (paidMedia?.type === 'photo' && paidMedia.photo) {
      const photos = paidMedia.photo as any[];
      const largest = photos.sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0))[0];
      tgFileId = largest.file_id;
      tgFileSize = largest.file_size || fileSize;
    } else if (paidMedia?.type === 'video' && paidMedia.video) {
      tgFileId = paidMedia.video.file_id;
      tgFileSize = paidMedia.video.file_size || fileSize;
    }
  } else if (msg.photo) {
    const largest = (msg.photo as any[]).sort((a: any, b: any) => (b.file_size || 0) - (a.file_size || 0))[0];
    tgFileId = largest.file_id;
    tgFileSize = largest.file_size || fileSize;
  }

  if (!tgFileId) {
    logger.error('TELEGRAM', '流响应缺少file_id', { response: JSON.stringify(msg).slice(0, 500) });
    throw new Error('Telegram 响应中未找到 file_id');
  }

  return { fileId: tgFileId, messageId: msg.message_id, fileSize: tgFileSize, mimeType: mimeType || undefined };
}

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
export async function tgDeleteMessage(config: TelegramBotConfig, messageId: number): Promise<void> {
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
      logger.warn('TELEGRAM', '删除消息失败', { description: json.description });
    }
  } catch (error) {
    logger.warn('TELEGRAM', '删除消息异常', {}, error);
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
    const chatTitle = chatJson.result.title || chatJson.result.username || `Chat ${config.chatId}`;

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
