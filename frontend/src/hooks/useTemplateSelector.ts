import { useState, useCallback } from 'react';

/**
 * 模板选择器 Hook
 * 统一管理模板选择、批量添加的逻辑
 */
export function useTemplateSelector<T>() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);

  // 切换模板选择
  const toggleTemplate = useCallback((index: number) => {
    setSelectedIndexes(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  }, []);

  // 全选/取消全选
  const toggleAll = useCallback((totalCount: number) => {
    setSelectedIndexes(prev => 
      prev.length === totalCount ? [] : Array.from({ length: totalCount }, (_, i) => i)
    );
  }, []);

  // 打开模板选择界面
  const openTemplates = useCallback(() => {
    setShowTemplates(true);
    setSelectedIndexes([]);
  }, []);

  // 关闭模板选择界面
  const closeTemplates = useCallback(() => {
    setShowTemplates(false);
    setSelectedIndexes([]);
  }, []);

  // 检查是否选中
  const isSelected = useCallback((index: number) => selectedIndexes.includes(index), [selectedIndexes]);

  // 批量添加后重置
  const resetSelection = useCallback(() => {
    setSelectedIndexes([]);
  }, []);

  return {
    showTemplates,
    selectedIndexes,
    selectedCount: selectedIndexes.length,
    toggleTemplate,
    toggleAll,
    openTemplates,
    closeTemplates,
    isSelected,
    resetSelection,
    setShowTemplates,
  };
}

export default useTemplateSelector;

