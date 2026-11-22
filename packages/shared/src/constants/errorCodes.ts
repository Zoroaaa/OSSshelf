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

/**
 * 统一错误码表。
 *
 * 约束：使用 `as const satisfies Record<string, ErrorInfo>`。
 * - 每一项都必须满足 ErrorInfo 结构（防止漏写 httpStatus/message）；
 * - 键名集合就是 ErrorCode 联合类型，`throwAppError('未定义的码')` 会直接类型报错，
 *   避免运行时取不到 ERROR_CODES[code] 而把业务错误降级成 500。
 */
export const ERROR_CODES = {
  // ═══════════════════════════════════════════════════════════════
  // 通用错误 G0xx
  // ═══════════════════════════════════════════════════════════════
  INTERNAL_ERROR: { code: 'G000', httpStatus: 500, message: '服务器内部错误' },
  SERVICE_UNAVAILABLE: { code: 'G001', httpStatus: 503, message: '服务暂时不可用' },
  RATE_LIMIT_EXCEEDED: { code: 'G002', httpStatus: 429, message: '请求过于频繁，请稍后重试' },
  INVALID_REQUEST: { code: 'G003', httpStatus: 400, message: '无效的请求' },
  FEATURE_DISABLED: { code: 'G004', httpStatus: 403, message: '该功能已禁用' },
  NOT_FOUND: { code: 'G404', httpStatus: 404, message: '记录不存在' },
  CONFLICT: { code: 'G409', httpStatus: 409, message: '资源状态冲突' },

  // 通用验证 G1xx
  VALIDATION_ERROR: { code: 'G100', httpStatus: 400, message: '参数验证失败' },
  MISSING_PARAMETER: { code: 'G101', httpStatus: 400, message: '缺少必要参数' },
  INVALID_PARAMETER: { code: 'G102', httpStatus: 400, message: '参数格式无效' },
  PARAMETER_OUT_OF_RANGE: { code: 'G103', httpStatus: 400, message: '参数超出有效范围' },

  // ═══════════════════════════════════════════════════════════════
  // 认证模块 A0xx-A5xx
  // ═══════════════════════════════════════════════════════════════
  UNAUTHORIZED: { code: 'A000', httpStatus: 401, message: '未授权，请先登录' },
  FORBIDDEN: { code: 'A001', httpStatus: 403, message: '禁止访问' },
  TOKEN_EXPIRED: { code: 'A006', httpStatus: 401, message: '登录已过期，请重新登录' },
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
  INVITE_CODE_REQUIRED: { code: 'A106', httpStatus: 400, message: '需要邀请码才能注册' },
  INVITE_CODE_INVALID: { code: 'A107', httpStatus: 400, message: '邀请码无效或已过期' },
  INVITE_CODE_USED: { code: 'A108', httpStatus: 400, message: '邀请码已被使用' },

  // 认证权限 A2xx
  LOGIN_LOCKED: { code: 'A200', httpStatus: 403, message: '账户已锁定，请稍后重试' },
  DEVICE_LIMIT_EXCEEDED: { code: 'A201', httpStatus: 403, message: '登录设备数量已达上限' },
  ACCOUNT_DISABLED: { code: 'A202', httpStatus: 403, message: '账户已被禁用' },
  ADMIN_REQUIRED: { code: 'A203', httpStatus: 403, message: '需要管理员权限' },
  // 注册开关关闭：前端据此展示「注册已关闭」而不是通用失败
  REGISTRATION_CLOSED: { code: 'A204', httpStatus: 403, message: '注册已关闭，请联系管理员' },

  // 认证状态 A4xx
  EMAIL_ALREADY_REGISTERED: { code: 'A400', httpStatus: 409, message: '该邮箱已被注册' },
  EMAIL_NOT_REGISTERED: { code: 'A401', httpStatus: 404, message: '该邮箱未注册' },
  WRONG_PASSWORD: { code: 'A402', httpStatus: 401, message: '密码错误' },
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
  // 「用户还没配桶」是前置条件缺失（400），与 F505「服务端没有可用配置」（500）区分开
  STORAGE_NOT_CONFIGURED: { code: 'F507', httpStatus: 400, message: '未配置存储桶，请先在存储桶管理中添加' },
  STORAGE_FETCH_FAILED: { code: 'F508', httpStatus: 502, message: '从存储读取文件失败' },
  STORAGE_AUDIT_FAILED: { code: 'F509', httpStatus: 500, message: '存储审计失败' },
  STORAGE_AUDIT_NEEDED: { code: 'F510', httpStatus: 400, message: '请先执行审计获取孤儿文件列表' },
  STORAGE_AUDIT_REQUIRED: { code: 'F511', httpStatus: 409, message: '请先执行一次存储审计' },
  FILE_NOT_EDITABLE: { code: 'F512', httpStatus: 400, message: '该文件不支持在线编辑' },
  PREVIEW_TOO_LARGE: { code: 'F513', httpStatus: 400, message: '文件过大，无法预览' },
  FILE_EDIT_TOO_LARGE: { code: 'F515', httpStatus: 400, message: '文件过大，无法在线编辑' },
  S3_ERROR: { code: 'F514', httpStatus: 500, message: '对象存储操作失败' },

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
  BUCKET_IN_USE: { code: 'B401', httpStatus: 409, message: '存储桶正在使用中，无法删除' },
  DEFAULT_BUCKET_EXISTS: { code: 'B402', httpStatus: 400, message: '已存在默认存储桶' },
  BUCKET_IS_DEFAULT: { code: 'B403', httpStatus: 409, message: '默认存储桶不能删除' },
  BUCKET_LAST_ACTIVE: { code: 'B404', httpStatus: 409, message: '至少需要保留一个可用存储桶' },
  BUCKET_CONFIG_ERROR: { code: 'B405', httpStatus: 500, message: '存储桶配置异常' },
  BUCKET_SWITCH_REQUIRES_MIGRATION: { code: 'B406', httpStatus: 409, message: '切换存储桶前需要完成迁移' },
  CROSS_BUCKET: { code: 'B407', httpStatus: 409, message: '跨存储桶操作需要先迁移' },

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
  TEAM_OWNERSHIP_TRANSFER_REQUIRED: {
    code: 'U203',
    httpStatus: 409,
    message: '仍拥有团队，需先转移所有权后才能注销',
  },

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
  TAG_EXISTS: { code: 'P402', httpStatus: 409, message: '标签已存在' },

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
  VERSION_CLEANUP_FAILED: { code: 'V402', httpStatus: 500, message: '清理历史版本失败' },

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
  AI_CONFIG_INVALID: { code: 'I103', httpStatus: 400, message: 'AI 模型配置无效' },

  // AI 运行时 I2xx
  AI_UNAUTHORIZED: { code: 'I200', httpStatus: 401, message: 'AI 会话身份校验失败' },
  AI_RATE_LIMIT: { code: 'I201', httpStatus: 429, message: 'AI 请求过于频繁，请稍后重试' },
  AI_CONTEXT_OVERFLOW: { code: 'I202', httpStatus: 400, message: '对话上下文超出模型限制' },

  // AI 上游 I5xx
  AI_TIMEOUT: { code: 'I500', httpStatus: 504, message: 'AI 模型响应超时' },
  AI_UPSTREAM_ERROR: { code: 'I501', httpStatus: 502, message: 'AI 上游服务异常' },
  AI_TOOL_FAILED: { code: 'I502', httpStatus: 500, message: 'AI 工具执行失败' },
  DUPLICATE_MODEL: { code: 'I503', httpStatus: 409, message: '模型已存在' },

  // ═══════════════════════════════════════════════════════════════
  // 团队 / 用户组 / 邀请模块 TM0xx-TM5xx
  // ═══════════════════════════════════════════════════════════════
  TEAM_NOT_FOUND: { code: 'TM000', httpStatus: 404, message: '团队不存在' },
  TEAM_ACCESS_DENIED: { code: 'TM200', httpStatus: 403, message: '您不是该团队成员' },
  TEAM_UPDATE_FAILED: { code: 'TM001', httpStatus: 500, message: '更新团队失败' },
  TEAM_DELETE_FAILED: { code: 'TM002', httpStatus: 500, message: '删除团队失败' },
  MEMBER_NOT_FOUND: { code: 'TM003', httpStatus: 404, message: '成员不存在' },
  MEMBER_ADD_FAILED: { code: 'TM004', httpStatus: 500, message: '添加成员失败' },
  MEMBER_REMOVE_FAILED: { code: 'TM005', httpStatus: 500, message: '移除成员失败' },
  ROLE_CHANGE_FAILED: { code: 'TM006', httpStatus: 500, message: '修改成员角色失败' },
  RESOURCE_MOUNT_FAILED: { code: 'TM007', httpStatus: 500, message: '挂载团队资源失败' },
  RESOURCE_UNMOUNT_FAILED: { code: 'TM008', httpStatus: 500, message: '取消挂载团队资源失败' },
  WORKSPACE_ERROR: { code: 'TM009', httpStatus: 500, message: '团队工作区操作失败' },
  INVITE_CREATE_FAILED: { code: 'TM010', httpStatus: 500, message: '创建邀请失败' },
  INVITE_REVOKE_FAILED: { code: 'TM011', httpStatus: 500, message: '撤销邀请失败' },
  INVITE_NOT_FOUND: { code: 'TM012', httpStatus: 404, message: '邀请不存在或已失效' },
  INVITE_ACCEPT_FAILED: { code: 'TM013', httpStatus: 400, message: '接受邀请失败' },
  GROUP_NOT_FOUND: { code: 'TM100', httpStatus: 404, message: '用户组不存在' },
  GROUP_ACCESS_DENIED: { code: 'TM101', httpStatus: 403, message: '无权访问该用户组' },

  // ═══════════════════════════════════════════════════════════════
  // 笔记模块 N0xx-N2xx
  // ═══════════════════════════════════════════════════════════════
  NOTE_NOT_FOUND: { code: 'N000', httpStatus: 404, message: '笔记不存在' },
  NOTE_EDIT_DENIED: { code: 'N200', httpStatus: 403, message: '无权编辑此笔记' },
  NOTE_DELETE_DENIED: { code: 'N201', httpStatus: 403, message: '无权删除此笔记' },
  NOTE_PIN_DENIED: { code: 'N202', httpStatus: 403, message: '无权置顶此笔记' },

  // ═══════════════════════════════════════════════════════════════
  // API Key / Webhook / 迁移 模块
  // ═══════════════════════════════════════════════════════════════
  API_KEY_NOT_FOUND: { code: 'K000', httpStatus: 404, message: 'API Key 不存在' },
  WEBHOOK_NOT_FOUND: { code: 'W000', httpStatus: 404, message: 'Webhook 不存在' },
  MIGRATION_NOT_FOUND: { code: 'M000', httpStatus: 404, message: '迁移任务不存在或已过期' },

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
  TG_REF_MISSING: { code: 'TG07', httpStatus: 500, message: 'Telegram 文件引用缺失' },
  TG_BUCKET_NOT_FOUND: { code: 'TG08', httpStatus: 404, message: '找不到 Telegram 存储桶' },

  // ═══════════════════════════════════════════════════════════════
  // 系统 / 告警 X0xx
  // ═══════════════════════════════════════════════════════════════
  ALERT_NOT_CONFIGURED: { code: 'X001', httpStatus: 400, message: '告警未配置' },
  ALERT_SEND_FAILED: { code: 'X002', httpStatus: 502, message: '告警发送失败' },
} as const satisfies Record<string, ErrorInfo>;

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
