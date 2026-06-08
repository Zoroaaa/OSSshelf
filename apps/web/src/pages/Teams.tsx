/**
 * Teams.tsx
 * 团队管理页面
 *
 * 功能:
 * - 团队列表展示与创建
 * - 成员管理入口
 * - 资源挂载管理
 */

import React from 'react';
import { TeamList } from '@/components/teams';

const Teams: React.FC = () => {
  return (
    <div className="space-y-6">
      <TeamList />
    </div>
  );
};

export default Teams;
