/**
 * emailService.ts
 * 邮件服务核心模块
 *
 * 功能:
 * - Resend API集成
 * - 邮件配置管理（KV存储）
 * - 邮件模板生成
 * - 邮件发送功能
 */

import type { Env } from '../types/env';
import { logger } from '@osshelf/shared';

const RESEND_API_URL = 'https://api.resend.com/emails';
const KV_CONFIG_KEY = 'config:resend';

export interface ResendConfig {
  apiKey: string;
  fromAddress: string;
  fromName: string;
}

export interface EmailPreferences {
  mention: boolean;
  share_received: boolean;
  quota_warning: boolean;
  ai_complete: boolean;
  system: boolean;
}

export async function getResendConfig(kv: KVNamespace): Promise<ResendConfig | null> {
  const configStr = await kv.get(KV_CONFIG_KEY);
  if (!configStr) return null;

  try {
    return JSON.parse(configStr) as ResendConfig;
  } catch {
    return null;
  }
}

export async function saveResendConfig(kv: KVNamespace, config: ResendConfig): Promise<void> {
  await kv.put(KV_CONFIG_KEY, JSON.stringify(config));
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const config = await getResendConfig(env.KV);
  if (!config) {
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${config.fromName} <${config.fromAddress}>`,
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      logger.error('EMAIL', 'Resend API错误', { status: res.status, error });
      return { success: false, error: `Failed to send email: ${res.status}` };
    }

    return { success: true };
  } catch (error) {
    logger.error('EMAIL', '邮件发送失败', {}, error);
    return { success: false, error: 'Network error while sending email' };
  }
}

export function generateVerificationCode(): string {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

export const emailTemplates = {
  verifyEmail: (name: string, code: string, expiryMinutes: number = 10): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证您的邮箱</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f4f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); overflow: hidden;">
          <tr>
            <td style="padding: 50px 40px 30px 40px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
              <div style="width: 70px; height: 70px; background-color: rgba(255, 255, 255, 0.2); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="font-size: 36px;">✉️</span>
              </div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">验证您的邮箱地址</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 35px 40px 25px 40px;">
              <p style="margin: 0 0 16px 0; font-size: 17px; line-height: 26px; color: #374151;">
                您好，<strong>${name}</strong>！
              </p>
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 24px; color: #6b7280;">
                感谢您注册 OSSShelf。请使用下方 <strong>6 位验证码</strong> 完成邮箱验证：
              </p>
              <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e9ecf3 100%); border-radius: 12px; padding: 28px; margin: 24px 0; border: 2px dashed #c7d2fe;">
                <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">您的验证码</p>
                <div style="letter-spacing: 12px; font-size: 42px; font-weight: 700; color: #4f46e5; font-family: 'Courier New', monospace; user-select: all;">
                  ${code}
                </div>
              </div>
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin-top: 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 20px; color: #92400e;">
                  ⏰ 验证码有效期为 <strong>${expiryMinutes} 分钟</strong>，请尽快使用
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 18px;">
                此验证码仅供本次操作使用，请勿泄露给他人<br/>
                如果您没有注册 OSSShelf 账户，请忽略此邮件
              </p>
              <p style="margin: 0; font-size: 11px; color: #d1d5db; text-align: center;">
                © ${new Date().getFullYear()} OSSShelf · 安全存储，智能管理
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,

  resetPassword: (name: string, code: string, expiryMinutes: number = 10): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>重置密码验证码</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f4f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); overflow: hidden;">
          <tr>
            <td style="padding: 50px 40px 30px 40px; text-align: center; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
              <div style="width: 70px; height: 70px; background-color: rgba(255, 255, 255, 0.2); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="font-size: 36px;">🔐</span>
              </div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">重置您的密码</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 35px 40px 25px 40px;">
              <p style="margin: 0 0 16px 0; font-size: 17px; line-height: 26px; color: #374151;">
                您好，<strong>${name}</strong>！
              </p>
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 24px; color: #6b7280;">
                我们收到了重置您密码的请求。请使用下方 <strong>6 位验证码</strong> 进行身份验证：
              </p>
              <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 12px; padding: 28px; margin: 24px 0; border: 2px dashed #fca5a5;">
                <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">密码重置验证码</p>
                <div style="letter-spacing: 12px; font-size: 42px; font-weight: 700; color: #dc2626; font-family: 'Courier New', monospace; user-select: all;">
                  ${code}
                </div>
              </div>
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin-top: 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 20px; color: #92400e;">
                  ⏰ 验证码有效期为 <strong>${expiryMinutes} 分钟</strong>，请尽快使用
                </p>
              </div>
              <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 6px; margin-top: 16px;">
                <p style="margin: 0; font-size: 13px; line-height: 20px; color: #1e40af;">
                  🔒 如果这不是您本人的操作，请忽略此邮件，您的账户安全不受影响
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 18px;">
                此验证码仅供本次操作使用，请勿泄露给他人<br/>
                如果您没有请求重置密码，请忽略此邮件
              </p>
              <p style="margin: 0; font-size: 11px; color: #d1d5db; text-align: center;">
                © ${new Date().getFullYear()} OSSShelf · 安全存储，智能管理
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,

  changeEmail: (name: string, newEmail: string, code: string, expiryMinutes: number = 10): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>更换邮箱验证码</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f0f4f8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); overflow: hidden;">
          <tr>
            <td style="padding: 50px 40px 30px 40px; text-align: center; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
              <div style="width: 70px; height: 70px; background-color: rgba(255, 255, 255, 0.2); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="font-size: 36px;">📧</span>
              </div>
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff;">确认更换邮箱</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 35px 40px 25px 40px;">
              <p style="margin: 0 0 16px 0; font-size: 17px; line-height: 26px; color: #374151;">
                您好，<strong>${name}</strong>！
              </p>
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 24px; color: #6b7280;">
                您正在申请将账户邮箱更换为：
              </p>
              <div style="background-color: #eff6ff; border: 2px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
                <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1d4ed8; word-break: break-all;">
                  📬 ${newEmail}
                </p>
              </div>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #6b7280;">
                请使用下方 <strong>6 位验证码</strong> 确认更换：
              </p>
              <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 12px; padding: 28px; margin: 24px 0; border: 2px dashed #6ee7b7;">
                <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">邮箱更换验证码</p>
                <div style="letter-spacing: 12px; font-size: 42px; font-weight: 700; color: #059669; font-family: 'Courier New', monospace; user-select: all;">
                  ${code}
                </div>
              </div>
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin-top: 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 20px; color: #92400e;">
                  ⏰ 验证码有效期为 <strong>${expiryMinutes} 分钟</strong>，请尽快使用
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 18px;">
                此验证码仅供本次操作使用，请勿泄露给他人<br/>
                如果您没有申请更换邮箱，请忽略此邮件
              </p>
              <p style="margin: 0; font-size: 11px; color: #d1d5db; text-align: center;">
                © ${new Date().getFullYear()} OSSShelf · 安全存储，智能管理
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,

  passwordChanged: (name: string, ip: string, time: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>密码已更改</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">密码已更改</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您好，${name}！
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您的账户密码已成功更改。如果这不是您本人的操作，请立即修改密码并联系客服。
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 6px; padding: 20px;">
                <tr>
                  <td style="padding: 10px 20px;">
                    <p style="margin: 0; font-size: 14px; color: #6b7280;">
                      <strong>IP 地址：</strong>${ip}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 20px;">
                    <p style="margin: 0; font-size: 14px; color: #6b7280;">
                      <strong>时间：</strong>${time}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
                © ${new Date().getFullYear()} OSSShelf. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,

  systemNotify: (name: string, title: string, body: string, link?: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您好，${name}！
              </p>
              <p style="margin: 0 0 ${link ? '30' : '0'}px 0; font-size: 16px; line-height: 24px; color: #374151;">
                ${body}
              </p>
              ${
                link
                  ? `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${link}" style="display: inline-block; padding: 12px 32px; font-size: 16px; font-weight: 500; color: #ffffff; background-color: #4f46e5; border-radius: 6px; text-decoration: none;">
                      查看详情
                    </a>
                  </td>
                </tr>
              </table>
              `
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
                © ${new Date().getFullYear()} OSSShelf. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,
};

export function maskApiKey(apiKey: string): string {
  if (apiKey.length < 12) return '***';
  return `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;
}

export function parseEmailPreferences(preferencesStr: string): EmailPreferences {
  try {
    const parsed = JSON.parse(preferencesStr);
    return {
      mention: parsed.mention ?? true,
      share_received: parsed.share_received ?? true,
      quota_warning: parsed.quota_warning ?? true,
      ai_complete: parsed.ai_complete ?? false,
      system: parsed.system ?? true,
    };
  } catch {
    return {
      mention: true,
      share_received: true,
      quota_warning: true,
      ai_complete: false,
      system: true,
    };
  }
}

export function shouldSendEmail(notificationType: string, preferences: EmailPreferences): boolean {
  const typeMap: Record<string, keyof EmailPreferences> = {
    mention: 'mention',
    share_received: 'share_received',
    upload_link_received: 'share_received',
    permission_granted: 'share_received',
    quota_warning: 'quota_warning',
    ai_complete: 'ai_complete',
    system: 'system',
    password_changed: 'system',
  };

  const key = typeMap[notificationType];
  if (!key) return false;

  return preferences[key];
}
