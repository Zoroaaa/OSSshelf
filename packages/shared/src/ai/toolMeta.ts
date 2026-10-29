/**
 * ai/toolMeta.ts
 * Agent 工具共享元数据（前后端一致的展示名）
 */

export const TOOL_LABELS: Record<string, string> = {
  search_files: '搜索文件',
  search_content: '正文检索',
  smart_search: '智能搜索',
  filter_files: '筛选文件',
  search_by_tag: '标签搜索',
  search_duplicates: '查找重复文件',
  get_similar_files: '相似文件',
  get_file_details: '文件详情',
  get_recent_files: '最近文件',
  get_starred_files: '收藏文件',
  read_file_text: '读取文件内容',
  analyze_image: '图片分析',
  compare_files: '对比文件',
  list_folder: '浏览文件夹',
  get_folder_tree: '目录树',
  get_storage_stats: '存储统计',
  get_activity_stats: '活跃统计',
  create_text_file: '创建文件',
  create_code_file: '创建代码文件',
  edit_file_content: '编辑文件',
  append_to_file: '追加内容',
  find_and_replace: '查找替换',
  rename_file: '重命名',
  move_file: '移动文件',
  delete_file: '删除文件',
  create_folder: '创建文件夹',
  batch_rename: '批量重命名',
  batch_move: '批量移动',
  batch_delete: '批量删除',
  add_tag: '添加标签',
  remove_tag: '移除标签',
  auto_tag_files: '自动打标签',
  create_share_link: '创建分享',
  revoke_share: '撤销分享',
  create_direct_link: '创建直链',
  get_file_permissions: '查看权限',
  grant_permission: '授权访问',
  revoke_permission: '撤销权限',
  list_expired_permissions: '过期权限',
  get_file_versions: '文件版本',
  restore_version: '恢复版本',
};

export function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName.replace(/_/g, ' ');
}

export function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
  const label = getToolLabel(toolName);
  const target =
    (args.fileName as string) ||
    (args.name as string) ||
    (args.query as string) ||
    (args.fileId as string) ||
    (args.folderName as string) ||
    '';

  return target ? `${label}：${target}` : label;
}
