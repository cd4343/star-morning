import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Trash2, Sparkles, Check, Pen, Users } from 'lucide-react';
import api from '../../services/api';
import { useTemplateSelector } from '../../hooks/useTemplateSelector';
import { IconPicker } from '../../components/IconPicker';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';
import { CreateActionCard } from '../../components/CreateActionCard';
import {
  TASK_CATEGORY_FILTERS,
  TASK_CATEGORY_OPTIONS,
  getTaskCategoryInfo,
  normalizeTaskCategory,
  taskMatchesCategory,
} from '../../utils/taskCategories';
import {
  TASK_COMPLETION_MODE_OPTIONS,
  TaskCompletionMode,
  getCompletionModeInfo,
  getDefaultReviewFocus,
  getDefaultTargetUnit,
  getRecommendedCompletionMode,
  getTaskCompletionSummary,
} from '../../utils/taskCompletion';
import { getSuggestedTaskReward } from '../../utils/taskRewards';

// 预设任务模板
const TASK_TEMPLATES = [
  // 日常生活
  { title: '整理床铺', category: '生活', coinReward: 10, xpReward: 10, duration: 5, icon: '🛏️' },
  { title: '刷牙洗脸', category: '生活', coinReward: 5, xpReward: 5, duration: 5, icon: '🪥' },
  { title: '收拾玩具', category: '生活', coinReward: 10, xpReward: 10, duration: 10, icon: '🧸' },
  { title: '整理书包', category: '生活', coinReward: 10, xpReward: 10, duration: 5, icon: '🎒' },
  { title: '穿衣服', category: '生活', coinReward: 5, xpReward: 5, duration: 5, icon: '👕' },
  // 学习任务
  { title: '完成作业', category: '学习', coinReward: 50, xpReward: 50, duration: 60, icon: '📚' },
  { title: '阅读30分钟', category: '学习', coinReward: 30, xpReward: 30, duration: 30, icon: '📖' },
  { title: '练习写字', category: '学习', coinReward: 20, xpReward: 20, duration: 20, icon: '✍️' },
  { title: '背诵古诗', category: '学习', coinReward: 25, xpReward: 25, duration: 15, icon: '📜' },
  { title: '英语单词', category: '学习', coinReward: 20, xpReward: 20, duration: 15, icon: '🔤' },
  // 家务劳动
  { title: '扫地拖地', category: '生活', coinReward: 30, xpReward: 30, duration: 20, icon: '🧹' },
  { title: '洗碗', category: '生活', coinReward: 25, xpReward: 25, duration: 15, icon: '🍽️' },
  { title: '倒垃圾', category: '生活', coinReward: 10, xpReward: 10, duration: 5, icon: '🗑️' },
  { title: '浇花', category: '生活', coinReward: 10, xpReward: 10, duration: 5, icon: '🌱' },
  { title: '喂宠物', category: '生活', coinReward: 15, xpReward: 15, duration: 10, icon: '🐕' },
  // 运动健康
  { title: '跳绳100个', category: '运动', coinReward: 20, xpReward: 20, duration: 10, icon: '🏃' },
  { title: '户外运动30分钟', category: '运动', coinReward: 30, xpReward: 30, duration: 30, icon: '⚽' },
  { title: '做眼保健操', category: '运动', coinReward: 10, xpReward: 10, duration: 5, icon: '👀' },
  { title: '早起锻炼', category: '运动', coinReward: 25, xpReward: 25, duration: 20, icon: '🌅' },
  // 兴趣爱好
  { title: '练习钢琴', category: '活动', coinReward: 40, xpReward: 40, duration: 30, icon: '🎹' },
  { title: '画画', category: '活动', coinReward: 25, xpReward: 25, duration: 30, icon: '🎨' },
  { title: '练习乐器', category: '活动', coinReward: 35, xpReward: 35, duration: 30, icon: '🎸' },
  { title: '下棋', category: '活动', coinReward: 20, xpReward: 20, duration: 20, icon: '♟️' },
  // 情绪调节
  { title: '冷静呼吸3轮', category: '情绪调节', coinReward: 5, xpReward: 15, duration: 5, icon: '💗' },
  { title: '说出今天的感受', category: '情绪调节', coinReward: 5, xpReward: 15, duration: 5, icon: '🗣️' },
  { title: '写下一个解决办法', category: '情绪调节', coinReward: 5, xpReward: 20, duration: 8, icon: '📝' },
];

export default function ParentTasks() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const { showTemplates, selectedIndexes, selectedCount, toggleTemplate, isSelected, openTemplates, closeTemplates } = useTemplateSelector();

  const [title, setTitle] = useState('');
  const [coinReward, setCoinReward] = useState('10');
  const [xpReward, setXpReward] = useState('10');
  const [duration, setDuration] = useState('15');
  const [category, setCategory] = useState('生活');
  const [icon, setIcon] = useState('📋');
  const [completionMode, setCompletionMode] = useState<TaskCompletionMode>('timer');
  const [targetValue, setTargetValue] = useState('');
  const [targetUnit, setTargetUnit] = useState('分钟');
  const [reviewFocus, setReviewFocus] = useState('');

  // 任务类型状态（新版：daily/once/custom）
  const [taskType, setTaskType] = useState<'daily' | 'once' | 'custom'>('daily');
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]); // 默认工作日

  // 模板批量任务类型设置
  const [templateTaskType, setTemplateTaskType] = useState<'daily' | 'once' | 'custom'>('daily');
  const [templateCustomDays, setTemplateCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);

  // 编辑状态
  const [editingTask, setEditingTask] = useState<any>(null);

  // 并行任务设定
  const [isParallel, setIsParallel] = useState(false);

  // 分类筛选
  const [filterCategory, setFilterCategory] = useState<string>('全部');
  const filteredTasks = filterCategory === '全部'
    ? tasks
    : tasks.filter(t => taskMatchesCategory(t.category, filterCategory));
  const suggestedTaskReward = getSuggestedTaskReward({
    minutes: duration,
    category,
    completionMode,
    targetValue,
  });
  const selectedCategoryInfo = getTaskCategoryInfo(category);
  const applySuggestedTaskReward = () => {
    setCoinReward(String(suggestedTaskReward.coins));
    setXpReward(String(suggestedTaskReward.xp));
  };
  const completionInfo = getCompletionModeInfo(completionMode, category);

  const applyCompletionDefaults = (nextCategory = category) => {
    const nextMode = getRecommendedCompletionMode(nextCategory);
    setCompletionMode(nextMode);
    setTargetUnit(getDefaultTargetUnit(nextMode, nextCategory));
    setReviewFocus(getDefaultReviewFocus(nextMode, nextCategory));
    if (nextMode === 'timer') {
      setTargetValue('');
    } else {
      setTargetValue(duration || '15');
    }
  };

  const handleCategoryChange = (nextCategory: string) => {
    setCategory(nextCategory);
    const nextMode = getRecommendedCompletionMode(nextCategory);
    setCompletionMode(nextMode);
    setTargetUnit(getDefaultTargetUnit(nextMode, nextCategory));
    setReviewFocus(getDefaultReviewFocus(nextMode, nextCategory));
    setTargetValue(nextMode === 'timer' ? '' : (targetValue || duration || '15'));
  };

  const completionPayload = () => ({
    completionMode,
    targetValue: targetValue === '' ? null : Number(targetValue),
    targetUnit,
    reviewFocus,
  });

  const renderCompletionSettings = (compact = false) => (
    <div className={`${compact ? 'p-2.5' : 'p-3'} rounded-xl border border-emerald-100 bg-emerald-50/70 space-y-3`}>
      <div>
        <div className="text-sm font-black text-gray-800">完成方式</div>
        <div className="text-[11px] font-bold text-emerald-700 mt-0.5">
          {selectedCategoryInfo.label}类建议：{completionInfo.label}。运动、活动和情绪调节看参与质量，不按快慢算分。
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TASK_COMPLETION_MODE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setCompletionMode(option.value);
              setTargetUnit(getDefaultTargetUnit(option.value, category));
              setReviewFocus(getDefaultReviewFocus(option.value, category));
              setTargetValue(option.value === 'timer' ? '' : (targetValue || duration || '15'));
            }}
            className={`rounded-xl border px-2 py-2 text-left transition-all ${
              completionMode === option.value
                ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                : 'bg-white text-gray-600 border-emerald-100'
            }`}
          >
            <div className="text-xs font-black">{option.label}</div>
            <div className={`text-[10px] mt-1 leading-relaxed ${completionMode === option.value ? 'text-white/85' : 'text-gray-400'}`}>
              {option.parentDesc}
            </div>
          </button>
        ))}
      </div>
      {completionMode !== 'timer' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 font-bold block mb-1">目标量</label>
            <input
              className="w-full p-2 rounded-xl border bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              type="number"
              value={targetValue}
              onChange={e => setTargetValue(e.target.value)}
              placeholder="例如 30"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 font-bold block mb-1">单位</label>
            <input
              className="w-full p-2 rounded-xl border bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
              value={targetUnit}
              onChange={e => setTargetUnit(e.target.value)}
              placeholder="分钟/组"
            />
          </div>
        </div>
      )}
      <div>
        <label className="text-[10px] text-gray-500 font-bold block mb-1">家长审核重点</label>
        <input
          className="w-full p-2 rounded-xl border bg-white focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
          value={reviewFocus}
          onChange={e => setReviewFocus(e.target.value)}
          placeholder={getDefaultReviewFocus(completionMode, category)}
        />
      </div>
    </div>
  );

  // Tab切换
  const [activeTab, setActiveTab] = useState<'normal' | 'coop'>('normal');

  // 合作任务（家庭任务）状态
  const [familyMissions, setFamilyMissions] = useState<any[]>([]);
  const [showAddMission, setShowAddMission] = useState(false);
  const [editingMission, setEditingMission] = useState<any>(null);
  const [missionTitle, setMissionTitle] = useState('');
  const [missionIcon, setMissionIcon] = useState('🏠');
  const [missionCoinReward, setMissionCoinReward] = useState('200');
  const [missionXpReward, setMissionXpReward] = useState('100');
  const [missionDuration, setMissionDuration] = useState('30');

  useEffect(() => { fetchTasks(); }, []);
  useEffect(() => { if (activeTab === 'coop') fetchFamilyMissions(); }, [activeTab]);

  const fetchTasks = async () => { const res = await api.get('/parent/tasks'); setTasks(res.data); };
  const fetchFamilyMissions = async () => { const res = await api.get('/parent/family-missions'); setFamilyMissions(res.data); };

  // 打开编辑
  const openEdit = (task: any) => {
    setEditingTask(task);
    setTitle(task.title);
    setCoinReward(String(task.coinReward));
    setXpReward(String(task.xpReward));
    setDuration(String(task.durationMinutes));
    setCategory(normalizeTaskCategory(task.category));
    setIcon(task.icon || '📋');
    setTaskType(task.taskType || 'daily');
    const nextMode = (task.completionMode || getRecommendedCompletionMode(task.category)) as TaskCompletionMode;
    setCompletionMode(nextMode);
    setTargetValue(task.targetValue ? String(task.targetValue) : '');
    setTargetUnit(task.targetUnit || getDefaultTargetUnit(nextMode, task.category));
    setReviewFocus(task.reviewFocus || getDefaultReviewFocus(nextMode, task.category));
    try {
      setCustomDays(task.customDays ? JSON.parse(task.customDays) : [1, 2, 3, 4, 5]);
    } catch { setCustomDays([1, 2, 3, 4, 5]); }
    setIsParallel(!!task.isParallel);
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingTask(null);
    setTitle('');
    setCoinReward('10');
    setXpReward('10');
    setDuration('15');
    setCategory('生活');
    setTaskType('daily');
    setCustomDays([1, 2, 3, 4, 5]);
    setIsParallel(false);
    setCompletionMode('timer');
    setTargetValue('');
    setTargetUnit('分钟');
    setReviewFocus('');
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingTask) return;
    try {
      await api.put(`/parent/tasks/${editingTask.id}`, {
        title, coinReward: +coinReward, xpReward: +xpReward, durationMinutes: +duration, category, icon,
        taskType, customDays: taskType === 'custom' ? customDays : null, isParallel,
        ...completionPayload()
      });
      cancelEdit();
      fetchTasks();
    } catch {
      toast.error('保存失败');
    }
  };

  const handleAdd = async () => {
    if (!title) return toast.warning('请输入标题');
    await api.post('/parent/tasks', {
      title, coinReward: +coinReward, xpReward: +xpReward, durationMinutes: +duration, category, icon,
      taskType, customDays: taskType === 'custom' ? customDays : null, isParallel,
      ...completionPayload()
    });
    setShowAdd(false); setTitle(''); setIcon('📋');
    setTaskType('daily'); setCustomDays([1, 2, 3, 4, 5]); setIsParallel(false); applyCompletionDefaults('生活');
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除任务',
      message: '确定删除这个任务吗？已完成的任务记录会被保留，统计数据不受影响。',
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    try {
      const res = await api.delete(`/parent/tasks/${id}`);
      const data = res.data as { message: string; preservedRecords?: number; note?: string };
      if (data.note) toast.info(data.note);
      toast.success('删除成功');
      fetchTasks();
    } catch {
      toast.error('删除失败，请重试');
    }
  };

  const handleAddTemplates = async () => {
    if (selectedCount === 0) return toast.warning('请至少选择一个任务模板');

    try {
      for (const index of selectedIndexes) {
        const template = TASK_TEMPLATES[index];
        const templateCompletionMode = getRecommendedCompletionMode(template.category);
        const templateReward = getSuggestedTaskReward({
          minutes: template.duration,
          category: template.category,
          completionMode: templateCompletionMode,
          targetValue: templateCompletionMode === 'timer' ? null : template.duration,
        });
        await api.post('/parent/tasks', {
          title: template.title,
          coinReward: templateReward.coins,
          xpReward: templateReward.xp,
          durationMinutes: template.duration,
          category: template.category,
          icon: template.icon,
          taskType: templateTaskType,
          customDays: templateTaskType === 'custom' ? templateCustomDays : null,
          completionMode: templateCompletionMode,
          targetValue: templateCompletionMode === 'timer' ? null : template.duration,
          targetUnit: getDefaultTargetUnit(templateCompletionMode, template.category),
          reviewFocus: getDefaultReviewFocus(templateCompletionMode, template.category),
        });
      }
      const typeLabels = { daily: '每日', once: '单次', custom: '自定义' };
      toast.success(`成功添加 ${selectedCount} 个${typeLabels[templateTaskType]}任务！`);
      closeTemplates();
      setTemplateTaskType('daily');
      setTemplateCustomDays([1, 2, 3, 4, 5]);
      fetchTasks();
    } catch {
      toast.error('添加失败');
    }
  };

  // 合作任务（家庭任务）操作
  const resetMissionForm = () => {
    setMissionTitle('');
    setMissionIcon('🏠');
    setMissionCoinReward('200');
    setMissionXpReward('100');
    setMissionDuration('30');
    setEditingMission(null);
  };

  const openEditMission = (mission: any) => {
    setEditingMission(mission);
    setMissionTitle(mission.title);
    setMissionIcon(mission.icon || '🏠');
    setMissionCoinReward(String(mission.coinReward));
    setMissionXpReward(String(mission.xpReward));
    setMissionDuration(String(mission.durationMinutes));
    setShowAddMission(true);
  };

  const handleSaveMission = async () => {
    if (!missionTitle) return toast.warning('请输入标题');
    try {
      if (editingMission) {
        await api.put(`/parent/family-missions/${editingMission.id}`, {
          title: missionTitle,
          icon: missionIcon,
          coinReward: +missionCoinReward,
          xpReward: +missionXpReward,
          durationMinutes: +missionDuration,
        });
        toast.success('修改成功');
      } else {
        await api.post('/parent/family-missions', {
          title: missionTitle,
          icon: missionIcon,
          coinReward: +missionCoinReward,
          xpReward: +missionXpReward,
          durationMinutes: +missionDuration,
        });
        toast.success('创建成功');
      }
      setShowAddMission(false);
      resetMissionForm();
      fetchFamilyMissions();
    } catch {
      toast.error(editingMission ? '修改失败' : '创建失败');
    }
  };

  const handleDeleteMission = async (id: string) => {
    const confirmed = await confirm({
      title: '删除合作任务',
      message: '确定删除这个合作任务吗？',
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/parent/family-missions/${id}`);
      toast.success('删除成功');
      fetchFamilyMissions();
    } catch {
      toast.error('删除失败，请重试');
    }
  };

  // 按类别分组模板
  const groupedTemplates = TASK_TEMPLATES.reduce((acc, template, index) => {
    if (!acc[template.category]) acc[template.category] = [];
    acc[template.category].push({ ...template, index });
    return acc;
  }, {} as Record<string, (typeof TASK_TEMPLATES[0] & { index: number })[]>);

  return (
    <Layout>
      <Header title="任务管理" showBack onBack={() => navigate('/parent/dashboard')} />

      {/* 新建任务 - 底部抽屉 */}
      <BottomSheet
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        title="📋 新建任务"
        footer={
          <div className="flex gap-3">
            <Button onClick={handleAdd} className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 border-none">保存任务</Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">任务标题</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="例如：整理床铺" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">种类</label>
              <select className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={category} onChange={e => handleCategoryChange(e.target.value)}>
                {TASK_CATEGORY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.icon} {option.label}</option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="text-xs text-gray-500 font-bold block mb-1">时长(分)</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" type="number" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs text-slate-600 leading-relaxed">
            <div className="font-black text-slate-800 mb-1">
              {selectedCategoryInfo.icon} {selectedCategoryInfo.label}类任务
            </div>
            {selectedCategoryInfo.parentDesc}
          </div>

          {renderCompletionSettings()}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">💰 奖励金币</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" type="number" value={coinReward} onChange={e => setCoinReward(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">⭐ 奖励经验</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" type="number" value={xpReward} onChange={e => setXpReward(e.target.value)} />
            </div>
          </div>

          <div className="p-3 rounded-xl border border-blue-100 bg-blue-50 text-xs text-blue-800">
            <div className="font-bold mb-1">{suggestedTaskReward.title}</div>
            <div className="leading-relaxed">
              {suggestedTaskReward.basis} 当前建议：{suggestedTaskReward.coins} 金币 / {suggestedTaskReward.xp} 经验。
            </div>
            <div className="mt-1 leading-relaxed text-blue-700">{suggestedTaskReward.settlement}</div>
            <button type="button" onClick={applySuggestedTaskReward} className="mt-2 px-3 py-1 rounded-lg bg-blue-500 text-white font-bold">套用建议</button>
          </div>

          <div className="p-3 rounded-xl border bg-blue-50/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚀</span>
              <div>
                <div className="text-sm font-bold text-gray-700">并行任务</div>
                <div className="text-[10px] text-gray-400">开启后此任务可与其他任务同时运行</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsParallel(!isParallel)}
              className={`w-12 h-6 rounded-full transition-all relative ${isParallel ? 'bg-blue-500' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isParallel ? 'left-7' : 'left-1'}`}></div>
            </button>
          </div>

          {/* 任务类型选择 */}
          <div className="p-3 rounded-xl border-2 border-gray-200 bg-gray-50">
            <div className="text-sm font-bold text-gray-700 mb-3">🔄 任务类型</div>
            <div className="flex gap-2 mb-3">
              {[
                { value: 'daily', label: '每日', icon: '🔁', desc: '每天都要完成' },
                { value: 'once', label: '单次', icon: '📌', desc: '只在今天' },
                { value: 'custom', label: '自定义', icon: '⚙️', desc: '选择星期' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTaskType(opt.value as any)}
                  className={`flex-1 py-2.5 px-2 rounded-xl text-center transition-all ${
                    taskType === opt.value
                      ? 'bg-blue-500 text-white shadow-lg scale-[1.02]'
                      : 'bg-white text-gray-600 border hover:border-blue-300'
                  }`}
                >
                  <div className="text-lg">{opt.icon}</div>
                  <div className="text-xs font-bold mt-1">{opt.label}</div>
                </button>
              ))}
            </div>
            {/* 自定义周期：选择星期 */}
            {taskType === 'custom' && (
              <div className="bg-white rounded-lg p-2 border">
                <div className="text-[10px] text-gray-400 mb-2">选择任务出现的日期</div>
                <div className="flex gap-1">
                  {['日', '一', '二', '三', '四', '五', '六'].map((day, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (customDays.includes(i)) {
                          setCustomDays(customDays.filter(d => d !== i));
                        } else {
                          setCustomDays([...customDays, i].sort());
                        }
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        customDays.includes(i)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* 类型说明 */}
            <div className="text-[10px] text-gray-400 mt-2">
              {taskType === 'daily' && '💡 每日任务：每天都会出现，培养好习惯'}
              {taskType === 'once' && '💡 单次任务：只在今天出现，明天自动消失'}
              {taskType === 'custom' && '💡 自定义：只在选中的星期出现'}
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* 新建/编辑合作任务 - 底部抽屉 */}
      <BottomSheet
        isOpen={showAddMission}
        onClose={() => { setShowAddMission(false); resetMissionForm(); }}
        title={editingMission ? '🏠 编辑合作任务' : '🏠 新建合作任务'}
        footer={
          <div className="flex gap-3">
            <Button onClick={handleSaveMission} className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-500 border-none">保存</Button>
            <Button variant="ghost" onClick={() => { setShowAddMission(false); resetMissionForm(); }} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
              <IconPicker value={missionIcon} onChange={setMissionIcon} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">任务标题</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-500 outline-none transition-all" placeholder="例如：全家大扫除" value={missionTitle} onChange={e => setMissionTitle(e.target.value)} />
            </div>
          </div>
          <div className="w-24">
            <label className="text-xs text-gray-500 font-bold block mb-1">时长(分)</label>
            <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-500 outline-none" type="number" value={missionDuration} onChange={e => setMissionDuration(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">💰 奖励金币</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-500 outline-none" type="number" value={missionCoinReward} onChange={e => setMissionCoinReward(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">⭐ 奖励经验</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-500 outline-none" type="number" value={missionXpReward} onChange={e => setMissionXpReward(e.target.value)} />
            </div>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2">
            <span className="text-blue-500">ℹ️</span>
            <span className="text-[10px] text-blue-700 leading-relaxed">
              <strong>大型任务提示：</strong>合作任务默认为“独占模式”。当孩子开始此任务时，将无法同时运行其他普通任务，反之亦然。这有助于孩子专注于完成大型目标。
            </span>
          </div>
        </div>
      </BottomSheet>

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        {/* Tab 切换 */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setActiveTab('normal')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'normal'
                ? 'bg-blue-500 text-white shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            普通任务
          </button>
          <button
            onClick={() => setActiveTab('coop')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'coop'
                ? 'bg-green-500 text-white shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Users size={16} /> 合作任务
          </button>
        </div>

        {activeTab === 'normal' ? (
          <CreateActionCard
            icon="📋"
            title="把今天要练习的事放到任务里"
            description="普通任务适合日常习惯、学习练习和兴趣活动。运动类可以只记活动组数，不强行按时间放大奖励。"
            primaryLabel="📋 新建任务"
            onPrimary={() => setShowAdd(true)}
            primaryClassName="bg-blue-600 border-none"
            secondaryLabel="从模板添加"
            secondaryIcon={<Sparkles size={15} />}
            onSecondary={openTemplates}
            tone="from-blue-50 to-indigo-50 border-blue-100"
          >
              <details className="mt-3 rounded-xl bg-white/70 border border-blue-100 px-3 py-2">
                <summary className="cursor-pointer text-xs font-black text-blue-700">查看任务分类说明</summary>
                <div className="mt-2 space-y-2">
                  {TASK_CATEGORY_OPTIONS.map(option => (
                    <div key={option.value} className="text-xs text-gray-600 leading-relaxed">
                      <span className="font-black text-gray-800">{option.icon} {option.label}：</span>{option.parentDesc}
                    </div>
                  ))}
                </div>
              </details>
          </CreateActionCard>
        ) : (
          <CreateActionCard
            icon="🏠"
            title="合作任务适合全家一起完成的大目标"
            description="例如全家收纳、周末大扫除、亲子运动挑战。开始后会帮助孩子聚焦一个大型目标。"
            primaryLabel="🏠 新建合作任务"
            onPrimary={() => { resetMissionForm(); setShowAddMission(true); }}
            primaryClassName="bg-green-600 border-none"
            tone="from-green-50 to-emerald-50 border-green-100"
          />
        )}

        {activeTab === 'normal' && (
          <>
            {/* 空状态 */}
            {tasks.length === 0 && !showAdd && !showTemplates && (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">📋</div>
                <div className="text-gray-500 mb-4">还没有任务哦</div>
                <div className="flex flex-col gap-2">
                  <button onClick={openTemplates} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all">
                    <Sparkles size={18}/> 从模板快速添加
                  </button>
                  <button onClick={() => setShowAdd(true)} className="text-blue-600 font-medium text-sm">
                    或手动创建任务
                  </button>
                </div>
              </div>
            )}

            {/* 模板选择界面 */}
            {showTemplates && (
              <div className="animate-in fade-in pb-20">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Sparkles className="text-purple-500" size={20}/> 选择任务模板
                  </h3>
                  <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
                </div>

                {Object.entries(groupedTemplates).map(([cat, templates]) => (
                  <div key={cat} className="mb-4">
                    <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">{cat}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {templates.map(template => {
                        const templateCompletionMode = getRecommendedCompletionMode(template.category);
                        const templateReward = getSuggestedTaskReward({
                          minutes: template.duration,
                          category: template.category,
                          completionMode: templateCompletionMode,
                          targetValue: templateCompletionMode === 'timer' ? null : template.duration,
                        });
                        return (
                          <button
                            key={template.index}
                            onClick={() => toggleTemplate(template.index)}
                            className={`p-3 rounded-xl text-left transition-all border-2 ${
                              isSelected(template.index)
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-100 bg-white hover:border-gray-200'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <span className="text-xl">{template.icon}</span>
                              {isSelected(template.index) && <Check size={16} className="text-purple-500"/>}
                            </div>
                            <div className="font-bold text-sm mt-1 text-gray-800">{template.title}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              💰{templateReward.coins} · ⭐{templateReward.xp} · ⏰{template.duration}分
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

              </div>
            )}

            {/* 模板选择底部操作栏 - 绝对定位 + 安全区域 */}
            {showTemplates && (
              <div className="absolute bottom-0 left-0 right-0 bg-white py-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t shadow-[0_-4px_12px_rgba(0,0,0,0.1)] z-20 space-y-2">
                {/* 批量任务类型设置 */}
                <div className="flex gap-1.5">
                  {[
                    { value: 'daily', label: '每日', icon: '🔁' },
                    { value: 'once', label: '单次', icon: '📌' },
                    { value: 'custom', label: '自定义', icon: '⚙️' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTemplateTaskType(opt.value as any)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${
                        templateTaskType === opt.value
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
                {/* 自定义周期选择 */}
                {templateTaskType === 'custom' && (
                  <div className="flex gap-1">
                    {['日', '一', '二', '三', '四', '五', '六'].map((day, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          if (templateCustomDays.includes(i)) {
                            setTemplateCustomDays(templateCustomDays.filter(d => d !== i));
                          } else {
                            setTemplateCustomDays([...templateCustomDays, i].sort());
                          }
                        }}
                        className={`flex-1 py-1 rounded text-[10px] font-bold ${
                          templateCustomDays.includes(i)
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={() => { closeTemplates(); setTemplateTaskType('daily'); }} variant="ghost" className="flex-1">取消</Button>
                  <Button onClick={handleAddTemplates} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 border-none" disabled={selectedCount === 0}>
                    添加 {selectedCount} 个任务
                  </Button>
                </div>
              </div>
            )}

            {/* 已有任务列表 */}
            {tasks.length > 0 && !showTemplates && (
              <>
                {/* 分类筛选标签 */}
                <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
                  {TASK_CATEGORY_FILTERS.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                        filterCategory === cat
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat === '全部' ? `全部 (${tasks.length})` : `${cat} (${tasks.filter(t => taskMatchesCategory(t.category, cat)).length})`}
                    </button>
                  ))}
                </div>

                <button onClick={openTemplates} className="w-full p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-center justify-center gap-2 text-purple-600 font-medium text-sm hover:from-purple-100 hover:to-pink-100 transition-all mb-2">
                  <Sparkles size={16}/> 从模板快速添加更多任务
                </button>

                {filteredTasks.map(task => {
                  // 解析任务类型和自定义天数
                  const type = task.taskType || 'daily';
                  let customDaysArr: number[] = [];
                  try { customDaysArr = task.customDays ? JSON.parse(task.customDays) : []; } catch {}
                  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
                  const customDaysText = customDaysArr.map(d => dayNames[d]).join('');
                  const completionSummary = getTaskCompletionSummary(task);

                  return (
                    <Card key={task.id} className="flex justify-between items-center">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl relative">
                          {task.icon || '📋'}
                        </div>
                        <div>
                          <div className="font-bold flex items-center gap-1.5">
                            {task.title}
                            {/* 任务类型标签 */}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${
                              type === 'daily' ? 'bg-blue-100 text-blue-600' :
                              type === 'once' ? 'bg-amber-100 text-amber-600' :
                              'bg-purple-100 text-purple-600'
                            }`}>
                              {type === 'daily' ? '🔁每日' : type === 'once' ? '📌单次' : `⚙️${customDaysText}`}
                            </span>
                            {task.isParallel ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-normal">
                                🚀并行
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {getTaskCategoryInfo(task.category).label} | 💰{task.coinReward} | ⭐{task.xpReward} | ⏰{task.durationMinutes}分
                          </div>
                          <div className="text-[10px] text-emerald-600 font-bold mt-1">
                            {completionSummary.label}：{completionSummary.targetText}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(task)} className="text-blue-400 hover:text-blue-600 p-1"><Pen size={16}/></button>
                        <button onClick={() => handleDelete(task.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                      </div>
                    </Card>
                  );
                })}
              </>
            )}
          </>
        )}

        {activeTab === 'coop' && (
          <>
            {familyMissions.length === 0 && (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">🏠</div>
                <div className="text-gray-500 mb-4">还没有合作任务哦</div>
                <button onClick={() => { resetMissionForm(); setShowAddMission(true); }} className="bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all">
                  <Users size={18}/> 创建合作任务
                </button>
              </div>
            )}

            {familyMissions.length > 0 && (
              <>
                <button onClick={() => { resetMissionForm(); setShowAddMission(true); }} className="w-full p-3 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-xl flex items-center justify-center gap-2 text-green-600 font-medium text-sm hover:from-green-100 hover:to-emerald-100 transition-all mb-2">
                  <Users size={16}/> 创建新的合作任务
                </button>

                {familyMissions.map(mission => {
                  const completedCount = mission.completedCount || 0;
                  const childCount = mission.childCount || 1;
                  const isComplete = completedCount >= childCount;
                  return (
                    <Card key={mission.id} className="flex justify-between items-center">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-xl relative">
                          {mission.icon || '🏠'}
                          {isComplete && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                              <Check size={10} className="text-white" />
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold flex items-center gap-1.5">
                            {mission.title}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${
                              isComplete ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'
                            }`}>
                              {isComplete ? '已完成' : '进行中'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            💰{mission.coinReward} | ⭐{mission.xpReward} | ⏰{mission.durationMinutes}分 | 进度 {completedCount}/{childCount}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditMission(mission)} className="text-blue-400 hover:text-blue-600 p-1"><Pen size={16}/></button>
                        <button onClick={() => handleDeleteMission(mission.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                      </div>
                    </Card>
                  );
                })}
              </>
            )}
          </>
        )}

        <BottomSheet
          isOpen={Boolean(editingTask)}
          onClose={cancelEdit}
          title="编辑任务"
          footer={
            <div className="flex gap-2">
              <Button onClick={handleSaveEdit} className="flex-1">保存修改</Button>
              <Button variant="ghost" onClick={cancelEdit} className="flex-1">取消</Button>
            </div>
          }
        >
          {editingTask && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div>
                    <label className="text-xs text-gray-500 font-bold">图标</label>
                    <IconPicker value={icon} onChange={setIcon} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">任务标题</label>
                    <input className="w-full p-2 rounded border mt-1" value={title} onChange={e => setTitle(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">种类</label>
                    <select className="w-full p-2 rounded border bg-white mt-1" value={category} onChange={e => handleCategoryChange(e.target.value)}>
                      {TASK_CATEGORY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.icon} {option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-gray-500 font-bold">时长(分)</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={duration} onChange={e => setDuration(e.target.value)} />
                  </div>
                </div>
                <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-[10px] text-slate-600 leading-relaxed">
                  <div className="font-bold text-slate-800 mb-1">{selectedCategoryInfo.icon} {selectedCategoryInfo.label}类任务</div>
                  {selectedCategoryInfo.parentDesc}
                </div>
                {renderCompletionSettings(true)}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励金币</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={coinReward} onChange={e => setCoinReward(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励经验</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={xpReward} onChange={e => setXpReward(e.target.value)} />
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-blue-100 bg-blue-50 text-[10px] text-blue-800">
                  <div className="font-bold mb-1">{suggestedTaskReward.title}</div>
                  <div className="leading-relaxed">当前建议 {suggestedTaskReward.coins} 金币 / {suggestedTaskReward.xp} 经验。{suggestedTaskReward.basis}</div>
                  <div className="mt-1 leading-relaxed text-blue-700">{suggestedTaskReward.settlement}</div>
                  <button type="button" onClick={applySuggestedTaskReward} className="mt-2 px-2.5 py-1 rounded-md bg-blue-500 text-white font-bold">套用建议</button>
                </div>

                <div className="p-3 rounded-xl border bg-blue-50/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🚀</span>
                    <div>
                      <div className="text-xs font-bold text-gray-700">并行任务</div>
                      <div className="text-[10px] text-gray-400">开启后此任务可与其他任务同时运行</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsParallel(!isParallel)}
                    className={`w-10 h-5 rounded-full transition-all relative ${isParallel ? 'bg-blue-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${isParallel ? 'left-6' : 'left-1'}`}></div>
                  </button>
                </div>

                {/* 任务类型设置 */}
                <div className="p-2.5 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="text-xs font-bold text-gray-700 mb-2">🔄 任务类型</div>
                  <div className="flex gap-1.5 mb-2">
                    {[
                      { value: 'daily', label: '每日', icon: '🔁' },
                      { value: 'once', label: '单次', icon: '📌' },
                      { value: 'custom', label: '自定义', icon: '⚙️' },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => setTaskType(opt.value as any)}
                        className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${taskType === opt.value ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                  {taskType === 'custom' && (
                    <div className="flex gap-1">
                      {['日', '一', '二', '三', '四', '五', '六'].map((day, i) => (
                        <button key={i} type="button"
                          onClick={() => {
                            if (customDays.includes(i)) {
                              setCustomDays(customDays.filter(d => d !== i));
                            } else {
                              setCustomDays([...customDays, i].sort());
                            }
                          }}
                          className={`flex-1 py-1 rounded text-[10px] font-bold ${customDays.includes(i) ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 border'}`}>
                          {day}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
          )}
        </BottomSheet>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
