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

import { eq, and, isNull, isNotNull, inArray } from 'drizzle-orm';
import { getDb, files } from '../../../db';
import type { Env } from '../../../types/env';
import { logger } from '@osshelf/shared';
import type { ToolDefinition, AgentFile, PendingConfirmResult } from './types';
import { WRITE_TOOLS } from './types';
import { formatBytes, getMimeTypeCategory } from '../utils';
import {
  createTextFile,
  updateFileContent as serviceUpdateContent,
  moveFile,
  renameFile,
  softDeleteFile,
  toggleStar,
  createFolder,
} from '../../../lib/fileService';
import { readFileContent } from '../../../lib/fileContentHelper';

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
    const db = getDb(env.DB);

    const [file, targetFolder] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
        .get(),
      db
        .select()
        .from(files)
        .where(and(eq(files.id, targetFolderId), eq(files.userId, userId)))
        .get(),
    ]);

    if (!file) return { error: '源文件不存在或无权访问' };
    if (!targetFolder) return { error: '目标文件夹不存在' };
    if (file.isFolder) return { error: '暂不支持复制文件夹' };

    const finalName = newName || file.name;
    const newFileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const parentPath = targetFolder.path || '';
    const newPath = `${parentPath}/${finalName}`.replace('//', '/');

    const r2KeyPrefix = file.r2Key?.substring(0, file.r2Key.lastIndexOf('/')) || `uploads/${userId}`;
    const newR2Key = `${r2KeyPrefix}/${newFileId}/${finalName}`;

    await db.insert(files).values({
      id: newFileId,
      userId,
      parentId: targetFolderId,
      name: finalName,
      path: newPath,
      size: file.size,
      r2Key: newR2Key,
      mimeType: file.mimeType,
      isFolder: false,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const sourceObject = await env.FILES?.get(file.r2Key!);
      if (sourceObject) {
        const body = await sourceObject.arrayBuffer();
        await env.FILES?.put(newR2Key, new Uint8Array(body));
      }
    } catch (error) {
      logger.error('FileOpsTool', 'Failed to copy file in R2', { sourceId: fileId, newFileId }, error);
      try {
        await env.FILES?.delete(newR2Key);
      } catch {}
      await db.delete(files).where(eq(files.id, newFileId));
      return { error: '文件复制失败: 存储服务异常' };
    }

    return {
      success: true,
      message: `"${file.name}" 已复制为 "${finalName}"`,
      originalFileId: fileId,
      newFileId,
      originalName: file.name,
      newName: finalName,
      targetFolderName: targetFolder.name,
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
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNotNull(files.deletedAt)))
      .get();

    if (!file) return { error: '该文件不在回收站中或不存在' };

    await db
      .update(files)
      .set({
        deletedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    return {
      success: true,
      message: `"${file.name}" 已从回收站恢复`,
      fileId,
      fileName: file.name,
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

  static async executeStarFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const reason = args.reason as string | undefined;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      return { error: '文件不存在或无权访问' };
    }

    const isAlreadyStarred = file.isStarred ?? false;

    if (isAlreadyStarred) {
      return {
        success: true,
        message: `"${file.name}" 已经在收藏夹中`,
        alreadyStarred: true,
        fileId,
        fileName: file.name,
      };
    }

    await db
      .update(files)
      .set({
        isStarred: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    logger.info('AgentTool', 'Starred file', { fileId, fileName: file.name, reason: reason || '(none)' });

    return {
      success: true,
      message: `已收藏 "${file.name}"${reason ? ` (${reason})` : ''}`,
      fileId,
      fileName: file.name,
      _next_actions: ['✅ 收藏成功', '可通过 filter_files(isStarred=true) 查看所有收藏的文件'],
    };
  }

  static async executeUnstarFile(env: Env, userId: string, args: Record<string, unknown>) {
    const fileId = args.fileId as string;
    const db = getDb(env.DB);

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId), isNull(files.deletedAt)))
      .get();

    if (!file) {
      return { error: '文件不存在或无权访问' };
    }

    if (!(file.isStarred ?? false)) {
      return {
        success: true,
        message: `"${file.name}" 未被收藏`,
        alreadyUnstarred: true,
        fileId,
        fileName: file.name,
      };
    }

    await db
      .update(files)
      .set({
        isStarred: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(files.id, fileId));

    return {
      success: true,
      message: `已取消收藏 "${file.name}"`,
      fileId,
      fileName: file.name,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 辅助方法
  // ─────────────────────────────────────────────────────────────────────────

  private static async findOrCreateFolder(env: Env, userId: string, path: string): Promise<string | null> {
    const db = getDb(env.DB);

    const existing = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.path, path), eq(files.isFolder, true), isNull(files.deletedAt)))
      .get();

    if (existing) {
      return existing.id;
    }

    const parts = path.replace(/^\/+/, '').split('/');
    let parentId: string | null = null;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      const folder = await db
        .select()
        .from(files)
        .where(
          and(eq(files.userId, userId), eq(files.path, currentPath), eq(files.isFolder, true), isNull(files.deletedAt))
        )
        .get();

      if (folder) {
        parentId = folder.id;
      } else {
        const newFolderId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.insert(files).values({
          id: newFolderId,
          userId,
          parentId,
          name: part,
          path: currentPath,
          size: 0,
          r2Key: '',
          mimeType: null,
          isFolder: true,
          createdAt: now,
          updatedAt: now,
        });

        parentId = newFolderId;
      }
    }

    return parentId;
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
