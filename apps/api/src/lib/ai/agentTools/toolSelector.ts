/**
 * toolSelector.ts
 * 工具集动态裁剪模块
 *
 * 功能:
 * - 按意图分组工具
 * - 根据查询意图选择最小工具子集
 * - 检测写操作意图
 *
 * 目的:
 * - 减少注入 LLM 的 token 数量（从 83 个工具降到约 20 个）
 * - 提高 LLM 工具选择准确率
 */

// 工具分组定义
export const TOOL_GROUPS = {
  search: [
    'search_files',
    'filter_files',
    'search_by_tag',
    'search_duplicates',
    'smart_search',
    'get_similar_files',
    'get_file_details',
  ],
  content: [
    'read_file_text',
    'analyze_image',
    'compare_files',
    'content_preview',
    'extract_metadata',
    'generate_summary',
    'generate_tags',
    'analyze_file_collection', // Phase 9 新增
  ],
  nav: [
    'list_folder',
    'get_folder_tree',
    'navigate_path',
    'get_storage_overview',
    'get_recent_files',
    'get_starred_files',
    'get_parent_chain',
  ],
  stats: [
    'get_storage_stats',
    'get_activity_stats',
    'get_user_quota_info',
    'get_file_type_distribution',
    'get_sharing_stats',
  ],
  write: [
    'create_text_file',
    'create_code_file',
    'create_file_from_template',
    'draft_and_create_file',
    'edit_file_content',
    'append_to_file',
    'find_and_replace',
    'rename_file',
    'move_file',
    'copy_file',
    'delete_file',
    'restore_file',
    'create_folder',
    'batch_rename',
    'star_file',
    'unstar_file',
  ],
  tags: [
    'add_tag',
    'remove_tag',
    'get_file_tags',
    'merge_tags',
    'auto_tag_files',
    'tag_folder',
    'list_all_tags_for_management',
  ],
  share: [
    'create_share_link',
    'list_shares',
    'update_share_settings',
    'revoke_share',
    'get_share_stats',
    'create_direct_link',
    'revoke_direct_link',
    'create_upload_link_for_folder',
  ],
  version: ['get_file_versions', 'restore_version', 'compare_versions', 'set_version_retention'],
  notes: ['add_note', 'get_notes', 'update_note', 'delete_note', 'search_notes'],
  system: [
    'get_system_status',
    'get_help',
    'get_version_info',
    'get_faq',
    'get_user_profile',
    'list_api_keys',
    'create_api_key',
    'revoke_api_key',
    'list_webhooks',
    'create_webhook',
    'get_audit_logs',
  ],
  storage: [
    'get_storage_usage',
    'get_large_files',
    'get_folder_sizes',
    'get_cleanup_suggestions',
    'list_buckets',
    'get_bucket_info',
    'set_default_bucket',
    'migrate_file_to_bucket',
  ],
  permission: [
    'get_file_permissions',
    'grant_permission',
    'revoke_permission',
    'set_folder_access_level',
    'list_user_groups',
    'manage_group_members',
    'list_expired_permissions', // Phase 6 新增
  ],
  ai_enhance: [
    'trigger_ai_summary',
    'trigger_ai_tags',
    'rebuild_vector_index',
    'ask_rag_question',
    'smart_rename_suggest',
    'smart_organize_suggest', // Phase 8 新增
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 子意图关键词快速检测（在 classifyIntent LLM 结果之上叠加）
// 覆盖原先 selectTools 映射中从未注入的工具组
// ─────────────────────────────────────────────────────────────────────────────

const VERSION_PATTERNS =
  /版本|历史版本|上.*版|回滚|版本记录|restore version|version history|rollback|revert|older version/i;

const STORAGE_MANAGE_PATTERNS =
  /桶|bucket|迁移.*文件|文件.*迁移|清理.*建议|大文件.*列表|哪些文件.*大|cleanup suggestion|list bucket|bucket info|set.*default.*bucket/i;

const PERMISSION_PATTERNS =
  /权限|谁能.*访问|谁有权|授权.*给|设置.*权限|访问控制|用户组|分组成员|permission|access control|user group|grant access|who can|把.*给|让.*只能看|让.*只读|收回.*权限|过期.*授权|已过期.*权限|快过期|撤销所有/i;

const AI_ENHANCE_PATTERNS =
  /向量索引|重建索引|rebuild.*index|rag.*问答|语义.*重建|ai.*批量.*标签|smart.*rename.*suggest|整理建议|归类建议|命名混乱|帮我整理|文件乱|怎么整理|哪些没标签/i;

/** 文件集合分析意图（Phase 9） */
const COLLECTION_ANALYSIS_PATTERNS =
  /分析这批|分析这些|这个文件夹.*内容|对比这些文件|提取共同|梳理一下|汇总这些|文件集合.*分析|批量.*分析/i;

/** 纯查询型分享意图（不含"创建分享"等写操作） */
const SHARE_READ_PATTERNS =
  /分享了哪些|我的分享列表|查看.*分享|分享统计|list.*share|shared files|sharing stats|who.*shared/i;

/** 纯查询型标签意图（不含写标签） */
const TAG_READ_PATTERNS = /所有标签|标签列表|有哪些标签|标签管理|list.*tag|all tags|tag.*list/i;

/** 笔记/备注查询意图 */
const NOTES_READ_PATTERNS = /查看.*备注|我的备注|备注.*列表|搜索.*备注|note.*list|get.*note|search.*note/i;

// ─────────────────────────────────────────────────────────────────────────────
// 写意图检测
//
// Fix 2：精确化英文模式，消除高假阳性单词
// 删除了独立使用时假阳性极高的词：
//   'new', 'add', 'note', 'tag', 'mark', 'clear', 'save', 'store', 'put'
// 改为动词+对象的上下文组合模式
// 中文部分保持不变（中文语境下歧义较少）
// ─────────────────────────────────────────────────────────────────────────────
const WRITE_INTENT_PATTERNS = new RegExp(
  [
    // ════════════════════════════════════════════════════════════════
    // 文件操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '创建',
    '新建',
    '建立',
    '生成.*文件',
    '制作.*文件',
    '编辑',
    '修改',
    '更改',
    '更新',
    '改一下',
    '删除',
    '移除',
    '清除',
    '删掉',
    '去掉',
    '移动',
    '转移',
    '搬到',
    '重命名',
    '改名',
    '修改名',
    '复制',
    '拷贝',
    '克隆',
    '恢复文件',
    '还原文件',
    '撤销删除',

    // ════════════════════════════════════════════════════════════════
    // 标签操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '打.*标签',
    '加.*标签',
    '添加.*标签',
    '设置.*标签',
    '标记.*文件',
    '移除.*标签',
    '删除.*标签',
    '去掉.*标签',
    '取消.*标签',
    '贴.*标签',
    '给.*打标',

    // ════════════════════════════════════════════════════════════════
    // 分享操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '分享.*文件',
    '共享.*文件',
    '创建.*链接',
    '生成.*链接',
    '发.*链接',
    '公开.*文件',
    '对外分享',

    // ════════════════════════════════════════════════════════════════
    // 收藏操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '收藏',
    '加.*收藏',
    '加入收藏',
    '标.*星',
    '加星',
    '星标',
    '取消.*收藏',
    '取消.*星标',
    '移出收藏',

    // ════════════════════════════════════════════════════════════════
    // 备注操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '添加.*备注',
    '写.*备注',
    '加.*备注',
    '添加.*说明',

    // ════════════════════════════════════════════════════════════════
    // 权限操作类（中文）
    // ════════════════════════════════════════════════════════════════
    '授权给',
    '取消.*授权',
    '设置.*权限',
    '修改.*权限',
    '开放.*权限',

    // ════════════════════════════════════════════════════════════════
    // 通用写操作词（中文）
    // ════════════════════════════════════════════════════════════════
    '写入',
    '上传',

    // ════════════════════════════════════════════════════════════════
    // 口语化整理类（中文）—— 高频但原先未覆盖
    // ════════════════════════════════════════════════════════════════
    '整理.*文件',
    '整理.*文件夹',
    '整理一下',
    '帮.*整理',
    '归类',
    '分类.*文件',
    '文件.*归类',
    '清理.*文件',
    '清理.*重复',
    '清理.*垃圾',
    '合并.*文件夹',
    '文件夹.*合并',
    '批量.*重命名',
    '批量.*移动',
    '批量.*删除',
    '批量.*打标',
    '排序.*文件',
    '文件.*排序',

    // ════════════════════════════════════════════════════════════════
    // 英文表达（上下文组合模式，避免单词假阳性）
    // ════════════════════════════════════════════════════════════════
    // 创建类
    'create (a |the |new )?(file|folder|note|document|link|share|webhook|api key)',
    'new (file|folder|document|note)',
    'make (a |the )?(file|folder|copy)',
    'generate (a |the )?(file|summary|tags)',
    // 编辑类
    'edit (the |a |this )?(file|content|note|document)',
    'modify (the |a |this )?(file|content|name|permission)',
    'change (the |a |this )?(name|content|permission|folder)',
    'update (the |a |this )?(file|note|permission|tag)',
    'append (to|content)',
    'find and replace',
    'find & replace',
    // 删除类
    'delete (the |a |this )?(file|folder|note|tag|share|version)',
    'remove (the |a |this )?(file|folder|tag|note|share|permission)',
    'erase (the |a |this )?(file|folder)',
    // 移动/重命名/复制
    'move (the |a |this )?(file|folder)',
    'transfer (the |a |this )?file',
    'relocate (the |a |this )?(file|folder)',
    'rename (the |a |this )?(file|folder)',
    'copy (the |a |this )?(file|folder)',
    'duplicate (the |a |this )?(file|folder)',
    'clone (the |a |this )?(file|folder)',
    // 分享类
    'share (the |a |this )?(file|folder)',
    'create.*share link',
    'revoke.*share',
    // 写入类
    'write (to|into|a |the )?(file|document)',
    'save (the |a |this )?file',
    'save as',
    // 标签/收藏/备注（需要上下文）
    'add (a |the )?(tag|note|comment|label) (to|for)',
    'tag (this|the|a) (file|folder)',
    'label (this|the|a) (file|folder)',
    'mark (this|the|a) (file|folder) as',
    'star (this|the|a) (file|folder)',
    'favorite (this|the|a) (file|folder)',
    'add.*to favorites',
    // 权限类
    'grant (permission|access)',
    'revoke (permission|access)',
    'set.*permission',
    // 恢复类
    'restore (the |a |this )?(file|folder|version)',
    'recover (the |a |this )?(file|folder)',
    'undo delete',
    'undelete',
  ].join('|'),
  'i'
);

/**
 * 检测是否需要写操作工具
 */
export function needsWriteTools(query: string): boolean {
  return WRITE_INTENT_PATTERNS.test(query);
}

/**
 * 根据意图 + 查询关键词选择工具名称集合
 *
 * Fix 1 变更：
 * - 新增子意图关键词补充注入，覆盖原先从未注入的工具组：
 *   version / storage / permission / ai_enhance / share(只读) / tags(只读) / notes(只读)
 * - file_stats 意图同时注入 storage（统计类查询通常也需要桶信息）
 * - general 意图的 system 组精简为只读工具，去掉 create_api_key / create_webhook 等写操作
 */
export function selectTools(intent: string, query: string): string[] {
  const base = [...TOOL_GROUPS.search, ...TOOL_GROUPS.nav];

  // ── 子意图补充注入（与 intent 叠加，不替换）────────────────────────────
  const extras: string[] = [];

  if (VERSION_PATTERNS.test(query)) {
    extras.push(...TOOL_GROUPS.version);
  }
  if (STORAGE_MANAGE_PATTERNS.test(query)) {
    extras.push(...TOOL_GROUPS.storage);
  }
  if (PERMISSION_PATTERNS.test(query)) {
    extras.push(...TOOL_GROUPS.permission);
  }
  if (AI_ENHANCE_PATTERNS.test(query)) {
    extras.push(...TOOL_GROUPS.ai_enhance);
  }
  if (COLLECTION_ANALYSIS_PATTERNS.test(query)) {
    extras.push('analyze_file_collection');
  }
  if (SHARE_READ_PATTERNS.test(query)) {
    extras.push('list_shares', 'get_share_stats');
  }
  if (TAG_READ_PATTERNS.test(query)) {
    extras.push('get_file_tags', 'list_all_tags_for_management');
  }
  if (NOTES_READ_PATTERNS.test(query)) {
    extras.push(...TOOL_GROUPS.notes);
  }

  // ── 按 classifyIntent 意图选主工具集 ────────────────────────────────────
  const byIntent = (() => {
    switch (intent) {
      case 'file_stats':
        return [...base, ...TOOL_GROUPS.stats, ...TOOL_GROUPS.storage, 'search_duplicates'];

      case 'image_visual':
        return [...base, ...TOOL_GROUPS.content];

      case 'content_qa':
        return [...base, ...TOOL_GROUPS.content, ...TOOL_GROUPS.notes];

      case 'file_search':
        return [...base, ...TOOL_GROUPS.content];

      case 'general':
        // 只注入只读系统工具，去掉写类（create_api_key / create_webhook / revoke_api_key）
        return [
          ...base,
          ...TOOL_GROUPS.stats,
          'get_system_status',
          'get_help',
          'get_version_info',
          'get_faq',
          'get_user_profile',
          'list_api_keys',
          'list_webhooks',
          'get_audit_logs',
        ];

      default:
        return [...base, ...TOOL_GROUPS.stats, 'get_system_status', 'get_help', 'get_version_info', 'get_faq'];
    }
  })();

  return [...new Set([...byIntent, ...extras])];
}

/**
 * 获取完整工具集名称列表（用于调试或特殊场景）
 */
export function getAllToolNames(): string[] {
  return Object.values(TOOL_GROUPS).flat();
}

/**
 * 获取工具分组信息（用于调试）
 */
export function getToolGroupNames(): string[] {
  return Object.keys(TOOL_GROUPS);
}
