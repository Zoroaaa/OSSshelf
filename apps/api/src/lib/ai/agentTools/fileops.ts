/**
 * fileops.ts — 文件操作工具
 *
 * 功能:
 * - 创建文本/代码文件
 * - 编辑/追加/查找替换
 * - 重命名/移动/复制/删除/恢复
 * - 文件夹管理
 * - 收藏管理
 *
 * 智能特性：
 * - 支持多存储后端（R2/S3/Telegram）
 * - 自动备份编辑历史
 * - 批量操作支持
 */

import { eq, and, isNull, inArray } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition, PendingConfirmResult } from './types';
import { formatBytes } from '../utils';
import {
  createTextFile,
  updateFileContent as serviceUpdateContent,
  moveFile,
  renameFile,
  softDeleteFile,
  toggleStar,
  createFolder,
  copyFile as serviceCopyFile,
  restoreFile as serviceRestoreFile,
  findOrCreateFolder as serviceFindOrCreateFolder,
} from '../../../lib/fileService';
import { readFileContent } from '../../../lib/fileContentHelper';
import { enqueueAgentBatchOperation } from '../aiTaskQueue';

// ─────────────────────────────────────────────────────────────────────────────
// 批量操作阈值：超过此数量的文件操作将自动入队处理
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_THRESHOLD = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 允许创建的文本文件类型
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.php',
  '.rb',
  '.swift',
  '.kt',
  '.sql',
  '.sh',
  '.bash',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc',
];

const ALLOWED_CODE_EXTENSIONS = [
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.php',
  '.rb',
  '.swift',
  '.kt',
  '.cs',
  '.scala',
  '.r',
  '.lua',
  '.perl',
  '.vue',
  '.svelte',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
];

const MIME_TYPE_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.sql': 'application/sql',
  '.sh': 'application/x-sh',
  '.yaml': 'application/x-yaml',
  '.env': 'text/plain',
};

export const definitions: ToolDefinition[] = [
  // ════════════════════════════════════════════════════════════════
  // A. 创建文件
  // ════════════════════════════════════════════════════════════════

  {
    type: 'function',
    function: {
      name: 'create_text_file',
      description: `【新建文件】创建文本或代码文件。
适用场景：
• "帮我创建一个笔记"
• "新建一个README.md"
• "保存这段代码到文件"

💡 支持格式：.txt .md .csv .json .xml .yaml .html .css .js .ts .py 等`,
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '文件内容' },
          fileName: { type: 'string', description: '文件名（含扩展名，如 "notes.md"）' },
          folderPath: { type: 'string', description: '目标文件夹路径（如 "备忘录"），不传则根目录' },
          encoding: { type: 'string', enum: ['utf-8', 'gbk'], description: '编码，默认 utf-8' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['content', 'fileName'],
      },
      examples: [
        { user_query: '帮我创建一个笔记', tool_call: { content: '今日工作内容：...', fileName: 'notes.md' } },
        {
          user_query: '新建README文件',
          tool_call: { content: '# 项目名称\n\n## 简介', fileName: 'README.md', folderPath: '项目文档' },
        },
        { user_query: '保存这段文本', tool_call: { content: '用户提供的文本内容', fileName: 'document.txt' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'create_code_file',
      description: `【创建代码文件】创建源代码文件。
适用场景：
- "把这段代码存到..." → 保存代码片段
- "创建一个utils文件" → 创建工具函数文件

支持的格式: .js, .ts, .py, .java, .go, .rs, .c, .cpp, .php, .rb, .swift, .kt, .sql 等`,
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '代码内容' },
          fileName: { type: 'string', description: '文件名（含扩展名，如 "helper.ts"）' },
          targetFolder: { type: 'string', description: '目标文件夹路径' },
          language: { type: 'string', description: '编程语言（用于日志记录，可选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['code', 'fileName'],
      },
      examples: [
        {
          user_query: '把这段Python代码保存',
          tool_call: { code: 'def hello():\n    print("Hello")', fileName: 'hello.py', language: 'python' },
        },
        {
          user_query: '创建TypeScript工具文件',
          tool_call: { code: 'export function helper() {}', fileName: 'utils.ts', targetFolder: 'src/utils' },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'create_file_from_template',
      description: `【从模板创建文件】使用预定义模板快速创建文件。
支持的模板：
- README.md — 项目说明文档
- .gitignore — Git忽略规则
- package.json — Node.js项目配置
- docker-compose.yml — Docker编排
- config.json — 通用配置文件模板`,
      parameters: {
        type: 'object',
        properties: {
          templateName: {
            type: 'string',
            enum: ['readme', 'gitignore', 'package-json', 'docker-compose', 'config-json'],
            description: '模板名称',
          },
          variables: {
            type: 'object',
            description: '模板变量（如 projectName, author, version 等）',
          },
          targetFolder: { type: 'string', description: '目标文件夹路径' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['templateName'],
      },
      examples: [
        {
          user_query: '创建README模板',
          tool_call: { templateName: 'readme', variables: { projectName: 'MyApp', author: 'User' } },
        },
        { user_query: '新建gitignore文件', tool_call: { templateName: 'gitignore', targetFolder: '项目代码' } },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // B. 编辑文件（3个新工具）🔥
  // ════════════════════════════════════════════════════════════════

  {
    type: 'function',
    function: {
      name: 'edit_file_content',
      description: `【编辑文件内容】读取、修改、保存文件。
适用场景：
- "改一下配置文件的..."
- "把这个文件的XXX改成YYY"
- "在文件末尾追加..."

工作流程：
1. 读取当前内容展示给用户
2. 用户确认修改点
3. 执行修改并保存
4. 返回修改结果`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件ID' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                operation: { type: 'string', enum: ['replace', 'insert', 'delete', 'append'] },
                oldValue: { type: 'string', description: '要替换的原文（replace操作）' },
                newValue: { type: 'string', description: '新值' },
                position: { type: 'number', description: '插入位置（字符偏移量）' },
              },
            },
            description: '编辑操作列表',
          },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        {
          user_query: '把配置文件中的端口改成8080',
          tool_call: {
            fileId: '<config_id>',
            edits: [{ operation: 'replace', oldValue: 'port: 3000', newValue: 'port: 8080' }],
          },
        },
        {
          user_query: '在文件末尾追加一行',
          tool_call: { fileId: '<file_id>', edits: [{ operation: 'append', newValue: '// 新增内容' }] },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'append_to_file',
      description: `【追加内容】在文件末尾追加文本内容。
适用场景："在这份日志后面加一条记录"、"追加一行配置"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件ID' },
          content: { type: 'string', description: '要追加的内容' },
          addNewline: { type: 'boolean', description: '是否在前面添加换行，默认 true' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'content'],
      },
      examples: [
        { user_query: '在日志后面加一条记录', tool_call: { fileId: '<log_id>', content: '\n[2026-04-16] 新操作记录' } },
        { user_query: '追加一行配置', tool_call: { fileId: '<config_id>', content: '# 新增配置项', addNewline: true } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'find_and_replace',
      description: `【查找替换】在文件中查找并替换文本。
支持普通字符串替换和正则表达式。
适用场景："把所有 'localhost' 替换成 'production.com'"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件ID' },
          find: { type: 'string', description: '要查找的文本或正则表达式' },
          replace: { type: 'string', description: '替换为的文本' },
          useRegex: { type: 'boolean', description: '是否使用正则表达式，默认 false' },
          replaceAll: { type: 'boolean', description: '是否替换所有匹配项，默认 true' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'find', 'replace'],
      },
      examples: [
        {
          user_query: '把localhost换成生产域名',
          tool_call: {
            fileId: '<config_id>',
            find: 'localhost',
            replace: 'production.com',
            replaceAll: true,
            _confirmed: true,
          },
        },
        {
          user_query: '只替换第一个匹配',
          tool_call: {
            fileId: '<file_id>',
            find: 'old_value',
            replace: 'new_value',
            replaceAll: false,
            _confirmed: true,
          },
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // C. 基础操作（保留+新增）
  // ════════════════════════════════════════════════════════════════

  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: `【重命名】重命名文件或文件夹。
⚠️ 仅改名称，不改变位置。若需移动请用 move_file。`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件/文件夹 ID' },
          newName: { type: 'string', description: '新名称（含扩展名）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'newName'],
      },
      examples: [
        {
          user_query: '把这个文件重命名为报告2024',
          tool_call: { fileId: '<file_id>', newName: '报告2024.pdf', _confirmed: true },
        },
        { user_query: '修改文件夹名称', tool_call: { fileId: '<folder_id>', newName: '新项目文档', _confirmed: true } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'move_file',
      description: `【移动文件/文件夹】将文件移动到另一个文件夹。
适用场景："把文件移到XX文件夹"、"整理文件到对应目录"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件/文件夹 ID' },
          targetFolderId: { type: 'string', description: '目标文件夹 ID' },
          targetFolderPath: { type: 'string', description: '目标文件夹路径（备选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'targetFolderId'],
      },
      examples: [
        {
          user_query: '把这个文件移到设计文件夹',
          tool_call: { fileId: '<file_id>', targetFolderId: '<design_folder_id>' },
        },
        { user_query: '整理所有PDF到文档目录', tool_call: { fileId: '<pdf_id>', targetFolderId: '<docs_folder_id>' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: `【复制文件】复制文件到指定位置。
适用场景："复制一份备份"、"拷贝到其他文件夹"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '源文件 ID' },
          targetFolderId: { type: 'string', description: '目标文件夹 ID' },
          newName: { type: 'string', description: '新文件名（可选，不传则使用原名）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId', 'targetFolderId'],
      },
      examples: [
        { user_query: '复制一份备份', tool_call: { fileId: '<file_id>', targetFolderId: '<backup_folder_id>' } },
        {
          user_query: '拷贝到文档文件夹并改名',
          tool_call: { fileId: '<file_id>', targetFolderId: '<docs_id>', newName: '副本_原文件名' },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: `【软删除】将文件移入回收站（非永久删除）。
删除后可通过 restore_file 恢复。
⚠️ 此操作不可逆，请务必确认！`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件/文件夹 ID' },
          reason: { type: 'string', description: '删除原因（可选，用于审计）' },
          _confirmed: { type: 'boolean', description: '用户确认（必须为true）' },
        },
        required: ['fileId', '_confirmed'],
      },
      examples: [
        { user_query: '删除这个文件', tool_call: { fileId: '<file_id>', _confirmed: true } },
        { user_query: '清理临时文件', tool_call: { fileId: '<temp_id>', reason: '不再需要', _confirmed: true } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'restore_file',
      description: `【从回收站恢复】恢复已软删除的文件。
适用场景："撤销刚才的删除"、"从回收站恢复XX文件"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '已删除文件的 ID' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '撤销刚才的删除', tool_call: { fileId: '<deleted_id>', _confirmed: true } },
        { user_query: '从回收站恢复文件', tool_call: { fileId: '<trash_id>' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: `【创建文件夹】在指定位置创建新文件夹。
适用场景："新建一个XX文件夹"、"创建目录结构"`,
      parameters: {
        type: 'object',
        properties: {
          folderName: { type: 'string', description: '文件夹名称' },
          parentId: { type: 'string', description: '父文件夹ID（不传则根目录）' },
          parentPath: { type: 'string', description: '父文件夹路径（备选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['folderName'],
      },
      examples: [
        { user_query: '新建项目文档文件夹', tool_call: { folderName: '项目文档', _confirmed: true } },
        {
          user_query: '在工作目录下创建子文件夹',
          tool_call: { folderName: '2024Q4报告', parentId: '<work_id>', _confirmed: true },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'batch_rename',
      description: `【批量重命名】按模板或正则批量重命名文件。
适用场景：
- 批量添加前缀/后缀
- 统一命名规范
- 替换文件名中的特定文本

示例模板：
- "{序号}_{原文件名}" → 01_文件.txt, 02_文件2.txt
- "{日期}_{原文件名}" → 2026-04-06_文件.txt
- 正则: /^IMG_(\\d+)/ → photo_$1`,
      parameters: {
        type: 'object',
        properties: {
          fileIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要重命名的文件ID列表',
          },
          template: { type: 'string', description: '重命名模板（支持变量和正则）' },
          previewOnly: { type: 'boolean', description: '仅预览不执行，默认 true（安全起见建议先预览）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileIds', 'template'],
      },
      examples: [
        {
          user_query: '批量添加序号前缀',
          tool_call: { fileIds: ['<id1>', '<id2>', '<id3>'], template: '{序号}_{原文件名}', previewOnly: true },
        },
        {
          user_query: '统一加日期前缀',
          tool_call: { fileIds: ['<id1>', '<id2>'], template: '2026-04-16_{原文件名}', _confirmed: true },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'batch_move',
      description: `【批量移动文件】将多个文件移动到目标文件夹。
当文件数量超过阈值时自动入队异步处理，避免超时。
适用场景："把所有PDF移到文档目录"、"按类型整理文件到对应文件夹"`,
      parameters: {
        type: 'object',
        properties: {
          fileIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要移动的文件ID列表',
          },
          targetFolderId: { type: 'string', description: '目标文件夹 ID' },
          targetFolderPath: { type: 'string', description: '目标文件夹路径（备选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileIds', 'targetFolderId'],
      },
      examples: [
        {
          user_query: '把所有PDF移到文档目录',
          tool_call: { fileIds: ['<id1>', '<id2>'], targetFolderId: '<docs_folder_id>' },
        },
        {
          user_query: '整理图片到素材文件夹',
          tool_call: { fileIds: ['<img_id1>', '<img_id2>'], targetFolderId: '<assets_id>' },
        },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'batch_delete',
      description: `【批量删除文件】将多个文件移入回收站（非永久删除）。
当文件数量超过阈值时自动入队异步处理。删除后可通过 restore_file 恢复。
⚠️ 此操作不可逆，请务必确认！`,
      parameters: {
        type: 'object',
        properties: {
          fileIds: {
            type: 'array',
            items: { type: 'string' },
            description: '要删除的文件ID列表',
          },
          reason: { type: 'string', description: '删除原因（可选，用于审计）' },
          _confirmed: { type: 'boolean', description: '用户确认（必须为true）' },
        },
        required: ['fileIds', '_confirmed'],
      },
      examples: [
        {
          user_query: '批量删除临时文件',
          tool_call: { fileIds: ['<id1>', '<id2>'], reason: '清理临时文件', _confirmed: true },
        },
        { user_query: '清空缓存文件夹', tool_call: { fileIds: ['<cache_id1>'], _confirmed: true } },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // D. 收藏管理（2个新工具）⭐
  // ════════════════════════════════════════════════════════════════

  {
    type: 'function',
    function: {
      name: 'star_file',
      description: `【收藏文件/文件夹】添加到收藏夹。
适用场景：
- "收藏这个文件"
- "把这个项目加到收藏"
- "标记为重要"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件或文件夹ID' },
          reason: { type: 'string', description: '收藏原因（可选）' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '收藏这个文件', tool_call: { fileId: '<file_id>' } },
        { user_query: '标记为重要并收藏', tool_call: { fileId: '<project_id>', reason: '重要项目文档' } },
      ],
    },
  },

  {
    type: 'function',
    function: {
      name: 'unstar_file',
      description: `【取消收藏】将文件从收藏夹中移除。
适用场景："取消收藏那个文件"、"不再关注这个"`,
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件或文件夹ID' },
          _confirmed: { type: 'boolean', description: '用户确认' },
        },
        required: ['fileId'],
      },
      examples: [
        { user_query: '取消收藏', tool_call: { fileId: '<file_id>' } },
        { user_query: '不再关注这个文件', tool_call: { fileId: '<old_id>' } },
      ],
    },
  },

  // ── Phase 7: 草稿创建工具 ──────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'draft_and_create_file',
      description: `【草稿创建】先生成文件草稿供用户确认后再正式创建。
适用场景："帮我写一个README"、"生成Python脚本"、"创建配置文件"、"帮我写一个项目文档"`,
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: '目标文件名（含扩展名）' },
          targetFolderId: { type: 'string', description: '目标文件夹ID（不传则根目录）' },
          userRequest: { type: 'string', description: '用户原始需求（用于确认展示）' },
          draftContent: { type: 'string', description: 'Agent生成的草稿内容' },
          _confirmed: { type: 'boolean', description: '用户确认标志' },
        },
        required: ['fileName', 'draftContent'],
      },
      examples: [
        {
          user_query: '帮我写一个README',
          tool_call: {
            fileName: 'README.md',
            userRequest: '帮我写一个README',
            draftContent: '# 项目名称\n\n## 简介\n...',
          },
        },
        {
          user_query: '生成一个Python爬虫脚本',
          tool_call: {
            fileName: 'spider.py',
            userRequest: '生成一个Python爬虫脚本',
            draftContent: 'import requests\n...',
          },
        },
        {
          user_query: '创建配置文件放到代码文件夹',
          tool_call: {
            fileName: 'config.json',
            targetFolderId: '<folder_id>',
            userRequest: '创建配置文件',
            draftContent: '{ "app": {...} }',
          },
        },
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 执行器类
// ─────────────────────────────────────────────────────────────────────────────

export class FileOpsTools {
  static async executeCreateTextFile(env: Env, userId: string, args: Record<string, unknown>) {
    const content = args.content as string;
    const fileName = args.fileName as string;
    const folderPath = args.folderPath as string | undefined;

    if (!content || !fileName) {
      return { error: '缺少必要参数: content 和 fileName' };
    }

    const ext = getFileExtension(fileName);
    if (!ext || !ALLOWED_TEXT_EXTENSIONS.includes(ext)) {
      return {
        error: `不支持的文件类型: ${ext || '(无扩展名)'}，允许的类型: ${ALLOWED_TEXT_EXTENSIONS.join(', ')}`,
      };
    }

    let folderId: string | null = null;
    if (folderPath) {
      folderId = await FileOpsTools.findOrCreateFolder(env, userId, folderPath);
      if (!folderId) {
        return { error: `无法找到或创建文件夹: ${folderPath}` };
      }
    }

    // 调用公共 service 层（复用 files.ts POST /create 的核心逻辑）
    const result = await createTextFile(env, userId, {
      name: fileName,
      content,
      parentId: folderId,
      mimeType: MIME_TYPE_MAP[ext] || 'text/plain',
    });

    if (!result.success) {
      return { error: result.error };
    }

    return {
      success: true,
      message: `文件 "${fileName}" 已创建${folderPath ? ` 到 ${folderPath}` : ''}`,
      fileId: result.fileId,
      fileName,
      path: result.file.path as string,
      size: formatBytes(result.file.size as number),
      mimeType: result.file.mimeType as string,
      _next_actions: [
        '✅ 文件创建成功',
        '如需编辑内容，可调用 edit_file_content',
        '如需添加标签，可调用 add_tag',
        '如需分享，可调用 create_share 或 create_direct_link',
      ],
    };
  }

  static async executeCreateCodeFile(env: Env, userId: string, args: Record<string, unknown>) {
    const code = args.code as string;
    const fileName = args.fileName as string;
    const targetFolder = args.targetFolder as string | undefined;

    if (!code || !fileName) {
      return { error: '缺少必要参数: code 和 fileName' };
    }

    const ext = getFileExtension(fileName);
    if (!ext || !ALLOWED_CODE_EXTENSIONS.includes(ext)) {
      return {
        error: `不支持的代码文件类型: ${ext || '(无扩展名)'}，允许的类型: ${ALLOWED_CODE_EXTENSIONS.join(', ')}`,
      };
    }

    return FileOpsTools.executeCreateTextFile(env, userId, {
      ...args,
      content: code,
      folderPath: targetFolder,
    });
  }

  static async executeCreateFileFromTemplate(env: Env, userId: string, args: Record<string, unknown>) {
    const templateName = args.templateName as string;
    const variables = args.variables as Record<string, string> | undefined;
    const targetFolder = args.targetFolder as string | undefined;

    const templates: Record<string, { defaultName: string; generator: (vars?: Record<string, string>) => string }> = {
      readme: {
        defaultName: 'README.md',
        generator: (vars) => `# ${vars?.projectName || 'My Project'}

## 简介
${vars?.description || '项目简介'}

## 安装
\`\`\`bash
# 安装依赖
npm install
\`\`\`

## 使用
\`\`\`bash
# 启动开发服务器
npm run dev
\`\`\`

## 作者
${vars?.author || 'Unknown'} · ${new Date().getFullYear()}
`,
      },
      gitignore: {
        defaultName: '.gitignore',
        generator: () => `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
.vscode/
.idea/
`,
      },
      'package-json': {
        defaultName: 'package.json',
        generator: (vars) =>
          JSON.stringify(
            {
              name: vars?.projectName || 'my-project',
              version: vars?.version || '1.0.0',
              description: vars?.description || '',
              main: 'index.js',
              scripts: {
                start: 'node index.js',
                dev: 'nodemon index.js',
              },
              dependencies: {},
              devDependencies: {},
            },
            null,
            2
          ),
      },
      'docker-compose': {
        defaultName: 'docker-compose.yml',
        generator: () => `version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
`,
      },
      'config-json': {
        defaultName: 'config.json',
        generator: (vars) =>
          JSON.stringify(
            {
              app: {
                name: vars?.appName || 'My App',
                version: '1.0.0',
              },
              server: {
                host: '0.0.0.0',
                port: 3000,
              },
              database: {
                host: 'localhost',
                port: 5432,
                name: vars?.dbName || 'mydb',
              },
            },
            null,
            2
          ),
      },
    };

    const template = templates[templateName];
    if (!template) {
      return { error: `未知模板: ${templateName}，可用模板: ${Object.keys(templates).join(', ')}` };
    }

    const content = template.generator(variables);

    return FileOpsTools.executeCreateTextFile(env, userId, {
      content,
      fileName: template.defaultName,
      folderPath: targetFolder,
    });
  }

  static async executeEditFileContent(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const edits = args.edits as Array<{ operation: string; oldValue?: string; newValue?: string; position?: number }>;

    logger.info('FileOpsTool', '开始编辑文件', { fileId });

    // 使用公共的文件读取模块（复用 preview.ts /raw 路由逻辑）
    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      return { error: '文件不存在或无权访问' };
    }

    const readResult = await readFileContent(env, file, userId);

    if (!readResult.success || !readResult.content) {
      return {
        error: '无法读取文件内容进行编辑',
        details: { fileId, fileName: file.name, error: readResult.error },
      };
    }

    let newContent = readResult.content;
    const appliedEdits: Array<{ operation: string; success: boolean }> = [];

    for (const edit of edits || []) {
      try {
        switch (edit.operation) {
          case 'replace':
            if (edit.oldValue && edit.newValue !== undefined) {
              newContent = newContent.includes(edit.oldValue)
                ? newContent.replace(edit.oldValue, edit.newValue)
                : newContent;
              appliedEdits.push({ operation: 'replace', success: true });
            }
            break;
          case 'append':
            if (edit.newValue) {
              newContent += '\n' + edit.newValue;
              appliedEdits.push({ operation: 'append', success: true });
            }
            break;
          case 'insert':
            if (edit.newValue !== undefined && edit.position !== undefined) {
              newContent = newContent.slice(0, edit.position) + edit.newValue + newContent.slice(edit.position);
              appliedEdits.push({ operation: 'insert', success: true });
            }
            break;
          case 'delete':
            if (edit.oldValue) newContent = newContent.replace(edit.oldValue, '');
            appliedEdits.push({ operation: 'delete', success: true });
            break;
        }
      } catch {
        appliedEdits.push({ operation: edit.operation, success: false });
      }
    }

    // 调用公共 service 层保存（复用 files.ts PUT /:id/content 的核心逻辑：版本快照、权限检查、webhook等）
    const saveResult = await serviceUpdateContent(env, userId, fileId, newContent);

    if (!saveResult.success) {
      return { error: saveResult.error };
    }

    logger.info('FileOpsTool', '文件编辑完成', { fileId });

    return {
      success: true,
      message: `文件 "${file.name}" 已编辑`,
      fileId,
      fileName: file.name,
      changesApplied: appliedEdits.filter((e) => e.success).length,
      totalEdits: appliedEdits.length,
      newSize: formatBytes(new TextEncoder().encode(newContent).length),
      _next_actions: ['✅ 编辑完成', '如需继续修改，可再次调用 edit_file_content'],
    };
  }

  static async executeAppendToFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const content = args.content as string;
    const addNewline = args.addNewline !== false;

    return FileOpsTools.executeEditFileContent(env, userId, {
      fileId,
      edits: [
        {
          operation: 'append',
          newValue: (addNewline ? '\n' : '') + content,
        },
      ],
    });
  }

  static async executeFindAndReplace(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const findStr = args.find as string;
    const replaceStr = args.replace as string;
    const useRegex = args.useRegex === true;
    const replaceAll = args.replaceAll !== false;

    const db = getDb(env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      return { error: '文件不存在或无权访问' };
    }

    const readResult = await readFileContent(env, file, userId);

    if (!readResult.success || !readResult.content) {
      return {
        error: '无法读取文件内容',
        details: { fileId, fileName: file.name, error: readResult.error },
      };
    }

    const currentContent = readResult.content;

    let matchCount = 0;
    let newContent: string;

    if (useRegex) {
      const regex = new RegExp(findStr, replaceAll ? 'g' : '');
      const matches = currentContent.match(regex);
      matchCount = matches ? matches.length : 0;
      newContent = currentContent.replace(regex, replaceStr);
    } else {
      if (replaceAll) {
        const parts = currentContent.split(findStr);
        matchCount = parts.length - 1;
        newContent = parts.join(replaceStr);
      } else {
        matchCount = currentContent.includes(findStr) ? 1 : 0;
        newContent = currentContent.replace(findStr, replaceStr);
      }
    }

    if (matchCount === 0) {
      return {
        fileId,
        fileName: file.name,
        matchCount: 0,
        message: `未找到 "${findStr}"`,
      };
    }

    const saveResult = await serviceUpdateContent(env, userId, fileId, newContent);
    if (!saveResult.success) {
      return { error: saveResult.error };
    }

    return {
      success: true,
      message: `已完成查找替换`,
      fileId,
      fileName: file.name,
      find: findStr,
      replace: replaceStr,
      matchCount,
      newSize: formatBytes(new TextEncoder().encode(newContent).length),
    };
  }

  static async executeRenameFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const newName = args.newName as string;

    // 调用公共 service 层（复用 files.ts PUT /:id 的核心逻辑）
    const result = await renameFile(env, userId, fileId, { name: newName });
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, fileId, newName };
  }

  static async executeMoveFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetFolderId = args.targetFolderId as string;

    // 调用公共 service 层（复用 files.ts POST /:id/move 的核心逻辑：循环检测、同名冲突、子路径更新）
    const result = await moveFile(env, userId, fileId, { targetParentId: targetFolderId });
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, fileId };
  }

  static async executeCopyFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const targetFolderId = args.targetFolderId as string;
    const newName = args.newName as string | undefined;

    const result = await serviceCopyFile(env, userId, fileId, { targetFolderId, newName });
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      originalFileId: fileId,
      newFileId: result.newFileId,
      newName: result.fileName,
    };
  }

  static async executeDeleteFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;

    // 调用公共 service 层（复用 files.ts DELETE /:id 的核心逻辑：文件夹递归删除、通知、webhook）
    const result = await softDeleteFile(env, userId, fileId);
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, fileId };
  }

  static async executeToggleStar(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const starred = (args.starred as boolean) ?? true;

    // 调用公共 service 层（复用 files.ts POST/DELETE /:id/star 的核心逻辑）
    const result = await toggleStar(env, userId, fileId, starred);
    if (!result.success) return { error: result.error };

    return { success: true, message: result.message, fileId, isStarred: starred };
  }

  static async executeRestoreFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;

    const result = await serviceRestoreFile(env, userId, fileId);
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      fileId,
      fileName: result.fileName,
      restoredAt: new Date().toISOString(),
    };
  }

  static async executeCreateFolder(env: Env, userId: string, args: Record<string, unknown>) {
    const folderName = args.folderName as string;
    const parentId = args.parentId as string | undefined;

    // 调用公共 service 层（复用 files.ts POST / 的核心逻辑：同名检查、权限继承、存储桶解析）
    const result = await createFolder(env, userId, folderName, parentId);
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: `文件夹 "${folderName}" 已创建`,
      folderId: result.folderId,
      folderName,
      _next_actions: ['✅ 文件夹创建成功', '如需上传文件到此文件夹，可使用 create_text_file 并指定 parentId'],
    };
  }

  static async executeBatchRename(env: Env, userId: string, args: Record<string, unknown>) {
    const fileIds = args.fileIds as string[];
    const template = args.template as string;
    const previewOnly = args.previewOnly !== false;
    const db = getDb(env.DB);

    if (fileIds.length > BATCH_THRESHOLD && !previewOnly) {
      try {
        const batchResult = await enqueueAgentBatchOperation(env, 'rename', fileIds, userId, { template });
        return {
          status: 'queued',
          taskId: batchResult.taskId,
          message: `任务已提交到队列（共 ${batchResult.total} 个文件），预计 ${batchResult.estimatedMinutes} 分钟完成`,
          totalFiles: batchResult.total,
          estimatedMinutes: batchResult.estimatedMinutes,
          _next_actions: [
            `✅ 批量重命名任务已入队（taskId: ${batchResult.taskId}）`,
            '可通过 GET /api/ai/index/task 查看进度',
            '完成后结果会通过 SSE 推送',
          ],
        };
      } catch (queueError) {
        logger.warn(
          'AgentTool',
          'Batch queue failed, falling back to sync execution',
          { fileCount: fileIds.length },
          queueError
        );
      }
    }

    const rows = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), isNull(files.deletedAt), inArray(files.id, fileIds)))
      .all();

    if (rows.length === 0) {
      return { error: '未找到任何匹配的文件' };
    }

    const previews = rows.map((row, idx) => {
      const newName = template
        .replace('{序号}', String(idx + 1).padStart(2, '0'))
        .replace('{index}', String(idx))
        .replace('{原文件名}', row.name)
        .replace('{date}', new Date().toISOString().split('T')[0])
        .replace('{时间}', new Date().toTimeString().split(' ')[0]);

      return {
        fileId: row.id,
        oldName: row.name,
        newName,
      };
    });

    if (previewOnly) {
      return {
        mode: 'preview',
        message: '以下是预览结果（未实际执行），确认后设置 _confirmed=true 再次调用',
        totalFiles: previews.length,
        previews,
      };
    }

    const results = [];
    for (const preview of previews) {
      try {
        const row = rows.find((r) => r.id === preview.fileId)!;
        const parentPath = row.parentId
          ? (await db.select({ path: files.path }).from(files).where(eq(files.id, row.parentId)).get())?.path
          : undefined;
        const newPath = parentPath ? parentPath + '/' + preview.newName : preview.newName;

        await db
          .update(files)
          .set({ name: preview.newName, path: newPath, updatedAt: new Date().toISOString() })
          .where(eq(files.id, preview.fileId));

        results.push({ fileId: preview.fileId, success: true, oldName: preview.oldName, newName: preview.newName });
      } catch (error) {
        results.push({ fileId: preview.fileId, success: false, error: (error as Error).message });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      mode: 'executed',
      message: `批量重命名完成：${successCount}/${results.length} 成功`,
      totalFiles: results.length,
      successCount,
      results,
    };
  }

  static async executeBatchMove(env: Env, userId: string, args: Record<string, unknown>) {
    const fileIds = args.fileIds as string[];
    const targetFolderId = args.targetFolderId as string;

    if (!Array.isArray(fileIds) || fileIds.length === 0 || !targetFolderId) {
      return { error: '缺少必要参数: fileIds (数组) 和 targetFolderId' };
    }

    if (fileIds.length > BATCH_THRESHOLD) {
      try {
        const batchResult = await enqueueAgentBatchOperation(env, 'move', fileIds, userId, { targetFolderId });
        return {
          status: 'queued',
          taskId: batchResult.taskId,
          message: `批量移动任务已提交到队列（共 ${batchResult.total} 个文件），预计 ${batchResult.estimatedMinutes} 分钟完成`,
          totalFiles: batchResult.total,
          estimatedMinutes: batchResult.estimatedMinutes,
          _next_actions: [
            `✅ 批量移动任务已入队（taskId: ${batchResult.taskId}）`,
            '可通过 GET /api/ai/index/task 查看进度',
          ],
        };
      } catch (queueError) {
        logger.warn(
          'AgentTool',
          'Batch move queue failed, falling back to sync',
          { fileCount: fileIds.length },
          queueError
        );
      }
    }

    let successCount = 0;
    let failCount = 0;

    for (const fileId of fileIds) {
      try {
        const result = await moveFile(env, userId, fileId, { targetParentId: targetFolderId });
        if (result.success) successCount++;
        else failCount++;
      } catch (error) {
        logger.warn('AgentTool', 'Batch move single file failed', { fileId }, error);
        failCount++;
      }
    }

    return {
      status: 'completed',
      message: `批量移动完成：${successCount} 成功，${failCount} 失败`,
      totalFiles: fileIds.length,
      successCount,
      failCount,
      _next_actions: [`✅ 已将 ${successCount} 个文件移到目标文件夹`],
    };
  }

  static async executeBatchDelete(env: Env, userId: string, args: Record<string, unknown>) {
    const fileIds = args.fileIds as string[];
    const reason = args.reason as string | undefined;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return { error: '缺少必要参数: fileIds (非空数组)' };
    }

    if (fileIds.length > BATCH_THRESHOLD) {
      try {
        const batchResult = await enqueueAgentBatchOperation(env, 'delete', fileIds, userId, { reason });
        return {
          status: 'queued',
          taskId: batchResult.taskId,
          message: `批量删除任务已提交到队列（共 ${batchResult.total} 个文件），预计 ${batchResult.estimatedMinutes} 分钟完成。文件将被移入回收站，可通过 restore_file 恢复`,
          totalFiles: batchResult.total,
          estimatedMinutes: batchResult.estimatedMinutes,
          _next_actions: [`✅ 批量删除任务已入队（taskId: ${batchResult.taskId}）`, '删除的文件可在回收站中恢复'],
        };
      } catch (queueError) {
        logger.warn(
          'AgentTool',
          'Batch delete queue failed, falling back to sync',
          { fileCount: fileIds.length },
          queueError
        );
      }
    }

    let successCount = 0;
    let failCount = 0;

    for (const fileId of fileIds) {
      try {
        const result = await softDeleteFile(env, userId, fileId);
        if (result.success) successCount++;
        else failCount++;
      } catch (error) {
        logger.warn('AgentTool', 'Batch delete single file failed', { fileId }, error);
        failCount++;
      }
    }

    return {
      status: 'completed',
      message: `批量删除完成：${successCount} 成功移入回收站，${failCount} 失败`,
      totalFiles: fileIds.length,
      successCount,
      failCount,
      _next_actions: ['✅ 文件已移入回收站，可调用 restore_file 恢复'],
    };
  }

  static async executeStarFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const reason = args.reason as string | undefined;

    const result = await toggleStar(env, userId, fileId, true);
    if (!result.success) return { error: result.error };

    logger.info('AgentTool', 'Starred file', { fileId, reason: reason || '(none)' });

    return {
      success: true,
      message: result.message + (reason ? ` (${reason})` : ''),
      fileId,
      _next_actions: ['✅ 收藏成功', '可通过 filter_files(isStarred=true) 查看所有收藏的文件'],
    };
  }

  static async executeUnstarFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;

    const result = await toggleStar(env, userId, fileId, false);
    if (!result.success) return { error: result.error };

    return {
      success: true,
      message: result.message,
      fileId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 辅助方法
  // ─────────────────────────────────────────────────────────────────────────

  private static async findOrCreateFolder(env: Env, userId: string, path: string): Promise<string | null> {
    return serviceFindOrCreateFolder(env, userId, path);
  }

  // ── Phase 7: 草稿创建执行方法 ─────────────────────────────
  static async executeDraftAndCreateFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileName = args.fileName as string;
    const targetFolderId = args.targetFolderId as string | undefined;
    const userRequest = args.userRequest as string | undefined;
    const draftContent = args.draftContent as string;
    const _confirmed = args._confirmed as boolean;

    if (!fileName || !draftContent) {
      return { error: '缺少必要参数: fileName 和 draftContent' };
    }

    // 未确认时返回草稿供预览
    if (!_confirmed) {
      return {
        success: false,
        pendingConfirm: true,
        confirmId: `draft-${Date.now()}`,
        message: `是否创建文件 "${fileName}"？`,
        previewType: 'draft',
        draftContent,
        fileName,
        userRequest,
        _next_actions: ['用户确认后将正式创建文件', '用户可查看并编辑草稿内容'],
      } as unknown as PendingConfirmResult;
    }

    // 确认后创建文件
    const ext = getFileExtension(fileName);
    const folderId: string | null = targetFolderId || null;

    const result = await createTextFile(env, userId, {
      name: fileName,
      content: draftContent,
      parentId: folderId,
      mimeType: MIME_TYPE_MAP[ext] || 'text/plain',
    });

    if (!result.success) {
      return { error: result.error };
    }

    logger.info('AgentTool', 'Draft file created', { fileId: result.fileId, fileName });

    return {
      success: true,
      message: `文件 "${fileName}" 已创建`,
      fileId: result.fileId,
      fileName,
      path: (result.file?.path as string) || '',
      size: formatBytes((result.file?.size as number) || 0),
      mimeType: (result.file?.mimeType as string) || 'text/plain',
      _next_actions: [
        '✅ 文件已创建',
        '如需编辑，可调用 edit_file_content',
        '如需分享，可调用 create_share 或 create_direct_link',
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) return '';
  return fileName.substring(lastDotIndex).toLowerCase();
}
