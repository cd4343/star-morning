import React, { useState, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

/**
 * 下拉刷新组件
 * 包裹内容区域，支持下拉触发刷新
 */
export const PullToRefresh: React.FC<PullToRefreshProps> = ({ 
  onRefresh, 
  children, 
  className = '' 
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const THRESHOLD = 60; // 触发刷新的阈值
  const MAX_PULL = 100; // 最大下拉距离

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop === 0 && !isRefreshing) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0 && containerRef.current?.scrollTop === 0) {
      // 阻尼效果：下拉越多，阻力越大
      const dampedDiff = Math.min(diff * 0.4, MAX_PULL);
      setPullDistance(dampedDiff);
      
      if (dampedDiff > 10) {
        e.preventDefault(); // 阻止默认滚动
      }
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(THRESHOLD); // 保持在阈值位置
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const shouldTrigger = pullDistance >= THRESHOLD;

  return (
    <div 
      ref={containerRef}
      className={`relative overflow-y-auto ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 下拉指示器 */}
      <div 
        className="absolute left-0 right-0 flex justify-center items-center transition-all duration-200 z-10 pointer-events-none"
        style={{ 
          top: -50 + pullDistance,
          opacity: progress,
          transform: `scale(${0.5 + progress * 0.5})`
        }}
      >
        <div className={`flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-lg border ${shouldTrigger ? 'border-blue-300 text-blue-600' : 'border-gray-200 text-gray-500'}`}>
          <RefreshCw 
            size={18} 
            className={`transition-transform ${isRefreshing ? 'animate-spin' : ''}`}
            style={{ transform: isRefreshing ? undefined : `rotate(${progress * 180}deg)` }}
          />
          <span className="text-xs font-medium">
            {isRefreshing ? '刷新中...' : shouldTrigger ? '松开刷新' : '下拉刷新'}
          </span>
        </div>
      </div>

      {/* 内容区域 */}
      <div 
        style={{ 
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling.current ? 'none' : 'transform 0.2s ease-out'
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default PullToRefresh;

