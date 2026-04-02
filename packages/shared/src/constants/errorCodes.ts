/**
 * errorCodes.ts
 * 统一错误码定义
 *
 * 错误码格式：[模块][类型][序号]
 * 模块前缀：
 *   G = 通用模块 (General)
 *   A = 认证模块 (Auth)
 *   F = 文件模块 (File)
 *   S = 分享模块 (Share)
 *   B = 存储桶模块 (Bucket)
 *   U = 用户模块 (User)
 *   T = 任务模块 (Task)
 *   P = 权限模块 (Permission)
 *   X = 系统模块 (System)
 *
 * 类型后缀：
 *   0xx = 通用/未知错误
 *   1xx = 参数验证错误
 *   2xx = 权限错误
 *   3xx = 资源不存在
 *   4xx = 状态冲突
 *   5xx = 外部服务错误
 */

export interface ErrorInfo {
  code: string;
  httpStatus: number;
  message: string;
}

export const ERROR_CODES: Record<string, ErrorInfo> = {
  // ═══════════════════════════════════════════════════════════════
  // 通用错误 G0xx
  // ═══════════════════════════════════════════════════════════════
  INTERNAL_ERROR: { code: 'G000', httpStatus: 500, message: '服务器内部错误' },
  SERVICE_UNAVAILABLE: { code: 'G001', httpStatus: 503, message: '服务暂时不可用' },
  RATE_LIMIT_EXCEEDED: { code: 'G002', httpStatus: 429, message: '请求过于频繁，请稍后重试' },
  INVALID_REQUEST: { code: 'G003', httpStatus: 400, message: '无效的请求' },
  FEATURE_DISABLED: { code: 'G004', httpStatus: 403, message: '该功能已禁用' },

  // 通用验证 G1xx
  VALIDATION_ERROR: { code: 'G100', httpStatus: 400, message: '参数验证失败' },
  MISSING_PARAMETER: { code: 'G101', httpStatus: 400, message: '缺少必要参数' },
  INVALID_PARAMETER: { code: 'G102', httpStatus: 400, message: '参数格式无效' },
  PARAMETER_OUT_OF_RANGE: { code: 'G103', httpStatus: 400, message: '参数超出有效范围' },

  // ═══════════════════════════════════════════════════════════════
  // 认证模块 A0xx-A5xx
  // ═══════════════════════════════════════════════════════════════
  UNAUTHORIZED: { code: 'A000', httpStatus: 401, message: '未授权，请先登录' },
  TOKEN_EXPIRED: { code: 'A001', httpStatus: 401, message: '登录已过期，请重新登录' },
  TOKEN_INVALID: { code: 'A002', httpStatus: 401, message: '无效的登录凭证' },
  TOKEN_MISSING: { code: 'A003', httpStatus: 401, message: '缺少登录凭证' },
  SESSION_EXPIRED: { code: 'A004', httpStatus: 401, message: '会话已过期' },
  SESSION_REVOKED: { code: 'A005', httpStatus: 401, message: '会话已被注销' },

  // 认证验证 A1xx
  INVALID_EMAIL: { code: 'A100', httpStatus: 400, message: '邮箱格式无效' },
  INVALID_PASSWORD: { code: 'A101', httpStatus: 400, message: '密码格式无效' },
  PASSWORD_TOO_SHORT: { code: 'A102', httpStatus: 400, message: '密码长度不足，至少需要6位' },
  PASSWORD_TOO_WEAK: { code: 'A103', httpStatus: 400, message: '密码强度不足' },
  INVALID_NAME: { code: 'A104', httpStatus: 400, message: '用户名格式无效' },
  NAME_TOO_LONG: { code: 'A105', httpStatus: 400, message: '用户名过长' },

  // 认证权限 A2xx
  LOGIN_LOCKED: { code: 'A200', httpStatus: 403, message: '账户已锁定，请稍后重试' },
  DEVICE_LIMIT_EXCEEDED: { code: 'A201', httpStatus: 403, message: '登录设备数量已达上限' },
  ACCOUNT_DISABLED: { code: 'A202', httpStatus: 403, message: '账户已被禁用' },
  ADMIN_REQUIRED: { code: 'A203', httpStatus: 403, message: '需要管理员权限' },

  // 认证状态 A4xx
  EMAIL_ALREADY_REGISTERED: { code: 'A400', httpStatus: 409, message: '该邮箱已被注册' },
  EMAIL_NOT_REGISTERED: { code: 'A401', httpStatus: 404, message: '该邮箱未注册' },
  WRONG_PASSWORD: { code: 'A402', httpStatus: 401, message: '密码错误' },
  EMAIL_NOT_VERIFIED: { code: 'A403', httpStatus: 403, message: '邮箱未验证' },
  EMAIL_TOKEN_EXPIRED: { code: 'A404', httpStatus: 400, message: '验证链接已过期' },
  EMAIL_TOKEN_INVALID: { code: 'A405', httpStatus: 400, message: '验证链接无效' },
  EMAIL_TOKEN_USED: { code: 'A406', httpStatus: 400, message: '验证链接已使用' },
  EMAIL_SEND_FAILED: { code: 'A407', httpStatus: 500, message: '邮件发送失败' },
  EMAIL_NOT_CONFIGURED: { code: 'A408', httpStatus: 500, message: '邮件服务未配置' },

  // ═══════════════════════════════════════════════════════════════
  // 文件模块 F0xx-F5xx
  // ═══════════════════════════════════════════════════════════════
  FILE_NOT_FOUND: { code: 'F000', httpStatus: 404, message: '文件不存在' },
  FILE_TOO_LARGE: { code: 'F001', httpStatus: 413, message: '文件大小超过限制' },
  INVALID_FILE_TYPE: { code: 'F002', httpStatus: 400, message: '不支持的文件类型' },
  FILE_CORRUPTED: { code: 'F003', httpStatus: 400, message: '文件已损坏' },
  FILE_EMPTY: { code: 'F004', httpStatus: 400, message: '文件内容为空' },
  FILE_UPLOAD_FAILED: { code: 'F005', httpStatus: 500, message: '文件上传失败' },
  FILE_DOWNLOAD_FAILED: { code: 'F006', httpStatus: 500, message: '文件下载失败' },
  FILE_DELETE_FAILED: { code: 'F007', httpStatus: 500, message: '文件删除失败' },
  FILE_PREVIEW_NOT_SUPPORTED: { code: 'F008', httpStatus: 400, message: '该文件类型不支持预览' },
  FILE_CONTENT_NOT_FOUND: { code: 'F009', httpStatus: 404, message: '文件内容不存在' },

  // 文件验证 F1xx
  INVALID_FILENAME: { code: 'F100', httpStatus: 400, message: '文件名无效' },
  FILENAME_TOO_LONG: { code: 'F101', httpStatus: 400, message: '文件名过长' },
  INVALID_PATH: { code: 'F102', httpStatus: 400, message: '文件路径无效' },
  FOLDER_NOT_FOUND: { code: 'F103', httpStatus: 404, message: '文件夹不存在' },
  INVALID_MIME_TYPE: { code: 'F104', httpStatus: 400, message: 'MIME类型无效' },
  MIME_TYPE_NOT_ALLOWED: { code: 'F105', httpStatus: 400, message: '该文件类型不允许上传到此文件夹' },

  // 文件权限 F2xx
  FILE_ACCESS_DENIED: { code: 'F200', httpStatus: 403, message: '无权访问此文件' },
  FILE_WRITE_DENIED: { code: 'F201', httpStatus: 403, message: '无权修改此文件' },
  FILE_DELETE_DENIED: { code: 'F202', httpStatus: 403, message: '无权删除此文件' },
  FILE_SHARE_DENIED: { code: 'F203', httpStatus: 403, message: '无权分享此文件' },
  FOLDER_ACCESS_DENIED: { code: 'F204', httpStatus: 403, message: '无权访问此文件夹' },

  // 文件资源 F3xx
  FILE_IN_TRASH: { code: 'F300', httpStatus: 400, message: '文件已在回收站' },
  FILE_NOT_IN_TRASH: { code: 'F301', httpStatus: 400, message: '文件不在回收站中' },
  FILE_ALREADY_RESTORED: { code: 'F302', httpStatus: 400, message: '文件已恢复' },

  // 文件状态 F4xx
  FILE_ALREADY_EXISTS: { code: 'F400', httpStatus: 409, message: '文件已存在' },
  FOLDER_ALREADY_EXISTS: { code: 'F401', httpStatus: 409, message: '文件夹已存在' },
  FOLDER_NOT_EMPTY: { code: 'F402', httpStatus: 400, message: '文件夹不为空' },
  CANNOT_MOVE_TO_SELF: { code: 'F403', httpStatus: 400, message: '不能将文件移动到自身' },
  CANNOT_MOVE_TO_SUBFOLDER: { code: 'F404', httpStatus: 400, message: '不能将文件夹移动到其子文件夹中' },
  CANNOT_DELETE_ROOT: { code: 'F405', httpStatus: 400, message: '不能删除根目录' },

  // 存储相关 F5xx
  STORAGE_EXCEEDED: { code: 'F500', httpStatus: 507, message: '存储空间不足' },
  BUCKET_NOT_FOUND: { code: 'F501', httpStatus: 404, message: '存储桶不存在' },
  BUCKET_CONNECTION_FAILED: { code: 'F502', httpStatus: 502, message: '存储桶连接失败' },
  BUCKET_NOT_ACTIVE: { code: 'F503', httpStatus: 400, message: '存储桶未激活' },
  BUCKET_QUOTA_EXCEEDED: { code: 'F504', httpStatus: 507, message: '存储桶配额已满' },
  NO_STORAGE_CONFIGURED: { code: 'F505', httpStatus: 500, message: '未配置存储桶' },
  PRESIGN_URL_FAILED: { code: 'F506', httpStatus: 500, message: '生成预签名URL失败' },

  // ═══════════════════════════════════════════════════════════════
  // 分享模块 S0xx-S5xx
  // ═══════════════════════════════════════════════════════════════
  SHARE_NOT_FOUND: { code: 'S000', httpStatus: 404, message: '分享链接不存在' },
  SHARE_EXPIRED: { code: 'S001', httpStatus: 410, message: '分享链接已过期' },
  SHARE_PASSWORD_REQUIRED: { code: 'S002', httpStatus: 401, message: '需要访问密码' },
  SHARE_PASSWORD_INVALID: { code: 'S003', httpStatus: 401, message: '访问密码错误' },
  SHARE_DOWNLOAD_LIMIT_EXCEEDED: { code: 'S004', httpStatus: 403, message: '下载次数已达上限' },
  SHARE_UPLOAD_LIMIT_EXCEEDED: { code: 'S005', httpStatus: 403, message: '上传次数已达上限' },
  SHARE_FILE_NOT_FOUND: { code: 'S006', httpStatus: 404, message: '分享的文件不存在' },
  SHARE_FOLDER_NOT_FOUND: { code: 'S007', httpStatus: 404, message: '分享的文件夹不存在' },

  // 分享验证 S1xx
  INVALID_SHARE_ID: { code: 'S100', httpStatus: 400, message: '无效的分享ID' },
  INVALID_UPLOAD_TOKEN: { code: 'S101', httpStatus: 400, message: '无效的上传令牌' },

  // 分享权限 S2xx
  SHARE_CREATE_DENIED: { code: 'S200', httpStatus: 403, message: '无权创建分享' },
  SHARE_DELETE_DENIED: { code: 'S201', httpStatus: 403, message: '无权删除此分享' },
  UPLOAD_LINK_NOT_ALLOWED: { code: 'S202', httpStatus: 400, message: '此分享不支持上传' },
  DOWNLOAD_NOT_ALLOWED: { code: 'S203', httpStatus: 400, message: '此分享不支持下载' },

  // 分享状态 S4xx
  SHARE_ALREADY_EXISTS: { code: 'S400', httpStatus: 409, message: '分享已存在' },
  UPLOAD_LINK_IS_DOWNLOAD: { code: 'S401', httpStatus: 400, message: '此链接为上传链接，不可下载' },
  DOWNLOAD_LINK_IS_UPLOAD: { code: 'S402', httpStatus: 400, message: '此链接为下载链接，不可上传' },

  // ═══════════════════════════════════════════════════════════════
  // 存储桶模块 B0xx-B5xx
  // ═══════════════════════════════════════════════════════════════
  BUCKET_CREATE_FAILED: { code: 'B000', httpStatus: 500, message: '创建存储桶失败' },
  BUCKET_UPDATE_FAILED: { code: 'B001', httpStatus: 500, message: '更新存储桶失败' },
  BUCKET_DELETE_FAILED: { code: 'B002', httpStatus: 500, message: '删除存储桶失败' },
  BUCKET_TEST_FAILED: { code: 'B003', httpStatus: 500, message: '存储桶连接测试失败' },
  BUCKET_MIGRATE_FAILED: { code: 'B004', httpStatus: 500, message: '存储桶迁移失败' },

  // 存储桶验证 B1xx
  INVALID_BUCKET_NAME: { code: 'B100', httpStatus: 400, message: '存储桶名称无效' },
  INVALID_ENDPOINT: { code: 'B101', httpStatus: 400, message: '端点URL无效' },
  INVALID_ACCESS_KEY: { code: 'B102', httpStatus: 400, message: '访问密钥无效' },
  INVALID_SECRET_KEY: { code: 'B103', httpStatus: 400, message: '密钥无效' },
  INVALID_PROVIDER: { code: 'B104', httpStatus: 400, message: '不支持的存储提供商' },

  // 存储桶权限 B2xx
  BUCKET_ACCESS_DENIED: { code: 'B200', httpStatus: 403, message: '无权访问此存储桶' },
  BUCKET_OWNER_REQUIRED: { code: 'B201', httpStatus: 403, message: '需要存储桶所有者权限' },

  // 存储桶状态 B4xx
  BUCKET_ALREADY_EXISTS: { code: 'B400', httpStatus: 409, message: '存储桶已存在' },
  BUCKET_IN_USE: { code: 'B401', httpStatus: 400, message: '存储桶正在使用中，无法删除' },
  DEFAULT_BUCKET_EXISTS: { code: 'B402', httpStatus: 400, message: '已存在默认存储桶' },

  // ═══════════════════════════════════════════════════════════════
  // 用户模块 U0xx-U5xx
  // ═══════════════════════════════════════════════════════════════
  USER_NOT_FOUND: { code: 'U000', httpStatus: 404, message: '用户不存在' },
  USER_CREATE_FAILED: { code: 'U001', httpStatus: 500, message: '创建用户失败' },
  USER_UPDATE_FAILED: { code: 'U002', httpStatus: 500, message: '更新用户失败' },
  USER_DELETE_FAILED: { code: 'U003', httpStatus: 500, message: '删除用户失败' },

  // 用户验证 U1xx
  INVALID_USER_ID: { code: 'U100', httpStatus: 400, message: '用户ID无效' },

  // 用户权限 U2xx
  USER_ACCESS_DENIED: { code: 'U200', httpStatus: 403, message: '无权访问此用户信息' },
  CANNOT_DELETE_SELF: { code: 'U201', httpStatus: 400, message: '不能删除自己的账户' },
  CANNOT_MODIFY_ADMIN: { code: 'U202', httpStatus: 403, message: '不能修改管理员账户' },

  // 用户状态 U4xx
  USER_ALREADY_EXISTS: { code: 'U400', httpStatus: 409, message: '用户已存在' },

  // ═══════════════════════════════════════════════════════════════
  // 任务模块 T0xx-T5xx
  // ═══════════════════════════════════════════════════════════════
  TASK_NOT_FOUND: { code: 'T000', httpStatus: 404, message: '任务不存在' },
  TASK_EXPIRED: { code: 'T001', httpStatus: 410, message: '任务已过期' },
  TASK_CREATE_FAILED: { code: 'T002', httpStatus: 500, message: '创建任务失败' },
  TASK_CANCEL_FAILED: { code: 'T003', httpStatus: 500, message: '取消任务失败' },
  TASK_RETRY_FAILED: { code: 'T004', httpStatus: 500, message: '重试任务失败' },

  // 任务验证 T1xx
  INVALID_URL: { code: 'T100', httpStatus: 400, message: 'URL格式无效' },
  UNSUPPORTED_URL: { code: 'T101', httpStatus: 400, message: '不支持的URL类型' },

  // 任务状态 T4xx
  TASK_ALREADY_RUNNING: { code: 'T400', httpStatus: 409, message: '任务正在运行中' },
  TASK_ALREADY_COMPLETED: { code: 'T401', httpStatus: 400, message: '任务已完成' },
  TASK_ALREADY_CANCELLED: { code: 'T402', httpStatus: 400, message: '任务已取消' },
  TASK_ALREADY_FAILED: { code: 'T403', httpStatus: 400, message: '任务已失败' },
  CANNOT_PAUSE_TASK: { code: 'T404', httpStatus: 400, message: '无法暂停此任务' },
  CANNOT_RESUME_TASK: { code: 'T405', httpStatus: 400, message: '无法恢复此任务' },
  CANNOT_RETRY_TASK: { code: 'T406', httpStatus: 400, message: '只能重试失败的任务' },
  CANNOT_DELETE_RUNNING_TASK: { code: 'T407', httpStatus: 400, message: '无法删除正在运行的任务' },

  // ═══════════════════════════════════════════════════════════════
  // 权限模块 P0xx-P5xx
  // ═══════════════════════════════════════════════════════════════
  PERMISSION_DENIED: { code: 'P000', httpStatus: 403, message: '权限不足' },
  PERMISSION_NOT_FOUND: { code: 'P001', httpStatus: 404, message: '权限记录不存在' },
  PERMISSION_CREATE_FAILED: { code: 'P002', httpStatus: 500, message: '创建权限失败' },
  PERMISSION_DELETE_FAILED: { code: 'P003', httpStatus: 500, message: '删除权限失败' },

  // 权限验证 P1xx
  INVALID_PERMISSION_LEVEL: { code: 'P100', httpStatus: 400, message: '无效的权限级别' },

  // 权限状态 P4xx
  PERMISSION_ALREADY_EXISTS: { code: 'P400', httpStatus: 409, message: '权限已存在' },
  CANNOT_MODIFY_OWNER_PERMISSION: { code: 'P401', httpStatus: 400, message: '不能修改所有者权限' },

  // ═══════════════════════════════════════════════════════════════
  // 版本控制模块 V0xx-V5xx
  // ═══════════════════════════════════════════════════════════════
  VERSION_NOT_FOUND: { code: 'V000', httpStatus: 404, message: '版本不存在' },
  VERSION_CREATE_FAILED: { code: 'V001', httpStatus: 500, message: '创建版本失败' },
  VERSION_RESTORE_FAILED: { code: 'V002', httpStatus: 500, message: '恢复版本失败' },
  VERSION_DELETE_FAILED: { code: 'V003', httpStatus: 500, message: '删除版本失败' },
  VERSION_DIFF_FAILED: { code: 'V004', httpStatus: 500, message: '版本对比失败' },

  // 版本验证 V1xx
  INVALID_VERSION_NUMBER: { code: 'V100', httpStatus: 400, message: '无效的版本号' },
  VERSION_NOT_SUPPORTED: { code: 'V101', httpStatus: 400, message: '此文件不支持版本控制' },
  FOLDER_VERSION_NOT_SUPPORTED: { code: 'V102', httpStatus: 400, message: '文件夹不支持版本控制' },

  // 版本状态 V4xx
  VERSION_LIMIT_EXCEEDED: { code: 'V400', httpStatus: 400, message: '版本数量已达上限' },
  CANNOT_DELETE_CURRENT_VERSION: { code: 'V401', httpStatus: 400, message: '不能删除当前版本' },

  // ═══════════════════════════════════════════════════════════════
  // AI 模块 I0xx-I5xx
  // ═══════════════════════════════════════════════════════════════
  AI_SERVICE_UNAVAILABLE: { code: 'I000', httpStatus: 503, message: 'AI服务暂不可用' },
  AI_ANALYZE_FAILED: { code: 'I001', httpStatus: 500, message: 'AI分析失败' },
  AI_OCR_FAILED: { code: 'I002', httpStatus: 500, message: 'OCR识别失败' },
  AI_CLASSIFY_FAILED: { code: 'I003', httpStatus: 500, message: '图像分类失败' },

  // AI 验证 I1xx
  AI_NOT_SUPPORTED_FOR_FILE: { code: 'I100', httpStatus: 400, message: '此文件类型不支持AI分析' },
  AI_FILE_TOO_LARGE: { code: 'I101', httpStatus: 400, message: '文件过大，无法进行AI分析' },
  AI_QUOTA_EXCEEDED: { code: 'I102', httpStatus: 429, message: 'AI调用次数已达上限' },

  // ═══════════════════════════════════════════════════════════════
  // Telegram 存储模块 TG0xx-TG5xx
  // ═══════════════════════════════════════════════════════════════
  TG_UPLOAD_FAILED: { code: 'TG00', httpStatus: 502, message: 'Telegram上传失败' },
  TG_DOWNLOAD_FAILED: { code: 'TG01', httpStatus: 502, message: 'Telegram下载失败' },
  TG_DELETE_FAILED: { code: 'TG02', httpStatus: 502, message: 'Telegram删除失败' },
  TG_REF_NOT_FOUND: { code: 'TG03', httpStatus: 404, message: 'Telegram文件引用不存在' },
  TG_CONFIG_ERROR: { code: 'TG04', httpStatus: 500, message: 'Telegram配置错误' },
  TG_FILE_TOO_LARGE: { code: 'TG05', httpStatus: 413, message: '文件超过Telegram限制（最大2GB）' },
  TG_CHUNKED_DOWNLOAD_FAILED: { code: 'TG06', httpStatus: 502, message: 'Telegram分片下载失败' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function getErrorInfo(code: ErrorCode): ErrorInfo {
  const info = ERROR_CODES[code];
  return info ?? (ERROR_CODES.INTERNAL_ERROR as ErrorInfo);
}

export function getErrorMessage(code: ErrorCode): string {
  const info = ERROR_CODES[code];
  const internalMsg = (ERROR_CODES.INTERNAL_ERROR as ErrorInfo).message;
  return info?.message ?? internalMsg;
}

export function getHttpStatus(code: ErrorCode): number {
  const info = ERROR_CODES[code];
  const internalStatus = (ERROR_CODES.INTERNAL_ERROR as ErrorInfo).httpStatus;
  return info?.httpStatus ?? internalStatus;
}
