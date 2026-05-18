import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', style }) => (
  <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} style={style} />
);

// 任务卡片骨架
export const TaskCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="w-16 h-8 rounded-lg flex-shrink-0" />
    </div>
    <div className="flex items-center justify-between">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-16" />
    </div>
  </div>
);

// 统计图表骨架
export const StatsChartSkeleton: React.FC = () => (
  <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 shadow-lg">
    <div className="flex justify-between items-start mb-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-24 bg-white/20" />
        <Skeleton className="h-3 w-16 bg-white/20" />
      </div>
    </div>
    <div className="flex items-end justify-between h-24 gap-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="w-full bg-white/20 rounded-t-lg" style={{ height: `${30 + Math.random() * 50}%` }} />
      ))}
    </div>
  </div>
);

// 列表骨架（指定数量）
export const TaskListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <TaskCardSkeleton key={i} />
    ))}
  </div>
);

// 审核任务卡片骨架
export const ReviewCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-5 h-5 rounded flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
    <div className="flex gap-2">
      <Skeleton className="h-10 flex-1 rounded-xl" />
      <Skeleton className="h-10 flex-1 rounded-xl" />
    </div>
  </div>
);

// 商品卡片骨架
export const ShopCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
    <Skeleton className="h-8 w-full rounded-lg" />
  </div>
);

// 通用行骨架
export const RowSkeleton: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
  <div className="space-y-3">
    {Array.from({ length: lines }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    ))}
  </div>
);
