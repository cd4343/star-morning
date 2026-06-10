import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Lock, ClipboardList, Gift, Users, Crown, Trophy, X, Clock, Star, Bell, Calendar, Edit2, BarChart3, TrendingUp, TrendingDown, Minus, AlertTriangle, BookOpen, HeartPulse, Utensils, Brain, CheckCircle2, Compass } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { StatsPanel } from '../../components/StatsPanel';
import { ReviewCardSkeleton } from '../../components/Skeleton';
import { BottomSheet } from '../../components/BottomSheet';
import { InputModal } from '../../components/Modal';
import { getTaskCompletionSummary } from '../../utils/taskCompletion';

interface ReviewItem {
  id: string;
  title: string;
  childName: string;
  submittedAt: string;
  proof?: string;
  coinReward: number;
  xpReward: number;
  actualDuration?: number;
  expectedDuration?: number;
  autoCompleted?: number;
  autoCompleteReason?: string;
  category?: string;
  taskType?: string;
  completionMode?: string;
  targetValue?: number | string | null;
  targetUnit?: string | null;
  reviewFocus?: string | null;
}

// 评分维度配置
type ScoreKey = 'time' | 'quality' | 'initiative';
type ScoreOption = { label: string; value: number; emoji: string };
type ScoreDimension = {
  key: ScoreKey;
  title: string;
  icon: React.ReactNode;
  activeClass: string;
  options: ScoreOption[];
  hint?: string;
};

const TIME_OPTIONS = [
  { label: '提前完成', value: 20, emoji: '🚀' },
  { label: '按时完成', value: 0, emoji: '✅' },
  { label: '稍微超时', value: -10, emoji: '⏰' },
  { label: '严重超时', value: -20, emoji: '🐢' },
];

const QUALITY_OPTIONS = [
  { label: '非常认真', value: 30, emoji: '🌟' },
  { label: '认真完成', value: 10, emoji: '👍' },
  { label: '一般', value: 0, emoji: '😐' },
  { label: '敷衍了事', value: -30, emoji: '😞' },
];

const INITIATIVE_OPTIONS = [
  { label: '主动完成', value: 20, emoji: '💪' },
  { label: '无需提醒', value: 0, emoji: '👌' },
  { label: '提醒1次', value: -10, emoji: '📢' },
  { label: '提醒多次', value: -20, emoji: '🔔' },
];

const SPORT_PARTICIPATION_OPTIONS: ScoreOption[] = [
  { label: '完整参与', value: 10, emoji: '🏃' },
  { label: '基本参与', value: 0, emoji: '✅' },
  { label: '参与不足', value: -10, emoji: '⏱️' },
  { label: '中途放弃', value: -20, emoji: '🛑' },
];

const SPORT_ACTION_OPTIONS: ScoreOption[] = [
  { label: '动作安全', value: 20, emoji: '🛡️' },
  { label: '完成动作', value: 10, emoji: '💪' },
  { label: '一般完成', value: 0, emoji: '👌' },
  { label: '需要调整', value: -20, emoji: '⚠️' },
];

const SPORT_INITIATIVE_OPTIONS: ScoreOption[] = [
  { label: '主动开动', value: 20, emoji: '⚡' },
  { label: '提醒后做', value: 0, emoji: '📣' },
  { label: '多次提醒', value: -10, emoji: '🔔' },
  { label: '明显抗拒', value: -20, emoji: '⛔' },
];

const ACTIVITY_ENGAGEMENT_OPTIONS: ScoreOption[] = [
  { label: '投入参与', value: 10, emoji: '🎨' },
  { label: '正常参与', value: 0, emoji: '✅' },
  { label: '有点游离', value: -10, emoji: '💭' },
  { label: '难以参与', value: -20, emoji: '🧩' },
];

const ACTIVITY_RESULT_OPTIONS: ScoreOption[] = [
  { label: '过程认真', value: 20, emoji: '🌟' },
  { label: '完成约定', value: 10, emoji: '🎯' },
  { label: '基本完成', value: 0, emoji: '👌' },
  { label: '随便应付', value: -20, emoji: '📝' },
];

const ACTIVITY_COOPERATION_OPTIONS: ScoreOption[] = [
  { label: '主动合作', value: 20, emoji: '🤝' },
  { label: '正常配合', value: 0, emoji: '🙂' },
  { label: '提醒一次', value: -10, emoji: '📢' },
  { label: '多次提醒', value: -20, emoji: '🔔' },
];

const STUDY_PROCESS_OPTIONS: ScoreOption[] = [
  { label: '按步完成', value: 10, emoji: '🧭' },
  { label: '正常完成', value: 0, emoji: '✅' },
  { label: '有点跳步', value: -10, emoji: '📝' },
  { label: '明显卡住', value: -20, emoji: '🧩' },
];

const STUDY_PERSISTENCE_OPTIONS: ScoreOption[] = [
  { label: '主动求助', value: 20, emoji: '🙋' },
  { label: '坚持完成', value: 10, emoji: '💪' },
  { label: '提醒后做', value: 0, emoji: '📣' },
  { label: '抗拒明显', value: -20, emoji: '⛔' },
];

const LIFE_STABILITY_OPTIONS: ScoreOption[] = [
  { label: '稳定做到', value: 10, emoji: '🌱' },
  { label: '正常完成', value: 0, emoji: '✅' },
  { label: '拖延较多', value: -10, emoji: '⏱️' },
  { label: '关键缺失', value: -20, emoji: '⚠️' },
];

const LIFE_RESULT_OPTIONS: ScoreOption[] = [
  { label: '结果很好', value: 20, emoji: '✨' },
  { label: '结果可用', value: 10, emoji: '👌' },
  { label: '基本完成', value: 0, emoji: '✅' },
  { label: '需要返工', value: -20, emoji: '🔁' },
];

export default function ParentDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [taskSessionReminders, setTaskSessionReminders] = useState<any[]>([]);
  const [reviewTab, setReviewTab] = useState<'pending' | 'history'>('pending');
  const [weekTasks, setWeekTasks] = useState(0);

  // 审核历史日期选择
  const [historyDate, setHistoryDate] = useState<string>(''); // 空字符串表示最近7天
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');
  const [historyStatus, setHistoryStatus] = useState<'all' | 'approved' | 'rejected'>('all');
  const [historyCategory, setHistoryCategory] = useState('all');
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [datesWithRecords, setDatesWithRecords] = useState<{date: string, count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 审批弹窗状态
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [currentReview, setCurrentReview] = useState<ReviewItem | null>(null);
  const [timeScore, setTimeScore] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [initiativeScore, setInitiativeScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSuggestion, setReviewSuggestion] = useState<any>(null);
  const [showPunishmentStats, setShowPunishmentStats] = useState(false);
  const [punishmentStats, setPunishmentStats] = useState<any>(null);
  const [loadingPunishmentStats, setLoadingPunishmentStats] = useState(false);

  // 批量审核状态
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [batchApproving, setBatchApproving] = useState(false);

  // 惩罚相关状态
  const [enablePunishment, setEnablePunishment] = useState(false);
  const [punishmentLevel, setPunishmentLevel] = useState<'mild' | 'moderate' | 'severe' | 'custom'>('mild');
  const [punishmentCustomAmount, setPunishmentCustomAmount] = useState<number>(5);
  const [punishmentReason, setPunishmentReason] = useState('');
  const [punishmentSettings, setPunishmentSettings] = useState<any>(null);
  const [punishmentTips, setPunishmentTips] = useState<Record<string, string>>({});

  // 预设原因
  const PRESET_REASONS = ['磨蹭拖拉', '态度消极', '未达要求', '说谎欺骗', '屡教不改'];
  const HISTORY_CATEGORIES = ['all', '生活', '学习', '早晨启动', '运动', '活动', '情绪调节', '其他'];

  // 任务详情弹窗状态
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [taskDetail, setTaskDetail] = useState<any>(null);

  // 审批后再次调整（编辑奖励/惩罚）弹窗
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustEntryId, setAdjustEntryId] = useState<string | null>(null);
  const [adjustDetail, setAdjustDetail] = useState<any>(null);
  const [adjustFinalCoins, setAdjustFinalCoins] = useState(0);
  const [adjustPunishmentDeduction, setAdjustPunishmentDeduction] = useState(0);
  const [adjustPunishmentReason, setAdjustPunishmentReason] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  useEffect(() => {
    fetchDashboard();
    fetchPunishmentSettings();
    fetchPunishmentTips();
  }, []);

  const fetchPunishmentTips = async () => {
    try {
      const res = await api.get('/parent/punishment-tips');
      setPunishmentTips(res.data);
    } catch (err) {
      console.error('获取惩罚建议失败:', err);
    }
  };

  const fetchPunishmentSettings = async () => {
    try {
      const res = await api.get('/parent/punishment-settings');
      console.log('📋 惩罚设置加载:', res.data);
      setPunishmentSettings(res.data);
    } catch (err) {
      console.error('获取惩罚设置失败:', err);
      // 即使失败也设置为空对象，避免显示错误
      setPunishmentSettings({ enabled: false });
    }
  };

  const fetchPunishmentStats = async () => {
    setLoadingPunishmentStats(true);
    try {
      const res = await api.get('/parent/punishment-stats');
      setPunishmentStats(res.data);
    } catch (err) {
      console.error('获取惩罚统计失败:', err);
    } finally {
      setLoadingPunishmentStats(false);
    }
  };

  // 打开审核弹窗时，确保惩罚设置已加载
  const handleOpenReview = (review: ReviewItem) => {
    setCurrentReview(review);
    setShowReviewModal(true);
    // 如果惩罚设置未加载，重新加载
    if (!punishmentSettings) {
      fetchPunishmentSettings();
    }
  };

  // 打开「审批后再次调整」弹窗（从审核历史或详情进入）
  const openAdjustModal = async (entryId: string) => {
    setAdjustEntryId(entryId);
    setShowAdjustModal(true);
    setAdjustSubmitting(false);
    try {
      const res = await api.get(`/task-entries/${entryId}`);
      const d = res.data;
      setAdjustDetail(d);
      setAdjustFinalCoins(d.earnedCoins ?? d.coinReward ?? 0);
      const currentDeduction = d.punishment ? (d.punishment.deductedCoins ?? 0) : 0;
      setAdjustPunishmentDeduction(currentDeduction);
      setAdjustPunishmentReason(d.punishment?.reason ?? '');
    } catch (err) {
      console.error('获取任务详情失败:', err);
      toast.error('获取详情失败');
      setShowAdjustModal(false);
    }
  };

  const handleSaveAdjust = async () => {
    if (!adjustEntryId) return;
    try {
      setAdjustSubmitting(true);
      await api.put(`/parent/task-entries/${adjustEntryId}/adjust`, {
        finalCoins: adjustFinalCoins,
        punishmentDeduction: adjustPunishmentDeduction,
        punishmentReason: adjustPunishmentReason.trim() || undefined
      });
      toast.success('已调整');
      setShowAdjustModal(false);
      setAdjustEntryId(null);
      setAdjustDetail(null);
      fetchReviewHistory(historyDate);
      fetchDashboard();
      if (showDetailModal && taskDetail?.id === adjustEntryId) {
        const res = await api.get(`/task-entries/${adjustEntryId}`);
        setTaskDetail(res.data);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || '调整失败');
    } finally {
      setAdjustSubmitting(false);
    }
  };

  // 当切换到历史tab或日期改变时，获取历史记录
  useEffect(() => {
    if (reviewTab === 'history') {
      fetchReviewHistory(historyDate);
    }
  }, [reviewTab, historyDate, historyStartDate, historyEndDate, historyStatus, historyCategory]);

  const fetchReviewHistory = async (date: string) => {
    try {
      setLoadingHistory(true);
      const params: any = {};
      if (date) {
        params.date = date;
      } else {
        if (historyStartDate) params.startDate = historyStartDate;
        if (historyEndDate) params.endDate = historyEndDate;
      }
      if (historyStatus !== 'all') params.status = historyStatus;
      if (historyCategory !== 'all') params.category = historyCategory;
      const res = await api.get('/parent/review-history', { params });
      if (res?.data) {
        setHistoryRecords(res.data.records || []);
        setDatesWithRecords(res.data.datesWithRecords || []);
      }
    } catch (err) {
      console.error("Review history fetch error:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // 生成最近7天的日期数组
  const getRecentDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push({
        date: d.toISOString().split('T')[0],
        weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        day: d.getDate(),
        month: d.getMonth() + 1,
        isToday: i === 0
      });
    }
    return dates;
  };

  // 检查某日期是否有记录
  const getRecordCount = (date: string) => {
    const found = datesWithRecords.find(d => d.date === date);
    return found?.count || 0;
  };

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const [dashboardRes, remindersRes] = await Promise.allSettled([
        api.get('/parent/dashboard'),
        api.get('/parent/task-session-reminders'),
      ]);
      const res = dashboardRes.status === 'fulfilled' ? dashboardRes.value : null;
      if (res?.data) {
          setReviews(res.data.pendingReviews || []);
          if (res.data.stats) {
              setWeekTasks(res.data.weekTasks || 0);
          }
      }
      if (remindersRes.status === 'fulfilled') {
        setTaskSessionReminders(remindersRes.value.data || []);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  // 批量审核相关函数
  const dismissTaskSessionReminder = async (id: string) => {
    setTaskSessionReminders(prev => prev.filter(item => item.id !== id));
    try {
      await api.post(`/parent/task-session-reminders/${id}/read`);
    } catch (err) {
      console.error('Dismiss task session reminder failed:', err);
    }
  };

  const toggleReviewSelection = (id: string) => {
    setSelectedReviewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllReviews = () => {
    setSelectedReviewIds(new Set(reviews.map(r => r.id)));
  };

  const clearReviewSelection = () => {
    setSelectedReviewIds(new Set());
  };

  const handleBatchApprove = async () => {
    if (selectedReviewIds.size === 0) return;
    const confirmed = await confirm({
      title: '批量通过',
      message: `确定批量通过 ${selectedReviewIds.size} 个任务吗？将按基础奖励发放（不加评分、不惩罚）。`,
      type: 'info',
      confirmText: '确定批量通过',
    });
    if (!confirmed) return;

    setBatchApproving(true);
    try {
      // B3-7: 单次批量审核请求，减少网络开销
      const res = await api.post('/parent/task-entries/batch-review', {
        entryIds: Array.from(selectedReviewIds),
        action: 'approve',
      });
      const { approved, rejected, failed } = res.data;
      setSelectedReviewIds(new Set());
      fetchDashboard();

      if (failed === 0) {
        toast.success(`✅ 成功批量通过 ${approved} 个任务！`);
      } else {
        toast.warning(`通过 ${approved} 个，失败 ${failed} 个`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || '批量审核失败');
    } finally {
      setBatchApproving(false);
    }
  };

  const openReviewModal = async (review: ReviewItem) => {
    setCurrentReview(review);
    setTimeScore(0);
    setQualityScore(0);
    setInitiativeScore(0);
    setEnablePunishment(false);
    setPunishmentReason('');
    setPunishmentLevel('mild');
    setPunishmentCustomAmount(5);
    setReviewSuggestion(null);
    setShowReviewModal(true);
    // 确保惩罚设置已加载
    if (!punishmentSettings) {
      fetchPunishmentSettings();
    }
    // 获取智能审批建议
    try {
      const res = await api.get(`/parent/review/${review.id}/suggestion`);
      setReviewSuggestion(res.data);
    } catch (err) {
      console.error('获取审批建议失败:', err);
    }
  };

  const getPunishmentDeduction = (): number => {
    if (!enablePunishment || !punishmentSettings || !currentReview) return 0;
    const reward = currentReview.coinReward;
    let deduction = 0;
    if (punishmentLevel === 'mild') {
      deduction = Math.max(punishmentSettings.mildMin, Math.min(punishmentSettings.mildMax, Math.round(reward * punishmentSettings.mildRate)));
    } else if (punishmentLevel === 'moderate') {
      deduction = Math.max(punishmentSettings.moderateMin, Math.min(punishmentSettings.moderateMax, Math.round(reward * punishmentSettings.moderateRate)));
    } else if (punishmentLevel === 'severe') {
      deduction = Math.min(punishmentSettings.severeMax, Math.round(reward * punishmentSettings.severeRate) + punishmentSettings.severeExtra);
    } else {
      const min = punishmentSettings.customMin ?? 1;
      const max = punishmentSettings.customMax ?? 100;
      const amount = isNaN(punishmentCustomAmount) || punishmentCustomAmount < 0 ? min : punishmentCustomAmount;
      deduction = Math.max(min, Math.min(max, Math.round(amount)));
    }
    return deduction;
  };

  const calculateFinalCoins = () => {
    if (!currentReview) return 0;
    const baseCoins = currentReview.coinReward;
    const totalBonus = timeScore + qualityScore + initiativeScore;
    return Math.round(baseCoins * (100 + totalBonus) / 100);
  };

  const getScoreValue = (key: ScoreKey) => {
    if (key === 'time') return timeScore;
    if (key === 'quality') return qualityScore;
    return initiativeScore;
  };

  const setScoreValue = (key: ScoreKey, value: number) => {
    if (key === 'time') setTimeScore(value);
    else if (key === 'quality') setQualityScore(value);
    else setInitiativeScore(value);
  };

  const getReviewScoreDimensions = (): ScoreDimension[] => {
    const rawCategory = String(reviewSuggestion?.category || currentReview?.category || '');
    const category = ['劳动', '生活习惯', '日常', '家务'].includes(rawCategory) ? '生活' : rawCategory;
    const completionMode = String(reviewSuggestion?.completionMode || currentReview?.completionMode || 'timer');
    if (category === '运动') {
      return [
        { key: 'time' as ScoreKey, title: '参与完整度', icon: <HeartPulse size={16} className="text-emerald-500" />, activeClass: 'bg-emerald-500', options: SPORT_PARTICIPATION_OPTIONS, hint: '只看是否参与到位，不奖励“做得更快”。' },
        { key: 'quality' as ScoreKey, title: '动作与安全', icon: <Star size={16} className="text-yellow-500" />, activeClass: 'bg-yellow-500', options: SPORT_ACTION_OPTIONS, hint: '动作完成、安全和强度适配比速度更重要。' },
        { key: 'initiative' as ScoreKey, title: '运动主动性', icon: <Bell size={16} className="text-purple-500" />, activeClass: 'bg-purple-500', options: SPORT_INITIATIVE_OPTIONS, hint: '鼓励愿意开始和持续尝试。' },
      ];
    }
    if (category === '活动') {
      return [
        { key: 'time' as ScoreKey, title: '参与投入', icon: <HeartPulse size={16} className="text-cyan-500" />, activeClass: 'bg-cyan-500', options: ACTIVITY_ENGAGEMENT_OPTIONS, hint: '看孩子是否投入过程，不按效率快慢评分。' },
        { key: 'quality' as ScoreKey, title: '过程与成果', icon: <Star size={16} className="text-amber-500" />, activeClass: 'bg-amber-500', options: ACTIVITY_RESULT_OPTIONS, hint: '关注过程认真、约定成果和完成度。' },
        { key: 'initiative' as ScoreKey, title: '合作表达', icon: <Bell size={16} className="text-fuchsia-500" />, activeClass: 'bg-fuchsia-500', options: ACTIVITY_COOPERATION_OPTIONS, hint: '鼓励合作、表达和愿意尝试。' },
      ];
    }
    if (category === '学习') {
      return [
        { key: 'time' as ScoreKey, title: '学习过程', icon: <BookOpen size={16} className="text-indigo-500" />, activeClass: 'bg-indigo-500', options: STUDY_PROCESS_OPTIONS, hint: '学习不奖励“越快越好”，看是否按小步推进。' },
        { key: 'quality' as ScoreKey, title: '完成质量', icon: <Star size={16} className="text-yellow-500" />, activeClass: 'bg-yellow-500', options: QUALITY_OPTIONS, hint: '看认真程度、正确率和是否敷衍。' },
        { key: 'initiative' as ScoreKey, title: '求助与坚持', icon: <Bell size={16} className="text-purple-500" />, activeClass: 'bg-purple-500', options: STUDY_PERSISTENCE_OPTIONS, hint: '不会时能求助、愿意坚持，比速度更重要。' },
      ];
    }
    if (category === '生活') {
      return [
        { key: 'time' as ScoreKey, title: '生活稳定', icon: <CheckCircle2 size={16} className="text-emerald-500" />, activeClass: 'bg-emerald-500', options: LIFE_STABILITY_OPTIONS, hint: '生活类看稳定和关键动作，不因做得快加大奖励。' },
        { key: 'quality' as ScoreKey, title: '结果可用', icon: <Star size={16} className="text-yellow-500" />, activeClass: 'bg-yellow-500', options: LIFE_RESULT_OPTIONS, hint: '看整理、清洁或自理结果是否真的可用。' },
        { key: 'initiative' as ScoreKey, title: '独立程度', icon: <Bell size={16} className="text-purple-500" />, activeClass: 'bg-purple-500', options: INITIATIVE_OPTIONS, hint: '少提醒和逐步独立，比单次高额奖励更重要。' },
      ];
    }
    if (completionMode && completionMode !== 'timer') {
      return [
        {
          key: 'time' as ScoreKey,
          title: '目标完成度',
          icon: <CheckCircle2 size={16} className="text-emerald-500" />,
          activeClass: 'bg-emerald-500',
          options: [
            { label: '完全达成', value: 10, emoji: '✅' },
            { label: '基本达成', value: 0, emoji: '👍' },
            { label: '部分达成', value: -10, emoji: '⏳' },
            { label: '明显不足', value: -20, emoji: '⚠️' },
          ],
          hint: '按家长设置的目标量或清单确认，不奖励“做得更快”。',
        },
        { key: 'quality' as ScoreKey, title: '完成质量', icon: <Star size={16} className="text-yellow-500" />, activeClass: 'bg-yellow-500', options: QUALITY_OPTIONS, hint: '看结果是否可用、是否认真。' },
        { key: 'initiative' as ScoreKey, title: '主动性', icon: <Bell size={16} className="text-purple-500" />, activeClass: 'bg-purple-500', options: INITIATIVE_OPTIONS, hint: '看是否愿意开始，是否需要反复提醒。' },
      ];
    }
    return [
      { key: 'time' as ScoreKey, title: '完成时间', icon: <Clock size={16} className="text-blue-500" />, activeClass: 'bg-blue-500', options: TIME_OPTIONS },
      { key: 'quality' as ScoreKey, title: '完成质量', icon: <Star size={16} className="text-yellow-500" />, activeClass: 'bg-yellow-500', options: QUALITY_OPTIONS },
      { key: 'initiative' as ScoreKey, title: '主动性', icon: <Bell size={16} className="text-purple-500" />, activeClass: 'bg-purple-500', options: INITIATIVE_OPTIONS },
    ];
  };

  const renderScoreDimension = (dimension: ScoreDimension) => {
    const value = getScoreValue(dimension.key);
    return (
      <div key={dimension.key}>
        <div className="flex items-center gap-2 mb-2">
          {dimension.icon}
          <span className="font-bold text-sm">{dimension.title}</span>
          <span className={`ml-auto text-sm font-bold ${value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-500'}`}>
            {value > 0 ? `+${value}%` : `${value}%`}
          </span>
        </div>
        {dimension.hint && (
          <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 leading-relaxed">
            {dimension.hint}
          </div>
        )}
        <div className="grid grid-cols-4 gap-1">
          {dimension.options.map(opt => (
            <button
              key={`${dimension.key}-${opt.value}-${opt.label}`}
              type="button"
              onClick={() => setScoreValue(dimension.key, opt.value)}
              className={`py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                value === opt.value
                  ? `${dimension.activeClass} text-white shadow-lg`
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <div className="text-lg">{opt.emoji}</div>
              <div className="mt-1">{opt.label}</div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const handleApprove = async () => {
    if (!currentReview) return;
    if (submitting) return;

    // 如果启用惩罚但未填写原因
    if (enablePunishment && punishmentSettings?.requireReason && !punishmentReason.trim()) {
      toast.error('请填写惩罚原因');
      return;
    }

    try {
      setSubmitting(true);

      // 1. 先审核通过任务
      const res = await api.post(`/parent/review/${currentReview.id}`, {
        action: 'approve',
        timeScore,
        qualityScore,
        initiativeScore,
        finalCoins: calculateFinalCoins()
      });

      // 2. 如果启用了惩罚，执行惩罚
      let punishmentResult: any = null;
      if (enablePunishment) {
        try {
          const punishRes = await api.post(`/parent/task-entries/${currentReview.id}/punish`, {
            level: punishmentLevel,
            reason: punishmentReason,
            ...(punishmentLevel === 'custom' ? { customAmount: punishmentCustomAmount } : {})
          });
          punishmentResult = punishRes.data;
        } catch (punishErr: any) {
          console.error('执行惩罚失败:', punishErr);
          toast.error(punishErr.response?.data?.message || '执行惩罚失败');
        }
      }

      setShowReviewModal(false);

      // 重置惩罚状态
      const savedPunishmentReason = punishmentReason;
      const savedPunishmentDeduction = getPunishmentDeduction();
      setEnablePunishment(false);
      setPunishmentReason('');
      setPunishmentLevel('mild');
      setPunishmentCustomAmount(5);

      fetchDashboard();

      // 显示详细的奖励信息
      const {
        coinsAwarded,
        xpAwarded,
        rewardXpAwarded,
        privilegePointsAwarded,
        gameTicketMinutesAwarded,
        gameTicketAwardLabel,
        gameTicketMinutesRequested,
        gameTicketMinutesCapped,
        gameTicketGrant,
      } = res.data;
      let message = `✅ 审核通过！\n\n`;
      message += `💰 金币：${coinsAwarded}\n`;
      message += `⭐ 经验：${xpAwarded}\n`;
      message += `🎯 奖励经验：${rewardXpAwarded}`;
      if (privilegePointsAwarded > 0) {
        message += `\n👑 特权点：+${privilegePointsAwarded}（累计奖励经验达到 ${Math.floor((rewardXpAwarded || 0) / 100) * 100} 点）`;
      }
      if (gameTicketMinutesAwarded > 0) {
        message += `\n🎮 ${gameTicketAwardLabel || '游戏票'}：+${gameTicketMinutesAwarded} 分钟`;
      }
      if (gameTicketMinutesCapped > 0) {
        message += `\n🎮 今日游戏时间已到上限，${gameTicketMinutesCapped} 分钟游戏票未发放`;
      } else if (Number(gameTicketMinutesRequested || gameTicketGrant?.requestedMinutes || 0) > 0 && !gameTicketMinutesAwarded) {
        message += `\n🎮 本次符合游戏票规则，但没有可发放分钟`;
      }
      if (enablePunishment && savedPunishmentDeduction > 0) {
        message += `\n\n🚨 已执行惩罚\n`;
        message += `扣除金币：-${punishmentResult?.deducted ?? savedPunishmentDeduction}\n`;
        message += `惩罚原因：${savedPunishmentReason}`;
      }
      toast.success(message);
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.warning(err.response?.data?.message || '该任务已处理，请刷新后查看');
        setShowReviewModal(false);
        fetchDashboard();
      } else {
        toast.error(err.response?.data?.message || '操作失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // B3-3: 打回必须填写原因，孩子端会展示"哪里可以改进"
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  const handleReject = (entryId: string) => {
    setRejectTargetId(entryId);
  };

  const submitReject = async (reason: string) => {
    const entryId = rejectTargetId;
    setRejectTargetId(null);
    if (!entryId) return;
    try {
      await api.post(`/parent/review/${entryId}`, { action: 'reject', reason: reason.trim().slice(0, 200) });
      toast.success('已打回，孩子会看到你的说明');
      fetchDashboard();
    } catch (err: any) {
      toast.error(err.response?.data?.message || '操作失败');
    }
  };

  // 综合评分加成（不包含惩罚，惩罚是直接扣金币）
  const totalBonus = timeScore + qualityScore + initiativeScore;
  const currentCompletionSummary = currentReview ? getTaskCompletionSummary(currentReview) : null;

  const safePunishmentStats = punishmentStats || {};
  const punishmentTaskStats = Array.isArray(safePunishmentStats.taskStats) ? safePunishmentStats.taskStats : [];
  const punishmentHighRiskTasks = Array.isArray(safePunishmentStats.highRiskTasks) ? safePunishmentStats.highRiskTasks : [];
  const punishmentByChild = Array.isArray(safePunishmentStats.byChild) ? safePunishmentStats.byChild : [];
  const punishmentTopReasons = Array.isArray(safePunishmentStats.topReasons) ? safePunishmentStats.topReasons : [];

  return (
    <Layout>
      <Header
        title="家长模式"
        rightElem={<button onClick={() => navigate('/select-user')} className="text-xs font-bold text-blue-600">切换</button>}
      />

      <div className="p-4 space-y-6 overflow-y-auto flex-1 pb-10">
        {/* 成长数据统计面板 */}
        <StatsPanel />

        {taskSessionReminders.length > 0 && (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-black text-amber-700">跨天任务提醒</div>
                <div className="text-xs text-amber-600 mt-0.5">孩子开始后忘记结束的任务，已按常规时长进入待审核。</div>
              </div>
              <Bell size={18} className="text-amber-500" />
            </div>
            {taskSessionReminders.slice(0, 3).map(item => (
              <div key={item.id} className="rounded-xl bg-white border border-amber-100 p-3 flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-xl">
                  {item.icon || '⏰'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-black text-slate-800 truncate">{item.childName} · {item.title}</div>
                  <div className="text-xs text-slate-500 mt-1">系统按 {item.durationMinutes || 0} 分钟提交，等待家长确认。</div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissTaskSessionReminder(item.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-black"
                >
                  知道了
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 任务审核区域 */}
        <div>
          {/* Tab 切换 */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setReviewTab('pending')}
              className={`flex-1 py-2 px-3 rounded-lg font-bold text-sm flex items-center justify-center gap-1 transition-all ${
                reviewTab === 'pending'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Lock size={14}/> 待审核 ({reviews.length})
            </button>
            <button
              onClick={() => setReviewTab('history')}
              className={`flex-1 py-2 px-3 rounded-lg font-bold text-sm flex items-center justify-center gap-1 transition-all ${
                reviewTab === 'history'
                  ? 'bg-green-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Clock size={14}/> 审核历史 {historyRecords.length > 0 && `(${historyRecords.length})`}
            </button>
          </div>

          {/* 待审核列表 */}
          {reviewTab === 'pending' && (
            <>
              {loading && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <ReviewCardSkeleton key={i} />
                  ))}
                </div>
              )}
              {!loading && (
                <>
              {/* 批量操作栏 */}
              {reviews.length > 0 && (
                <div className="flex items-center justify-between mb-2 p-2 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectedReviewIds.size === reviews.length ? clearReviewSelection : selectAllReviews}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800"
                    >
                      {selectedReviewIds.size === reviews.length ? '取消全选' : '全选'} ({selectedReviewIds.size}/{reviews.length})
                    </button>
                  </div>
                  {selectedReviewIds.size > 0 && (
                    <button
                      onClick={handleBatchApprove}
                      disabled={batchApproving}
                      className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                    >
                      {batchApproving ? '处理中...' : `✅ 批量通过 (${selectedReviewIds.size})`}
                    </button>
                  )}
                </div>
              )}
              {reviews.length > 0 ? reviews.map(review => {
                const completionSummary = getTaskCompletionSummary(review);
                const formatDuration = (minutes?: number) => {
                  if (!minutes) return '未记录';
                  if (minutes < 60) return `${minutes}分钟`;
                  const hours = Math.floor(minutes / 60);
                  const mins = minutes % 60;
                  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
                };

                return (
                  <Card key={review.id} className={`border-red-100 bg-red-50/30 mb-2 ${selectedReviewIds.has(review.id) ? 'ring-2 ring-blue-400' : ''}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedReviewIds.has(review.id)}
                          onChange={() => toggleReviewSelection(review.id)}
                          className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold">{review.title}</h3>
                            {review.autoCompleted ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">系统按常规完成</span>
                            ) : null}
                          </div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                          <span>{review.childName}</span>
                          <span className="text-gray-300">|</span>
                          <span className="flex items-center gap-1">
                            <Clock size={12}/>
                            用时 {formatDuration(review.actualDuration)}
                            {review.expectedDuration && (
                              <span className={review.actualDuration && review.actualDuration <= review.expectedDuration ? 'text-green-600' : 'text-orange-500'}>
                                (预计{review.expectedDuration}分钟)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-blue-600 mt-1">
                          基础奖励: {review.coinReward} 💰 · {review.xpReward} ⭐
                        </div>
                        <div className="text-[11px] text-emerald-700 font-bold mt-1">
                          {completionSummary.label}：{completionSummary.targetText} · 看 {completionSummary.reviewFocus}
                        </div>
                        {review.autoCompleted ? (
                          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5 text-xs text-amber-700">
                            孩子已开始但跨天未手动结束，系统按常规时长提交，建议家长结合实际情况确认。
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => handleReject(review.id)} className="p-2 bg-red-100 text-red-600 rounded-lg font-bold text-xs">打回</button>
                        <button onClick={() => openReviewModal(review)} className="p-2 bg-green-500 text-white rounded-lg font-bold text-xs shadow-md">审核</button>
                      </div>
                    </div>
                  </Card>
                );
              }) : (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
                  暂无待审核任务，真棒！
                </div>
              )}
                </>
              )}
            </>
          )}

          {/* 审核历史列表 */}
          {reviewTab === 'history' && (
            <>
              {/* 日期选择器 */}
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={14} className="text-gray-500" />
                  <span className="text-xs text-gray-500">选择日期查看记录：</span>
                  <button
                    onClick={() => { setHistoryDate(''); setHistoryStartDate(''); setHistoryEndDate(''); }}
                    className={`text-xs px-2 py-1 rounded-lg transition-all ${
                      historyDate === '' && !historyStartDate && !historyEndDate
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    近7天
                  </button>
                </div>
                <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
                  {getRecentDates().map((d) => {
                    const count = getRecordCount(d.date);
                    const isSelected = historyDate === d.date;
                    return (
                      <button
                        key={d.date}
                        onClick={() => { setHistoryDate(d.date); setHistoryStartDate(''); setHistoryEndDate(''); }}
                        className={`flex-shrink-0 flex flex-col items-center py-2 px-3 rounded-lg transition-all min-w-[52px] ${
                          isSelected
                            ? 'bg-green-500 text-white shadow-md'
                            : count > 0
                              ? 'bg-green-50 text-gray-700 hover:bg-green-100 border border-green-200'
                              : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                        }`}
                      >
                        <span className="text-[10px] font-medium">
                          {d.isToday ? '今天' : `周${d.weekday}`}
                        </span>
                        <span className={`text-sm font-bold ${isSelected ? '' : count > 0 ? 'text-gray-800' : ''}`}>
                          {d.day}
                        </span>
                        {count > 0 && (
                          <span className={`text-[10px] ${isSelected ? 'text-green-100' : 'text-green-600'}`}>
                            {count}条
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-3 border shadow-sm mb-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">自定义日期范围</div>
                    {(historyStartDate || historyEndDate) && (
                      <button
                        type="button"
                        onClick={() => { setHistoryStartDate(''); setHistoryEndDate(''); }}
                        className="text-[10px] font-bold text-blue-500"
                      >
                        清除范围
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={historyStartDate}
                      onChange={e => { setHistoryDate(''); setHistoryStartDate(e.target.value); }}
                      className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                      aria-label="开始日期"
                    />
                    <input
                      type="date"
                      value={historyEndDate}
                      onChange={e => { setHistoryDate(''); setHistoryEndDate(e.target.value); }}
                      className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                      aria-label="结束日期"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">审核状态</div>
                  <div className="flex gap-1">
                    {[
                      { value: 'all', label: '全部' },
                      { value: 'approved', label: '已通过' },
                      { value: 'rejected', label: '已打回' },
                    ].map(option => (
                      <button
                        key={option.value}
                        onClick={() => setHistoryStatus(option.value as 'all' | 'approved' | 'rejected')}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${
                          historyStatus === option.value ? 'bg-green-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">任务类型</div>
                  <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                    {HISTORY_CATEGORIES.map(category => (
                      <button
                        key={category}
                        onClick={() => setHistoryCategory(category)}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                          historyCategory === category ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {category === 'all' ? '全部类型' : category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 历史记录列表 */}
              {loadingHistory ? (
                <div className="text-center py-8 text-gray-400">
                  加载中...
                </div>
              ) : historyRecords.length > 0 ? historyRecords.map((item: any) => (
                <Card
                  key={item.id}
                  className={`mb-2 cursor-pointer hover:shadow-md transition-all ${item.status === 'approved' ? 'border-green-100 bg-green-50/30' : 'border-orange-100 bg-orange-50/30'}`}
                  onClick={async () => {
                    try {
                      const res = await api.get(`/task-entries/${item.id}`);
                      setTaskDetail(res.data);
                      setShowDetailModal(true);
                    } catch (err) {
                      console.error('获取任务详情失败:', err);
                    }
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold flex items-center gap-2">
                        {item.title}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          item.status === 'approved' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'
                        }`}>
                          {item.status === 'approved' ? '✓ 已通过' : '↩ 已打回'}
                        </span>
                      </h3>
                      <div className="text-xs text-gray-500 mt-1">
                        {item.childName} · {new Date(item.submittedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {item.status === 'approved' && (
                        <div className="text-xs text-green-600 mt-1">
                          奖励: {item.earnedCoins} 💰 · {item.earnedXp} ⭐
                          {item.punishmentDeduction > 0 && (
                            <span className="text-red-600 ml-2">
                              惩罚: -{item.punishmentDeduction} 💰
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {item.status === 'approved' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openAdjustModal(item.id); }}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="编辑奖励/惩罚"
                      >
                        <Edit2 size={18}/>
                      </button>
                    )}
                  </div>
                </Card>
              )) : (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
                  {historyDate ? `${historyDate} 没有审核记录` : '最近7天没有审核记录'}
                </div>
              )}
            </>
          )}
        </div>

        {/* 首次使用引导 */}
        {weekTasks === 0 && reviews.length === 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="font-bold text-xl text-gray-800 mb-2">欢迎使用星辰早晨！</h3>
              <p className="text-gray-600 text-sm mb-4">
                还没有任务？快来为孩子设置第一个任务吧！
              </p>
              <div className="space-y-3 text-left bg-white/60 rounded-xl p-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <span>点击下方「任务管理」添加任务</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <span>设置「心愿商店」让孩子兑换奖励</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <span>切换到孩子账号开始使用</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 管理入口 */}
        <div className="grid grid-cols-2 gap-3 pt-4">
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2 relative" onClick={() => navigate('/parent/tasks')}>
            <ClipboardList size={28} className="text-blue-600"/>
            <span>任务管理</span>
            {weekTasks === 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">去添加</span>
            )}
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/learning')}>
            <BookOpen size={28} className="text-indigo-600"/>
            <span>学习闯关</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/wellbeing')}>
            <HeartPulse size={28} className="text-emerald-600"/>
            <span>情绪/游戏票</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/morning')}>
            <Utensils size={28} className="text-amber-600"/>
            <span>早餐小厨房</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/rules-insights')}>
            <Brain size={28} className="text-blue-600"/>
            <span>规则/洞察</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/explore')}>
            <Compass size={28} className="text-teal-600"/>
            <span>家庭探索</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/wishes')}>
            <Gift size={28} className="text-pink-600"/>
            <span>心愿管理</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/family')}>
            <Users size={28} className="text-green-600"/>
            <span>家庭管理</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/privileges')}>
            <Crown size={28} className="text-purple-600"/>
            <span>特权设置</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/achievements')}>
            <Trophy size={28} className="text-yellow-600"/>
            <span>成就管理</span>
          </Button>
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2" onClick={() => navigate('/parent/punishment')}>
            <Lock size={28} className="text-orange-600"/>
            <span>惩罚设置</span>
          </Button>
        </div>
      </div>

      {/* 审批弹窗 - 支持安全区域 */}
      {showReviewModal && currentReview && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-t-[2rem] shadow-2xl w-full max-w-md flex flex-col min-h-0" style={{ maxHeight: 'calc(100% - 24px)' }}>
            {/* Header */}
            <div className="flex-shrink-0 flex justify-between items-center p-4 border-b bg-white rounded-t-[2rem]">
              <h3 className="font-bold text-lg">任务审批</h3>
              <button onClick={() => setShowReviewModal(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-5 pb-6">
              {/* 任务信息 */}
              <div className="bg-gray-50 p-4 rounded-xl">
                <h4 className="font-bold text-lg text-gray-800">{currentReview.title}</h4>
                <div className="text-sm text-gray-500 mt-1">{currentReview.childName} 提交</div>
                <div className="flex gap-4 mt-3">
                  <div className="text-center">
                    <div className="text-2xl font-black text-yellow-600">{currentReview.coinReward}</div>
                    <div className="text-xs text-gray-500">基础金币</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-black text-blue-600">{currentReview.xpReward}</div>
                    <div className="text-xs text-gray-500">经验值</div>
                  </div>
                </div>
                {currentReview.actualDuration !== undefined && currentReview.expectedDuration !== undefined && (
                  <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between text-sm">
                    <span className="text-gray-500">用时: <span className="font-bold text-gray-700">{currentReview.actualDuration}分钟</span> / 预计{currentReview.expectedDuration}分钟</span>
                    <span className={`font-bold ${(currentReview.actualDuration/currentReview.expectedDuration) >= 0.8 ? 'text-green-600' : 'text-orange-500'}`}>
                      完成率 {Math.round((currentReview.actualDuration/currentReview.expectedDuration)*100)}%
                    </span>
                  </div>
                )}
                {currentCompletionSummary && (
                  <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs font-bold text-emerald-700 leading-relaxed">
                    完成方式：{currentCompletionSummary.label}（{currentCompletionSummary.targetText}）。审核重点：{currentCompletionSummary.reviewFocus}
                  </div>
                )}
              </div>

              {/* 智能建议卡片 */}
              {reviewSuggestion && (
                <div className={`p-4 rounded-xl border-2 ${
                  reviewSuggestion.rating === '卓越' ? 'bg-yellow-50 border-yellow-300' :
                  reviewSuggestion.rating === '优秀' ? 'bg-green-50 border-green-300' :
                  reviewSuggestion.rating === '良好' ? 'bg-blue-50 border-blue-300' :
                  reviewSuggestion.rating === '一般' ? 'bg-orange-50 border-orange-300' :
                  'bg-red-50 border-red-300'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-gray-700">💡 系统建议</span>
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                      reviewSuggestion.rating === '卓越' ? 'bg-yellow-200 text-yellow-800' :
                      reviewSuggestion.rating === '优秀' ? 'bg-green-200 text-green-800' :
                      reviewSuggestion.rating === '良好' ? 'bg-blue-200 text-blue-800' :
                      reviewSuggestion.rating === '一般' ? 'bg-orange-200 text-orange-800' :
                      'bg-red-200 text-red-800'
                    }`}>
                      {reviewSuggestion.rating}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mb-2">
                    <div className="text-center">
                      <div className="text-xl font-black text-yellow-600">{reviewSuggestion.suggestedCoins}</div>
                      <div className="text-xs text-gray-500">建议金币</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-black text-blue-600">{reviewSuggestion.completionRate}%</div>
                      <div className="text-xs text-gray-500">完成率</div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">{reviewSuggestion.message}</p>
                  {Array.isArray(reviewSuggestion.reasons) && reviewSuggestion.reasons.length > 0 && (
                    <div className="mt-2 rounded-xl bg-white/70 border border-white p-2 space-y-1">
                      {reviewSuggestion.reasons.slice(0, 3).map((reason: string, index: number) => (
                        <div key={index} className="text-xs font-bold text-gray-500 leading-relaxed">• {reason}</div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (reviewSuggestion.scores) {
                        setTimeScore(Number(reviewSuggestion.scores.timeScore || 0));
                        setQualityScore(Number(reviewSuggestion.scores.qualityScore || 0));
                        setInitiativeScore(Number(reviewSuggestion.scores.initiativeScore || 0));
                        return;
                      }
                      const targetBonus = currentReview.coinReward > 0
                        ? Math.round((reviewSuggestion.suggestedCoins / currentReview.coinReward - 1) * 100)
                        : 0;
                      setQualityScore(Math.max(-30, Math.min(30, targetBonus)));
                    }}
                    className="mt-2 w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50"
                  >
                    一键应用建议
                  </button>
                </div>
              )}

              {/* 评分维度 */}
              <div className="space-y-4">
                {getReviewScoreDimensions().map(renderScoreDimension)}

                {/* 惩罚选项 - 移到评分区域内 */}
                {punishmentSettings?.enabled && (
                  <div className="border-2 border-orange-300 rounded-xl p-4 bg-orange-50">
                    <label className="flex items-center gap-2 mb-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enablePunishment}
                        onChange={(e) => setEnablePunishment(e.target.checked)}
                        className="w-5 h-5 cursor-pointer"
                      />
                      <span className="font-bold text-orange-800">🚨 执行惩罚</span>
                    </label>

                    {enablePunishment && (
                      <div className="space-y-3 animate-fadeIn">
                        {/* 惩罚等级选择 */}
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">惩罚等级</label>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <button
                              type="button"
                              onClick={() => setPunishmentLevel('mild')}
                              className={`py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                                punishmentLevel === 'mild'
                                  ? 'bg-yellow-500 text-white shadow-lg'
                                  : 'bg-white text-gray-600 border border-gray-300'
                              }`}
                            >
                              🟡 {punishmentSettings.mildName}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPunishmentLevel('moderate')}
                              className={`py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                                punishmentLevel === 'moderate'
                                  ? 'bg-orange-500 text-white shadow-lg'
                                  : 'bg-white text-gray-600 border border-gray-300'
                              }`}
                            >
                              🟠 {punishmentSettings.moderateName}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPunishmentLevel('severe')}
                              className={`py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                                punishmentLevel === 'severe'
                                  ? 'bg-red-500 text-white shadow-lg'
                                  : 'bg-white text-gray-600 border border-gray-300'
                              }`}
                            >
                              🔴 {punishmentSettings.severeName}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPunishmentLevel('custom')}
                              className={`py-2 px-3 rounded-lg text-sm font-bold transition-all ${
                                punishmentLevel === 'custom'
                                  ? 'bg-purple-500 text-white shadow-lg'
                                  : 'bg-white text-gray-600 border border-gray-300'
                              }`}
                            >
                              🟣 {punishmentSettings.customName ?? '自定义'}
                            </button>
                          </div>
                          {punishmentLevel === 'custom' && (
                            <div className="mt-3">
                              <label className="block text-sm font-bold text-gray-700 mb-1">扣除金币数</label>
                              <input
                                type="number"
                                min={punishmentSettings.customMin ?? 1}
                                max={punishmentSettings.customMax ?? 100}
                                value={punishmentCustomAmount}
                                onChange={(e) => setPunishmentCustomAmount(Math.max(0, Math.min(punishmentSettings.customMax ?? 100, parseInt(e.target.value) || 0)))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                              <p className="text-xs text-gray-500 mt-1">范围：{punishmentSettings.customMin ?? 1}～{punishmentSettings.customMax ?? 100} 金币</p>
                            </div>
                          )}
                        </div>

                        {/* 惩罚建议提示 */}
                        {punishmentTips[punishmentLevel] && (
                          <div className="bg-white/60 p-3 rounded-lg border border-orange-200 text-xs text-orange-800 leading-relaxed italic">
                            💡 {punishmentTips[punishmentLevel]}
                          </div>
                        )}

                        {/* 常用原因选择 */}
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">快速选择原因</label>
                          <div className="flex flex-wrap gap-2">
                            {PRESET_REASONS.map(r => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setPunishmentReason(r)}
                                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                                  punishmentReason === r
                                    ? 'bg-orange-600 text-white shadow-sm'
                                    : 'bg-white text-gray-500 border border-gray-200 hover:border-orange-300'
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 惩罚原因输入 */}
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">
                            惩罚原因 {punishmentSettings.requireReason && <span className="text-red-500">*</span>}
                          </label>
                          <textarea
                            value={punishmentReason}
                            onChange={(e) => setPunishmentReason(e.target.value)}
                            placeholder="请填写惩罚原因，让孩子明白为什么被扣金币..."
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 最终结算 */}
              <div className={`p-4 rounded-xl ${totalBonus >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-gray-600">综合评分加成</div>
                    <div className={`text-2xl font-black ${totalBonus >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {totalBonus > 0 ? `+${totalBonus}%` : `${totalBonus}%`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-600">最终奖励</div>
                    <div className="text-3xl font-black text-yellow-600">
                      {calculateFinalCoins()} 💰
                    </div>
                    {enablePunishment && (
                      <div className="mt-1 text-xs font-bold text-red-600">
                        另扣惩罚 {getPunishmentDeduction()} 金币
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  {enablePunishment ? (
                    <>
                      奖励公式：{currentReview.coinReward} × (100% + {totalBonus}%) = {calculateFinalCoins()} 金币；惩罚会单独记录并扣除 {getPunishmentDeduction()} 金币
                    </>
                  ) : (
                    <>
                      计算公式：{currentReview.coinReward} × (100% + {totalBonus}%) = {calculateFinalCoins()} 金币
                    </>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="flex-1 py-3 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting || (enablePunishment && punishmentSettings?.requireReason && !punishmentReason.trim())}
                  className="flex-1 py-3 bg-green-500 font-bold text-white rounded-xl shadow-lg shadow-green-200 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? '处理中...' : '确认通过'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BottomSheet
        isOpen={showPunishmentStats}
        onClose={() => setShowPunishmentStats(false)}
        title="📊 惩罚分析仪表盘"
        className="max-w-lg"
        footer={
          <Button
            variant="ghost"
            onClick={() => setShowPunishmentStats(false)}
            className="w-full py-3 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200"
          >
            关闭
          </Button>
        }
      >
            <div className="space-y-3 text-slate-700">
              {loadingPunishmentStats ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3 animate-pulse">📊</div>
                  <div className="text-gray-500">数据加载中...</div>
                </div>
              ) : !punishmentStats ? (
                <div className="text-center py-12 text-gray-500">暂无数据</div>
              ) : (
                <>
                  {/* 概览数据卡片 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-3 rounded-xl text-center border">
                      <div className="text-2xl font-black text-gray-800">{punishmentStats.totalCount || 0}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">总惩罚次数</div>
                    </div>
                    <div className="bg-gradient-to-br from-orange-50 to-red-50 p-3 rounded-xl text-center border border-orange-100">
                      <div className="text-2xl font-black text-orange-600">{punishmentStats.weekCount || 0}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">本周次数</div>
                    </div>
                    {/* 趋势卡片 */}
                    <div className={`p-3 rounded-xl text-center border ${
                      punishmentStats.trend === '下降' ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-100'
                      : punishmentStats.trend === '上升' ? 'bg-gradient-to-br from-red-50 to-rose-50 border-red-100'
                      : 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-100'
                    }`}>
                      <div className="flex justify-center mb-0.5">
                        {punishmentStats.trend === '下降'
                          ? <TrendingDown size={22} className="text-green-600" />
                          : punishmentStats.trend === '上升'
                          ? <TrendingUp size={22} className="text-red-600" />
                          : <Minus size={22} className="text-gray-600" />}
                      </div>
                      <div className={`text-xs font-black ${
                        punishmentStats.trend === '下降' ? 'text-green-600'
                        : punishmentStats.trend === '上升' ? 'text-red-600'
                        : 'text-gray-600'
                      }`}>
                        {punishmentStats.trend}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        上周{punishmentStats.prevWeekCount || 0}次
                      </div>
                    </div>
                  </div>

                  {/* 本周 vs 上周 同比进度条 */}
                  {(punishmentStats.weekCount > 0 || punishmentStats.prevWeekCount > 0) && (
                    <div className="bg-gray-50 rounded-xl p-3 border">
                      <div className="text-xs font-bold text-gray-600 mb-2">📅 本周 vs 上周 对比</div>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">本周</span>
                            <span className="font-bold text-orange-600">{punishmentStats.weekCount} 次</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min((punishmentStats.weekCount / Math.max(punishmentStats.weekCount, punishmentStats.prevWeekCount, 1)) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-500">上周</span>
                            <span className="font-bold text-gray-500">{punishmentStats.prevWeekCount} 次</span>
                          </div>
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-gray-300 to-gray-400 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min((punishmentStats.prevWeekCount / Math.max(punishmentStats.weekCount, punishmentStats.prevWeekCount, 1)) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      {punishmentStats.weekCount < punishmentStats.prevWeekCount && (
                        <div className="mt-2 text-xs text-green-600 font-bold">🎉 比上周减少了 {punishmentStats.prevWeekCount - punishmentStats.weekCount} 次，孩子有进步！</div>
                      )}
                      {punishmentStats.weekCount > punishmentStats.prevWeekCount && (
                        <div className="mt-2 text-xs text-red-600 font-bold">⚠️ 比上周增加了 {punishmentStats.weekCount - punishmentStats.prevWeekCount} 次，需要关注</div>
                      )}
                    </div>
                  )}

                  {/* 高风险任务警告 */}
                  {punishmentHighRiskTasks.length > 0 && (
                    <div className="bg-red-50 border-2 border-red-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={16} className="text-red-600" />
                        <h4 className="font-bold text-red-700 text-sm">高风险任务（惩罚率 &gt;40%）</h4>
                      </div>
                      {punishmentHighRiskTasks.map((task: any) => (
                        <div key={task.taskId} className="mb-2 last:mb-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-bold text-gray-700">{task.title}</span>
                            <span className="text-sm text-red-600 font-black">{task.punishmentRate}%</span>
                          </div>
                          <div className="h-2 bg-red-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-orange-500 to-red-600 rounded-full"
                              style={{ width: `${Math.min(task.punishmentRate, 100)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-red-400 mt-0.5">提交{task.totalSubmissions}次，惩罚{task.punishmentCount}次</div>
                        </div>
                      ))}
                      <div className="mt-2 p-2 bg-red-100 rounded-lg">
                        <p className="text-xs text-red-700">💡 建议：考虑降低这些任务的难度，或与孩子沟通解决方案</p>
                      </div>
                    </div>
                  )}

                  {/* 任务惩罚率排行 */}
                  {punishmentTaskStats.length > 0 && (
                    <details className="rounded-xl border bg-white p-3" open={punishmentHighRiskTasks.length === 0}>
                      <summary className="cursor-pointer list-none font-bold text-gray-700 text-sm flex items-center justify-between">
                        <span>📋 任务惩罚率排行 TOP 5</span>
                        <span className="text-[10px] text-gray-400">展开/收起</span>
                      </summary>
                      <div className="space-y-2">
                        {[...punishmentTaskStats]
                          .sort((a: any, b: any) => b.punishmentRate - a.punishmentRate)
                          .slice(0, 5)
                          .map((task: any, idx: number) => (
                            <div key={task.taskId} className="bg-gray-50 p-3 rounded-xl border">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`w-5 h-5 rounded-full text-xs font-black flex items-center justify-center text-white ${
                                    idx === 0 ? 'bg-red-500' : idx === 1 ? 'bg-orange-500' : 'bg-gray-400'
                                  }`}>{idx + 1}</span>
                                  <span className="text-sm font-bold text-gray-700">{task.title}</span>
                                </div>
                                <span className={`text-sm font-black ${
                                  task.punishmentRate > 40 ? 'text-red-600'
                                  : task.punishmentRate > 20 ? 'text-orange-600'
                                  : 'text-gray-600'
                                }`}>{task.punishmentRate}%</span>
                              </div>
                              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    task.punishmentRate > 40 ? 'bg-gradient-to-r from-orange-500 to-red-600'
                                    : task.punishmentRate > 20 ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                                    : 'bg-gradient-to-r from-green-400 to-teal-500'
                                  }`}
                                  style={{ width: `${Math.min(task.punishmentRate, 100)}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-gray-400 mt-1">提交{task.totalSubmissions}次 · 惩罚{task.punishmentCount}次 · 平均扣{task.avgDeduction}金币</div>
                            </div>
                          ))}
                      </div>
                    </details>
                  )}

                  {/* 孩子惩罚统计 */}
                  {punishmentByChild.length > 0 && (
                    <details className="rounded-xl border bg-white p-3">
                      <summary className="cursor-pointer list-none font-bold text-gray-700 text-sm flex items-center justify-between">
                        <span>👤 孩子惩罚统计</span>
                        <span className="text-[10px] text-gray-400">展开/收起</span>
                      </summary>
                      <div className="space-y-2">
                        {punishmentByChild.map((child: any) => (
                          <div key={child.childId} className="bg-gray-50 p-3 rounded-xl border">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-sm">{child.childName}</span>
                              <div className="flex items-center gap-2">
                                {child.weekCount < child.prevWeekCount ? (
                                  <span className="text-xs text-green-600 font-bold flex items-center gap-0.5">
                                    <TrendingDown size={12} /> 好转
                                  </span>
                                ) : child.weekCount > child.prevWeekCount ? (
                                  <span className="text-xs text-red-600 font-bold flex items-center gap-0.5">
                                    <TrendingUp size={12} /> 注意
                                  </span>
                                ) : null}
                                <span className="text-sm text-orange-600 font-black">{child.count}次</span>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 flex gap-3">
                              <span>本周 <strong>{child.weekCount}</strong> 次</span>
                              <span>上周 <strong>{child.prevWeekCount}</strong> 次</span>
                              <span>累计扣 <strong className="text-red-600">{child.totalDeducted}</strong> 金币</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* 常见原因 */}
                  {punishmentTopReasons.length > 0 && (
                    <details className="rounded-xl border bg-white p-3">
                      <summary className="cursor-pointer list-none font-bold text-gray-700 text-sm flex items-center justify-between">
                        <span>📌 常见惩罚原因 TOP 5</span>
                        <span className="text-[10px] text-gray-400">展开/收起</span>
                      </summary>
                      <div className="space-y-1.5">
                        {punishmentTopReasons.map((reason: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-lg border">
                            <span className={`w-5 h-5 rounded-full text-xs font-black flex items-center justify-center text-white flex-shrink-0 ${
                              idx === 0 ? 'bg-orange-500' : idx === 1 ? 'bg-amber-500' : 'bg-gray-400'
                            }`}>{idx + 1}</span>
                            <span className="text-sm flex-1 truncate text-gray-700">{reason.reason}</span>
                            <span className="text-sm font-bold text-gray-600 flex-shrink-0">{reason.count}次</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* 全部正常提示 */}
                  {punishmentStats.totalCount === 0 && (
                    <div className="text-center py-8 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-2 border-green-200">
                      <div className="text-5xl mb-3">🏆</div>
                      <div className="font-bold text-green-700 text-lg">太棒了！</div>
                      <div className="text-sm text-green-600">孩子还没有任何惩罚记录，继续保持！</div>
                    </div>
                  )}
                </>
              )}
            </div>

      </BottomSheet>

      <BottomSheet
        isOpen={showDetailModal && Boolean(taskDetail)}
        onClose={() => setShowDetailModal(false)}
        title="审批详情"
        className="max-w-lg"
        footer={
          taskDetail?.status === 'approved' ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => { openAdjustModal(taskDetail.id); setShowDetailModal(false); }}
                className="py-3 bg-blue-500 border-none"
              >
                编辑奖励/惩罚
              </Button>
              <Button variant="ghost" onClick={() => setShowDetailModal(false)} className="py-3 bg-gray-100">
                关闭
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setShowDetailModal(false)} className="w-full py-3 bg-gray-100">
              关闭
            </Button>
          )
        }
      >
        {taskDetail && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-2xl">
              <h4 className="font-black text-lg text-gray-900">{taskDetail.title}</h4>
              <div className="text-sm text-gray-500 mt-1">{taskDetail.childName} 提交</div>
              <div className="text-xs text-gray-400 mt-2">
                提交时间：{new Date(taskDetail.submittedAt).toLocaleString('zh-CN')}
              </div>
              {taskDetail.reviewedAt && (
                <div className="text-xs text-gray-400 mt-1">
                  审核时间：{new Date(taskDetail.reviewedAt).toLocaleString('zh-CN')}
                </div>
              )}
            </div>

            <div className="bg-green-50 p-4 rounded-2xl border border-green-200">
              <div className="text-sm font-black text-gray-700 mb-3">奖励信息</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center bg-white/80 rounded-2xl p-3">
                  <div className="text-2xl font-black text-yellow-600">{taskDetail.earnedCoins || taskDetail.coinReward}</div>
                  <div className="text-xs text-gray-500">金币</div>
                </div>
                <div className="text-center bg-white/80 rounded-2xl p-3">
                  <div className="text-2xl font-black text-blue-600">{taskDetail.earnedXp || taskDetail.xpReward}</div>
                  <div className="text-xs text-gray-500">经验</div>
                </div>
              </div>
              {taskDetail.actualDurationMinutes && (
                <div className="text-xs text-gray-600 mt-2">
                  实际用时：{taskDetail.actualDurationMinutes} 分钟
                </div>
              )}
            </div>

            {taskDetail.punishment && (
              <div className="bg-red-50 p-4 rounded-2xl border border-red-200">
                <div className="text-sm font-black text-red-700 mb-2">复盘与扣除</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">惩罚等级：</span>
                    <span className="text-sm font-bold text-red-600">
                      {taskDetail.punishment.level === 'mild' ? '🟡 轻度警告' :
                        taskDetail.punishment.level === 'moderate' ? '🟠 中度惩罚' :
                          taskDetail.punishment.level === 'custom' ? '🟣 自定义扣除' :
                            '🔴 严重惩罚'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">扣除金币：</span>
                    <span className="text-lg font-black text-red-600">-{taskDetail.punishment.deductedCoins} 💰</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600">原因：</span>
                    <div className="text-sm text-gray-700 mt-1 bg-white p-2 rounded-xl border border-red-100">
                      {taskDetail.punishment.reason}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    执行人：{taskDetail.punishment.parentName} · {new Date(taskDetail.punishment.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            )}

            {taskDetail.proof && (
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-200">
                <div className="text-sm font-black text-gray-700 mb-2">提交证明</div>
                {String(taskDetail.proof).startsWith('data:image') ? (
                  <img src={taskDetail.proof} alt="完成证明" className="w-full rounded-lg max-h-64 object-contain bg-white" />
                ) : (
                  <div className="text-sm text-gray-600 whitespace-pre-wrap">{taskDetail.proof}</div>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={showAdjustModal && Boolean(adjustDetail)}
        onClose={() => setShowAdjustModal(false)}
        title="调整奖励/惩罚"
        className="max-w-lg"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setShowAdjustModal(false)} className="py-3 bg-gray-100">
              取消
            </Button>
            <Button onClick={handleSaveAdjust} loading={adjustSubmitting} className="py-3 bg-green-500 border-none">
              保存
            </Button>
          </div>
        }
      >
        {adjustDetail && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-2xl">
              <h4 className="font-black text-gray-800">{adjustDetail.title}</h4>
              <div className="text-xs text-gray-500 mt-1">{adjustDetail.childName}</div>
            </div>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">最终金币</label>
              <input
                type="number"
                value={adjustFinalCoins}
                onChange={(e) => setAdjustFinalCoins(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-gray-50"
              />
            </div>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">惩罚扣除（0 表示不惩罚）</label>
              <input
                type="number"
                min={0}
                value={adjustPunishmentDeduction}
                onChange={(e) => setAdjustPunishmentDeduction(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-gray-50"
              />
            </div>
            {adjustPunishmentDeduction > 0 && (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-1">惩罚原因（选填）</label>
                <textarea
                  value={adjustPunishmentReason}
                  onChange={(e) => setAdjustPunishmentReason(e.target.value)}
                  placeholder="家长调整"
                  className="w-full px-3 py-2 border border-gray-300 rounded-xl bg-gray-50 resize-none"
                  rows={3}
                />
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      <ConfirmDialog />

      <InputModal
        isOpen={rejectTargetId !== null}
        onClose={() => setRejectTargetId(null)}
        onConfirm={submitReject}
        title="打回任务：告诉孩子哪里可以改进"
        placeholder="例如：床铺还没有整理好，再试一次吧"
      />
    </Layout>
  );
}
