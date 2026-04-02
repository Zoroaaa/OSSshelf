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
      console.error('Resend API error:', error);
      return { success: false, error: `Failed to send email: ${res.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: 'Network error while sending email' };
  }
}

export const emailTemplates = {
  verifyEmail: (name: string, link: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>验证您的邮箱</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">验证您的邮箱地址</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您好，${name}！
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 24px; color: #374151;">
                感谢您注册 OSSShelf。请点击下方按钮验证您的邮箱地址：
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${link}" style="display: inline-block; padding: 12px 32px; font-size: 16px; font-weight: 500; color: #ffffff; background-color: #4f46e5; border-radius: 6px; text-decoration: none;">
                      验证邮箱
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 30px 0 0 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                此链接将在 24 小时后过期。如果您没有注册 OSSShelf 账户，请忽略此邮件。
              </p>
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

  resetPassword: (name: string, link: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>重置密码</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">重置您的密码</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您好，${name}！
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 24px; color: #374151;">
                我们收到了重置您密码的请求。请点击下方按钮设置新密码：
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${link}" style="display: inline-block; padding: 12px 32px; font-size: 16px; font-weight: 500; color: #ffffff; background-color: #4f46e5; border-radius: 6px; text-decoration: none;">
                      重置密码
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 30px 0 0 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                此链接将在 1 小时后过期。如果您没有请求重置密码，请忽略此邮件。
              </p>
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

  changeEmail: (name: string, newEmail: string, link: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>确认更换邮箱</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">确认更换邮箱</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您好，${name}！
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #374151;">
                您正在申请将账户邮箱更换为：<strong>${newEmail}</strong>
              </p>
              <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 24px; color: #374151;">
                请点击下方按钮确认更换：
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${link}" style="display: inline-block; padding: 12px 32px; font-size: 16px; font-weight: 500; color: #ffffff; background-color: #4f46e5; border-radius: 6px; text-decoration: none;">
                      确认更换
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 30px 0 0 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                此链接将在 1 小时后过期。如果您没有申请更换邮箱，请忽略此邮件。
              </p>
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
