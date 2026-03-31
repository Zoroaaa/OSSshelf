/**
 * PermissionHelpDialog.tsx
 * 权限说明弹窗组件
 *
 * 功能:
 * - 说明只读、读写、管理三种权限的具体覆盖面
 * - 说明权限功能的使用方法
 */

import React from 'react';
import { X, Eye, Edit, Crown, Folder, FileText, Share2, Trash2, Download, Upload, Settings, Users } from 'lucide-react';
import { cn } from '@/utils';

interface PermissionHelpDialogProps {
  onClose: () => void;
}

const PermissionHelpDialog: React.FC<PermissionHelpDialogProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">权限说明</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          <section>
            <h3 className="text-base font-semibold mb-3">权限级别说明</h3>
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="h-5 w-5 text-blue-500" />
                  <span className="font-medium text-blue-500">只读</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  可以查看文件和文件夹内容，但不能进行任何修改操作。
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-green-600">
                    <Download className="h-3 w-3" /> 下载文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Eye className="h-3 w-3" /> 预览文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Folder className="h-3 w-3" /> 浏览文件夹
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Share2 className="h-3 w-3" /> 查看分享链接
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Upload className="h-3 w-3" /> 上传文件
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Edit className="h-3 w-3" /> 编辑文件
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Trash2 className="h-3 w-3" /> 删除文件
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Settings className="h-3 w-3" /> 管理权限
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-amber-500/5 border-amber-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Edit className="h-5 w-5 text-amber-500" />
                  <span className="font-medium text-amber-500">读写</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  可以查看、编辑、上传和下载文件，但不能管理权限或删除文件。
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-green-600">
                    <Download className="h-3 w-3" /> 下载文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Eye className="h-3 w-3" /> 预览文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Folder className="h-3 w-3" /> 浏览文件夹
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Upload className="h-3 w-3" /> 上传文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Edit className="h-3 w-3" /> 编辑文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <FileText className="h-3 w-3" /> 新建文件
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Trash2 className="h-3 w-3" /> 删除文件
                  </div>
                  <div className="flex items-center gap-1 text-red-500">
                    <Settings className="h-3 w-3" /> 管理权限
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-purple-500/5 border-purple-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="h-5 w-5 text-purple-500" />
                  <span className="font-medium text-purple-500">管理</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  拥有完整权限，包括查看、编辑、上传、下载、删除和权限管理。
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-green-600">
                    <Download className="h-3 w-3" /> 下载文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Eye className="h-3 w-3" /> 预览文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Folder className="h-3 w-3" /> 浏览文件夹
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Upload className="h-3 w-3" /> 上传文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Edit className="h-3 w-3" /> 编辑文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <FileText className="h-3 w-3" /> 新建文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Trash2 className="h-3 w-3" /> 删除文件
                  </div>
                  <div className="flex items-center gap-1 text-green-600">
                    <Settings className="h-3 w-3" /> 管理权限
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold mb-3">用户组成员角色</h3>
            <div className="space-y-3">
              <div className="p-3 rounded-lg border">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">普通成员</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  可以查看组内信息，当组被授权时自动获得相应权限。无法管理组成员或修改组信息。
                </p>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="flex items-center gap-2 mb-1">
                  <Crown className="h-4 w-4 text-amber-500" />
                  <span className="font-medium">组管理员</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  可以添加/移除成员、修改成员角色、使用组进行文件授权。组所有者拥有最高权限，可以删除组。
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold mb-3">权限继承</h3>
            <p className="text-sm text-muted-foreground">
              当对文件夹授权时，权限会自动继承到该文件夹下的所有子文件和子文件夹。
              例如：对「项目文档」文件夹授予用户「读写」权限，该用户将自动获得「项目文档」下所有内容的读写权限。
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold mb-3">权限有效期</h3>
            <p className="text-sm text-muted-foreground">
              授权时可以设置过期时间。过期后权限将自动失效，用户将无法继续访问相关资源。
              如需继续访问，需要重新授权。
            </p>
          </section>
        </div>

        <div className="p-4 border-t">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            我已了解
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionHelpDialog;
