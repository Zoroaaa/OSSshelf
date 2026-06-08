/**
 * Permissions.tsx
 * 权限管理页面
 *
 * 功能:
 * - 全局授权管理
 * - 用户组管理
 * - 团队管理（v5.0.0 新增）
 * - Webhook 管理
 * - API Key 管理
 * - OpenAPI 文档入口
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/utils';
import { Users, Webhook, Key, BookOpen, Shield, HelpCircle, Building2, FileJson } from 'lucide-react';
import { GroupList } from '@/components/groups';
import { WebhookList } from '@/components/webhooks';
import { ApiKeyList } from '@/components/settings';
import GlobalPermissions from '@/components/permissions/GlobalPermissions';
import PermissionHelpDialog from '@/components/permissions/PermissionHelpDialog';
import { TeamList } from '@/components/teams';

type TabType = 'authorizations' | 'groups' | 'teams' | 'webhooks' | 'apikeys';

const tabs: Array<{ id: TabType; label: string; icon: React.ElementType }> = [
  { id: 'authorizations', label: '授权管理', icon: Shield },
  { id: 'groups', label: '用户组', icon: Users },
  { id: 'teams', label: '团队', icon: Building2 },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'apikeys', label: 'API Keys', icon: Key },
];

const Permissions: React.FC = () => {
  const { tab: urlTab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>((urlTab as TabType) || 'authorizations');
  const [showHelp, setShowHelp] = useState(false);

  const handleTabChange = (tabId: TabType) => {
    setActiveTab(tabId);
    navigate(`/permissions/${tabId}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">权限管理</h1>
        <p className="text-muted-foreground text-sm mt-0.5">管理用户组、授权、Webhook 和 API Key</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
        >
          <HelpCircle className="h-4 w-4" />
          权限说明
        </button>
        <a
          href={`${import.meta.env.VITE_API_URL}/api/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          API 文档
        </a>
        <a
          href={`${import.meta.env.VITE_API_URL}/api/openapi.json`}
          target="_blank"
          rel="noopener noreferrer"
          title="OpenAPI 3.1.0 JSON — 可导入 Postman / Swagger"
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
        >
          <FileJson className="h-4 w-4" />
          OpenAPI JSON
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 sm:gap-1 border-b overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                'flex items-center gap-1 px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-colors relative whitespace-nowrap flex-shrink-0',
                activeTab === tab.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span>{tab.label}</span>
              {activeTab === tab.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {activeTab === 'authorizations' && <GlobalPermissions />}
        {activeTab === 'groups' && <GroupList />}
        {activeTab === 'teams' && <TeamList />}
        {activeTab === 'webhooks' && <WebhookList />}
        {activeTab === 'apikeys' && <ApiKeyList />}
      </div>

      {showHelp && <PermissionHelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
};

export default Permissions;
