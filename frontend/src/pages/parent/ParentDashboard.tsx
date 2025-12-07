import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Lock, ClipboardList, Gift, Users, Crown, Trophy, X, Clock, Star, Bell } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';

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
}

// 评分维度配置
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

export default function ParentDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState({ 
    weekTasks: 0, 
    weekCompleted: 0,
    completionRate: '0%', 
    punctualRate: '100%',
    totalCoinsEarned: 0
  });
  
  // 审批弹窗状态
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [currentReview, setCurrentReview] = useState<ReviewItem | null>(null);
  const [timeScore, setTimeScore] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [initiativeScore, setInitiativeScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await api.get('/parent/dashboard');
      if (res.data) {
          setReviews(res.data.pendingReviews || []);
          if (res.data.stats) {
              setStats(res.data.stats);
          }
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    }
  };

  const openReviewModal = (review: ReviewItem) => {
    setCurrentReview(review);
    setTimeScore(0);
    setQualityScore(0);
    setInitiativeScore(0);
    setShowReviewModal(true);
  };

  const calculateFinalCoins = () => {
    if (!currentReview) return 0;
    const baseCoins = currentReview.coinReward;
    const totalBonus = timeScore + qualityScore + initiativeScore;
    const finalCoins = Math.round(baseCoins * (100 + totalBonus) / 100);
    return Math.max(0, finalCoins); // 不能为负数
  };

  const handleApprove = async () => {
    if (!currentReview) return;
    try {
      setSubmitting(true);
      const res = await api.post(`/parent/review/${currentReview.id}`, { 
        action: 'approve',
        timeScore,
        qualityScore,
        initiativeScore,
        finalCoins: calculateFinalCoins()
      });
      setShowReviewModal(false);
      fetchDashboard();
      
      // 显示详细的奖励信息
      const { coinsAwarded, xpAwarded, rewardXpAwarded, privilegePointsAwarded } = res.data;
      let message = `✅ 审核通过！\n\n`;
      message += `💰 金币：${coinsAwarded}\n`;
      message += `⭐ 经验：${xpAwarded}\n`;
      message += `🎯 奖励经验：${rewardXpAwarded}`;
      if (privilegePointsAwarded > 0) {
        message += `\n👑 特权点：+${privilegePointsAwarded}（累计奖励经验达到 ${Math.floor((rewardXpAwarded || 0) / 100) * 100} 点）`;
      }
      toast.success(message);
    } catch (err) {
      toast.error('操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (entryId: string) => {
    const confirmed = await confirm({
      title: '打回任务',
      message: '确定打回这个任务吗？孩子需要重新完成。',
      type: 'warning',
      confirmText: '确定打回',
    });
    if (!confirmed) return;
    try {
      await api.post(`/parent/review/${entryId}`, { action: 'reject' });
      toast.success('已打回任务');
      fetchDashboard();
    } catch (err) {
      toast.error('操作失败');
    }
  };

  const totalBonus = timeScore + qualityScore + initiativeScore;

  return (
    <Layout>
      <Header 
        title="家长模式" 
        rightElem={<button onClick={() => navigate('/select-user')} className="text-xs font-bold text-blue-600">切换</button>} 
      />
      
      <div className="p-4 space-y-6 overflow-y-auto flex-1 pb-10">
        {/* 概览数据 */}
        <div className="grid grid-cols-2 gap-2 text-center">
          <Card className="py-4 bg-blue-50 border-blue-100">
            <div className="text-xs text-gray-500 mb-1">本周任务完成</div>
            <div className="text-2xl font-black text-gray-800">
              <span className="text-green-600">{stats.weekCompleted}</span>
              <span className="text-gray-400 text-lg mx-1">/</span>
              <span>{stats.weekTasks}</span>
            </div>
          </Card>
          <Card className="py-4 bg-green-50 border-green-100">
            <div className="text-xs text-gray-500 mb-1">完成率</div>
            <div className="text-2xl font-black text-green-600">{stats.completionRate}</div>
          </Card>
          <Card className="py-4 bg-purple-50 border-purple-100">
            <div className="text-xs text-gray-500 mb-1">准时率</div>
            <div className="text-2xl font-black text-purple-600">{stats.punctualRate}</div>
          </Card>
          <Card className="py-4 bg-yellow-50 border-yellow-100">
            <div className="text-xs text-gray-500 mb-1">本周获得金币</div>
            <div className="text-2xl font-black text-yellow-600">{stats.totalCoinsEarned} 💰</div>
          </Card>
        </div>

        {/* 待审核 */}
        <div>
          <h2 className="font-bold text-red-600 mb-3 flex items-center gap-2">
            <Lock size={18}/> 待审核任务 ({reviews.length})
          </h2>
          {reviews.length > 0 ? reviews.map(review => {
            // 格式化实际用时
            const formatDuration = (minutes?: number) => {
              if (!minutes) return '未记录';
              if (minutes < 60) return `${minutes}分钟`;
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
            };
            
            return (
              <Card key={review.id} className="border-red-100 bg-red-50/30 mb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold">{review.title}</h3>
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
        </div>

        {/* 首次使用引导 */}
        {stats.weekTasks === 0 && reviews.length === 0 && (
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
            {stats.weekTasks === 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">去添加</span>
            )}
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
          <Button variant="secondary" size="lg" className="h-24 flex-col gap-2 col-span-2" onClick={() => navigate('/parent/achievements')}>
            <Trophy size={28} className="text-yellow-600"/>
            <span>成就管理</span>
          </Button>
        </div>
      </div>

      {/* 审批弹窗 */}
      {showReviewModal && currentReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-bold text-lg">任务审批</h3>
              <button onClick={() => setShowReviewModal(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>

            <div className="p-4 space-y-5">
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
              </div>

              {/* 评分维度 */}
              <div className="space-y-4">
                {/* 完成时间 */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={16} className="text-blue-500"/>
                    <span className="font-bold text-sm">完成时间</span>
                    <span className={`ml-auto text-sm font-bold ${timeScore > 0 ? 'text-green-600' : timeScore < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {timeScore > 0 ? `+${timeScore}%` : `${timeScore}%`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {TIME_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setTimeScore(opt.value)}
                        className={`py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                          timeScore === opt.value 
                            ? 'bg-blue-500 text-white shadow-lg' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <div className="text-lg">{opt.emoji}</div>
                        <div className="mt-1">{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 完成质量 */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Star size={16} className="text-yellow-500"/>
                    <span className="font-bold text-sm">完成质量</span>
                    <span className={`ml-auto text-sm font-bold ${qualityScore > 0 ? 'text-green-600' : qualityScore < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {qualityScore > 0 ? `+${qualityScore}%` : `${qualityScore}%`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {QUALITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setQualityScore(opt.value)}
                        className={`py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                          qualityScore === opt.value 
                            ? 'bg-yellow-500 text-white shadow-lg' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <div className="text-lg">{opt.emoji}</div>
                        <div className="mt-1">{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 主动性 */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Bell size={16} className="text-purple-500"/>
                    <span className="font-bold text-sm">主动性</span>
                    <span className={`ml-auto text-sm font-bold ${initiativeScore > 0 ? 'text-green-600' : initiativeScore < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                      {initiativeScore > 0 ? `+${initiativeScore}%` : `${initiativeScore}%`}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {INITIATIVE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setInitiativeScore(opt.value)}
                        className={`py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                          initiativeScore === opt.value 
                            ? 'bg-purple-500 text-white shadow-lg' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        <div className="text-lg">{opt.emoji}</div>
                        <div className="mt-1">{opt.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
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
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  计算公式：{currentReview.coinReward} × (100% + {totalBonus}%) = {calculateFinalCoins()} 金币
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
                  disabled={submitting}
                  className="flex-1 py-3 bg-green-500 font-bold text-white rounded-xl shadow-lg shadow-green-200 hover:bg-green-600 disabled:opacity-50"
                >
                  {submitting ? '处理中...' : '确认通过'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog />
    </Layout>
  );
}
