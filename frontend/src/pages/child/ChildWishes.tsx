import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import type { Wish, InventoryItem, Privilege } from '../../types/shop';
import { useNavigate, useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { ShoppingBag, RotateCcw, Gift, Dna, Coins, Clock, Gamepad2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { Confetti } from '../../components/Confetti';
import { BottomSheet } from '../../components/BottomSheet';
import { playSuccessSound, playCoinSound, playErrorSound, playMagicSound } from '../../utils/sounds';

// 前端时间窗口校验（与后端保持一致）
const checkTimeWindow = (timeWindow: string | null): { ok: boolean; message?: string } => {
  if (!timeWindow) return { ok: true };
  try {
    const rule = JSON.parse(timeWindow);
    if (!rule.enabled) return { ok: true };

    const now = new Date();
    // 使用北京时间 (UTC+8)
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijingNow = new Date(utc + (8 * 60 * 60000));
    const currentDay = beijingNow.getDay();
    const currentHour = beijingNow.getHours();
    const currentMinute = beijingNow.getMinutes();
    const currentTimeNum = currentHour * 60 + currentMinute;

    if (rule.days && Array.isArray(rule.days) && rule.days.length > 0 && !rule.days.includes(currentDay)) {
      const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
      const allowed = rule.days.map((d: number) => dayNames[d]).join('、');
      return { ok: false, message: `只能在 ${allowed} 使用` };
    }

    if (rule.start && rule.end) {
      const [startH, startM] = rule.start.split(':').map(Number);
      const [endH, endM] = rule.end.split(':').map(Number);
      const startNum = startH * 60 + startM;
      const endNum = endH * 60 + endM;

      let inWindow: boolean;
      if (startNum <= endNum) {
        inWindow = currentTimeNum >= startNum && currentTimeNum <= endNum;
      } else {
        inWindow = currentTimeNum >= startNum || currentTimeNum <= endNum;
      }

      if (!inWindow) {
        return { ok: false, message: `可用时间 ${rule.start}-${rule.end}` };
      }
    }

    return { ok: true };
  } catch {
    return { ok: true };
  }
};

const inferShopCategory = (item: any) => {
  const stored = String(item?.category || '').trim();
  if (stored) return stored;
  const text = `${item?.title || ''} ${item?.description || ''}`;
  if (/(手机|电视|游戏|屏幕|平板)/.test(text)) return '屏幕';
  if (/(早餐|晚餐|午餐|零食|饼干|糖|奶|水果|披萨|小吃)/.test(text)) return '餐饮';
  if (/(公园|外出|游乐|电影)/.test(text)) return '外出';
  if (/(书|学习|文具|画画|课程)/.test(text)) return '学习';
  if (/(玩具|贴纸|乐高)/.test(text)) return '玩乐';
  return '其他';
};

const SCREEN_TIME_CACHE_KEY = 'stellar_child_screen_time_cache';
const getCachedScreenTime = () => {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(localStorage.getItem(SCREEN_TIME_CACHE_KEY) || 'null');
    if (!cached?.data || Date.now() - Number(cached.cachedAt || 0) > 5 * 60 * 1000) return null;
    return cached.data;
  } catch {
    return null;
  }
};

const cacheScreenTime = (data: any) => {
  try {
    localStorage.setItem(SCREEN_TIME_CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    // ignore cache failures
  }
};

// 友情提示弹窗组件
const TipModal = ({ isOpen, onClose, title, message, icon }: { isOpen: boolean, onClose: () => void, title: string, message: string, icon: string }) => {
  if (!isOpen) return null;

  // 挂到设备框层的 overlay root：页面在 PullToRefresh（relative + overflow-y-auto）滚动容器内，
  // 直接用 absolute inset-0 会以整段长内容为定位基准，弹窗被居中到内容中部而滚出可视区
  // （表现为只见暗屏不见弹窗）。overlay root 是设备框的直接子节点，定位基准即可视区。
  const overlayRoot = typeof document !== 'undefined'
    ? (document.querySelector('[data-child-overlay-root="true"]') as HTMLElement | null)
    : null;

  const modal = (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 pointer-events-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}>
        <div className="text-center">
          <div className="text-5xl mb-3">{icon}</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
          <p className="text-gray-600 mb-4">{message}</p>
          <button onClick={onClose} className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95">
            知道啦！
          </button>
        </div>
      </div>
    </div>
  );

  return overlayRoot ? createPortal(modal, overlayRoot) : modal;
};

export default function ChildWishes() {
  const navigate = useNavigate();
  const context = useOutletContext<any>();
  const childData = context?.childData || { coins: 0, privilegePoints: 0 };
  const refresh = context?.refresh || (() => {});
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  const [view, setView] = useState<'shop'|'bag'|'savings'|'lottery'|'privileges'>('shop');

  const [shopItems, setShopItems] = useState<Wish[]>([]);
  const [shopCategory, setShopCategory] = useState('全部');
  const [bagItems, setBagItems] = useState<InventoryItem[]>([]);
  const [bagFilter, setBagFilter] = useState<'all'|'pending'|'redeemed'|'cancelled'>('all');
  const [savingsGoals, setSavingsGoals] = useState<Wish[]>([]);
  const [customSavingsAmounts, setCustomSavingsAmounts] = useState<Record<string, string>>({});
  const [lotteryPrizes, setLotteryPrizes] = useState<Wish[]>([]);
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeGridIndex, setActiveGridIndex] = useState<number | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [screenTime, setScreenTime] = useState<any>(() => getCachedScreenTime());

  // 抽奖费用与保底信息
  const [lotteryInfo, setLotteryInfo] = useState<{
    todayDrawCount: number, currentCost: number, nextCost: number,
    dailyLimit?: number, remainingDraws?: number,
    pity?: {
      totalDraws: number, rareStreak: number, epicStreak: number, legendaryStreak: number,
      rarePityProgress: number, epicPityProgress: number, legendaryPityProgress: number,
      monthlyEpicOrAboveCount?: number, monthlyEpicOrAboveLimit?: number, epicOrAboveAvailable?: boolean,
      epicPityDisabled?: boolean, legendaryPityDisabled?: boolean, epicOrAboveRule?: string,
      odds?: {
        epicOrAboveProbabilityPercent: number,
        expectedDrawsForOneEpicOrAbove: number | null,
        expectedDrawsToMonthlyEpicOrAboveLimit: number | null,
        remainingEpicOrAboveThisMonth: number,
        monthlyEpicOrAboveLimit: number,
        activePrizeCount: number
      }
    }
  }>({
    todayDrawCount: 0, currentCost: 15, nextCost: 15, dailyLimit: 10, remainingDraws: 10
  });

  // 过滤背包物品
  const filteredBagItems = bagFilter === 'all'
    ? bagItems
    : bagItems.filter(item => {
        // 兼容旧数据
        if (bagFilter === 'pending' && (item.status === 'pending' || item.status === 'unused' || item.status === 'transferring')) return true;
        if (bagFilter === 'redeemed' && (item.status === 'redeemed' || item.status === 'used')) return true;
        if (bagFilter === 'cancelled' && (item.status === 'cancelled' || item.status === 'returned')) return true;
        return item.status === bagFilter;
      });

  // 友情提示弹窗状态
  const [tipModal, setTipModal] = useState<{isOpen: boolean, title: string, message: string, icon: string}>({
    isOpen: false, title: '', message: '', icon: ''
  });

  const showTip = (title: string, message: string, icon: string) => {
    setTipModal({ isOpen: true, title, message, icon });
  };

  const canCancelInventoryItem = (item: any) => (
    item?.source === 'shop' &&
    (item?.costType || 'coins') === 'coins' &&
    Number(item?.cost || 0) > 0 &&
    Number(item?.cancelCount || 0) < 1 &&
    item?.effectType !== 'draw_again'
  );

  // 家庭成员列表（用于转赠）
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  // 转让弹窗
  const [transferModal, setTransferModal] = useState<{isOpen: boolean, item: any | null}>({ isOpen: false, item: null });
  const [transferTarget, setTransferTarget] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setPageLoading(true);
      const results = await Promise.allSettled([
          api.get('/child/wishes?type=shop'),
          api.get('/child/inventory'),
          api.get('/child/wishes?type=savings'),
          api.get('/child/lottery/info'),
          api.get('/child/privileges'),
          api.get('/child/family-members'),
          api.get('/child/screen-time')
      ]);
      const [shopRes, invRes, savingsRes, lotteryRes, privilegesRes, membersRes, screenRes] = results.map(r =>
        r.status === 'fulfilled' ? r.value : null
      );
      if (shopRes) setShopItems(shopRes.data);
      if (invRes) setBagItems(invRes.data);
      if (savingsRes) setSavingsGoals(savingsRes.data || []);
      if (lotteryRes) {
        setLotteryPrizes(lotteryRes.data.prizes || []);
        setLotteryInfo({
          todayDrawCount: lotteryRes.data.todayDrawCount || 0,
          currentCost: lotteryRes.data.currentCost || 15,
          nextCost: lotteryRes.data.nextCost || lotteryRes.data.currentCost || 15,
          dailyLimit: lotteryRes.data.dailyLimit || 10,
          remainingDraws: lotteryRes.data.remainingDraws ?? Math.max(0, 10 - Number(lotteryRes.data.todayDrawCount || 0)),
          pity: lotteryRes.data.pity || {
            totalDraws: 0, rareStreak: 0, epicStreak: 0, legendaryStreak: 0,
            rarePityProgress: 0, epicPityProgress: 0, legendaryPityProgress: 0,
            monthlyEpicOrAboveCount: 0, monthlyEpicOrAboveLimit: 2, epicOrAboveAvailable: true
          }
        });
      }
      if (privilegesRes) setPrivileges(privilegesRes.data);
      if (membersRes) setFamilyMembers(membersRes.data || []);
      if (screenRes) {
        setScreenTime(screenRes.data || null);
        cacheScreenTime(screenRes.data || null);
      }
    } catch (e) {
      console.error('获取数据失败:', e);
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const shopCategories = useMemo(() => {
    const categories = Array.from(new Set(shopItems.map(inferShopCategory)));
    return ['全部', ...categories];
  }, [shopItems]);

  const filteredShopItems = useMemo(() => (
    shopCategory === '全部'
      ? shopItems
      : shopItems.filter(item => inferShopCategory(item) === shopCategory)
  ), [shopItems, shopCategory]);

  // 当切换到特权或背包视图时，确保数据已加载
  useEffect(() => {
    if (view === 'privileges' && privileges.length === 0) {
      api.get('/child/privileges').then(res => setPrivileges(res.data || [])).catch(e => console.error(e));
    }
    if (view === 'bag' && bagItems.length === 0) {
      api.get('/child/inventory').then(res => setBagItems(res.data || [])).catch(e => console.error(e));
    }
    if (view === 'lottery') {
      // 获取当前抽奖费用信息
      api.get('/child/lottery/info').then(res => setLotteryInfo(res.data)).catch(e => console.error(e));
    }
  }, [view, privileges.length, bagItems.length]);

  // 我们重写兑换特权函数，因为需要区分 立即使用、存入背包 和 取消。
  const executeRedeemPrivilege = async (priv: any, useImmediately: boolean) => {
      try {
          await api.post(`/child/privileges/${priv.id}/redeem`, { useImmediately });
          playSuccessSound();
          if (useImmediately) {
            showTip('生效成功', `${priv.title} 已经开始生效啦，尽情享受吧！`, '🚀');
          } else {
            showTip('兑换成功', `${priv.title} 已放入背包，快去"背包"查看并随时使用吧！`, '🎉');
          }
          refresh();
          fetchAll();
      } catch (e: any) {
          playErrorSound();
          toast.error(e.response?.data?.message || '兑换失败');
      }
  }



  // 储蓄存入
  const handleDeposit = async (goal: any, amount: number) => {
      const remaining = Math.max(0, Number(goal.targetAmount || 0) - Number(goal.currentAmount || 0));
      const depositAmount = remaining > 0 ? Math.min(amount, remaining) : amount;
      if (!depositAmount || depositAmount <= 0) {
          showTip('无法存入', '这个目标已经完成，或者存入金额无效。', '🎯');
          return;
      }
      if (childData.coins < depositAmount) {
          playErrorSound();
          showTip('金币不足', `你只有 ${childData.coins} 金币，无法存入 ${depositAmount} 金币`, '💰');
          return;
      }
      if (depositAmount >= 50) {
          const ok = await confirm({
              title: '存入储蓄罐',
              message: `要把 ${depositAmount} 金币存进储蓄罐吗？存进去就要等目标达成才能拿回哦`,
              type: 'warning',
              confirmText: '确定存入',
          });
          if (!ok) return;
      }
      try {
          const res = await api.post(`/child/savings/deposit`, { amount: depositAmount, goalId: goal.id });
          refresh();
          fetchAll();
          if (res.data.goalAchieved) {
              playMagicSound();
              setShowConfetti(true);
              showTip('🎉 目标达成！', `储蓄目标已达成！${goal?.title} 已放入背包，快去"背包"查看吧！`, '🎊');
          } else {
              playCoinSound();
              setCustomSavingsAmounts(prev => ({ ...prev, [goal.id]: '' }));
              showTip('存入成功', `成功存入 ${depositAmount} 金币！继续加油~`, '💪');
          }
      } catch (e: any) {
          playErrorSound();
          toast.error(e.response?.data?.message || '存入失败');
      }
  };

  const handleRedeem = async (item: any) => {
      if (childData.coins < item.cost) {
          playErrorSound();
          showTip('金币不足', `你只有 ${childData.coins} 金币，无法兑换 ${item.title}（需要 ${item.cost} 金币）。快去完成任务赚取更多金币吧！`, '💰');
          return;
      }
      if (item.stock === 0) {
          playErrorSound();
          showTip('库存不足', `${item.title} 已经卖完啦，请联系家长补货~`, '📦');
          return;
      }
      const confirmed = await confirm({
        title: '兑换商品',
        message: `确定消耗 ${item.cost} 金币兑换 ${item.title} 吗？`,
        type: 'info',
        confirmText: '确定兑换',
      });
      if (!confirmed) return;
      try {
          setLoading(true);
          await api.post(`/child/wishes/${item.id}/redeem`);
          playSuccessSound();
          showTip('兑换成功', `${item.title} 已放入背包，快去"背包"查看吧！`, '🎉');
          refresh();
          fetchAll();
      } catch (e: any) {
          playErrorSound();
          toast.error(e.response?.data?.message || '兑换失败');
      } finally {
          setLoading(false);
      }
  };

  // 撤销兑换
  const handleCancel = async (item: any) => {
      const costType = item.costType || 'coins';
      const costText = costType === 'privilegePoints' ? `${item.cost} 特权点` : `${item.cost} 金币`;
      const confirmed = await confirm({
        title: '撤销兑换',
        message: `确定撤销兑换 ${item.title} 吗？${costText}将退回。每个商店商品只有 1 次撤销机会，撤销后这类商品不能再次撤销。`,
        type: 'warning',
        confirmText: '确定撤销',
      });
      if (!confirmed) return;
      try {
          await api.post(`/child/inventory/${item.id}/cancel`);
          const message = costType === 'privilegePoints'
              ? `${item.title} 已撤销，特权点已退回！`
              : `${item.title} 已撤销，金币已退回！`;
          showTip('已撤销', message, '↩️');
          refresh();
          fetchAll();
      } catch (e: any) {
          playErrorSound();
          toast.error(e.response?.data?.message || '撤销失败');
      }
  };

  // 兑现物品/服务
  // 使用历史「再抽一次」道具（兼容旧数据）：标记为已使用，然后免费再抽
  const handleUseDrawAgain = async (item: any) => {
    const confirmed = await confirm({
      title: '使用再抽一次',
      message: `确定使用「${item.title}」吗？将立即获得一次免费抽奖机会！`,
      type: 'info',
      confirmText: '🎲 使用并抽奖',
    });
    if (!confirmed) return;
    setLoading(true);
    try {
      // 先标记道具已使用
      await api.post(`/child/inventory/${item.id}/redeem`);

      // 然后执行免费抽奖
      let result = await runLotteryAnimation(() => api.post('/child/lottery/redraw'));

      // 如果连续抽到"再抽一次"，继续循环
      while (result?.isDrawAgain) {
        const continueConfirmed = await confirm({
          title: '🎉 又抽到再抽一次！',
          message: `你抽中了「${prizeTitle(result.winner)}」！\n点击"立即再抽"继续免费再抽！`,
          type: 'info',
          confirmText: '🎲 立即再抽',
          cancelText: '知道了',
        });
        if (!continueConfirmed) break;
        result = await runLotteryAnimation(() => api.post('/child/lottery/redraw'));
        if (!result) break;
      }

      if (result && !result.isDrawAgain) {
        if (result.isNothing) {
          showTip('谢谢参与', `这次没有中奖，下次再来试试运气吧~`, '😊');
        } else {
          showTip('🎉 恭喜中奖！', `你抽中了：${prizeTitle(result.winner)}！已放入背包，快去查看吧~`, '🎊');
        }
      }

      refresh();
      fetchAll();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '使用失败');
    } finally {
      setLoading(false);
    }
  };

  // 马上使用物品（直接兑现，无需二次确认）
  const handleUseItem = async (item: any) => {
      try {
          const res = await api.post(`/child/inventory/${item.id}/redeem`);
          if (item.source === 'achievement_reward') {
              const parts = [
                  res.data?.rewardCoins ? `${res.data.rewardCoins} 金币` : '',
                  res.data?.rewardXp ? `${res.data.rewardXp} 经验` : '',
                  res.data?.rewardPrivilegePoints ? `${res.data.rewardPrivilegePoints} 特权点` : '',
              ].filter(Boolean).join('、');
              showTip('成就礼包已打开', parts ? `获得 ${parts}！` : `${item.title} 已打开！`, '🏆');
          } else {
              showTip('使用成功', `${item.title} 已使用！`, '🎉');
          }
          refresh();
          fetchAll();
      } catch (e: any) {
          toast.error(e.response?.data?.message || '使用失败');
      }
  };

  // 打开转赠弹窗
  const handleOpenTransfer = (item: any) => {
      if (familyMembers.length === 0) {
          showTip('无法转赠', '当前家庭没有其他成员可以转赠。', '👤');
          return;
      }
      setTransferTarget(familyMembers[0]?.id || '');
      setTransferModal({ isOpen: true, item });
  };

  // 提交转赠
  const submitTransfer = async () => {
      if (!transferModal.item || !transferTarget) return;

      const targetChild = familyMembers.find(m => m.id === transferTarget);
      const targetName = targetChild?.name || '对方';

      const confirmed = await confirm({
          title: '🎁 确认转赠特权',
          message: `你确定要把「${transferModal.item.title}」送给 ${targetName} 吗？\n\n温馨提示：礼物送出后就不能拿回来啦，请一定要想清楚哦！`,
          type: 'warning',
          confirmText: '确定送出',
          cancelText: '我再想想'
      });

      if (!confirmed) return;

      setTransferLoading(true);
      try {
          const res = await api.post(`/child/inventory/${transferModal.item.id}/transfer`, {
              toChildId: transferTarget
          });
          showTip('转赠成功', res.data.message || '转让请求已发送！', '🎁');
          setTransferModal({ isOpen: false, item: null });
          refresh();
          fetchAll();
      } catch (e: any) {
          toast.error(e.response?.data?.message || '转赠失败');
      } finally {
          setTransferLoading(false);
      }
  };

  // --- LOTTERY LOGIC ---
  const GRID_PATH = [0, 1, 2, 3, 4, 5, 6, 7];
  const getGridPrizes = () => {
      const slots = new Array(8).fill(null);
      if (!lotteryPrizes || lotteryPrizes.length === 0) return slots;

      const drawAgainPrize = lotteryPrizes.find(item => item?.effectType === 'draw_again');
      const normalPrizes = lotteryPrizes.filter(item => item?.effectType !== 'draw_again');

      if (drawAgainPrize) {
          const drawAgainIndex = 2;
          slots[drawAgainIndex] = drawAgainPrize;
          for (let i = 0, normalIndex = 0; i < 8; i++) {
              if (i === drawAgainIndex) continue;
              slots[i] = normalPrizes.length > 0 ? normalPrizes[normalIndex++ % normalPrizes.length] : null;
          }
          return slots;
      }

      for (let i = 0; i < 8; i++) {
          slots[i] = normalPrizes[i % normalPrizes.length];
      }
      return slots;
  };
  const gridPrizes = getGridPrizes();
  const displayPrize = (item: any) => (
      item?.effectType === 'draw_again'
          ? { ...item, title: '再抽一次', icon: '🔄' }
          : item
  );
  const prizeTitle = (item: any) => displayPrize(item)?.title || '奖品';

  // 执行抽奖动画并返回中奖结果
  const runLotteryAnimation = async (apiCall: () => Promise<any>): Promise<any | null> => {
      // eslint-disable-next-line no-async-promise-executor -- 抽奖动画依赖 await 节奏，错误已在内部 try/catch 处理
      return new Promise(async (resolve) => {
          let spinInterval: ReturnType<typeof setInterval> | null = null;
          let currentStep = 0;

          try {
              spinInterval = setInterval(() => {
                  setActiveGridIndex(GRID_PATH[currentStep % 8]);
                  currentStep++;
              }, 80);

              const res = await apiCall();
              const winner = res.data.winner;

              // 更新抽奖费用和保底信息
              setLotteryInfo(prev => ({
                ...prev,
                todayDrawCount: res.data.todayDrawCount ?? prev.todayDrawCount,
                currentCost: res.data.nextCost || res.data.currentCost || prev.currentCost || 15,
                nextCost: res.data.nextCost || res.data.currentCost || prev.nextCost || 15,
                dailyLimit: res.data.dailyLimit ?? prev.dailyLimit ?? 10,
                remainingDraws: res.data.remainingDraws ?? prev.remainingDraws,
                pity: res.data.pity
              }));

              const winnerIndexInGrid = gridPrizes.findIndex(p => p?.id === winner.id);

              setTimeout(() => {
                  if (spinInterval) clearInterval(spinInterval);
                  setActiveGridIndex(winnerIndexInGrid !== -1 ? winnerIndexInGrid : 0);
                  playMagicSound();

                  const winnerRank = ({ common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 } as Record<string, number>)[winner.rarity || 'common'] || 1;
                  if (winnerRank >= 4) {
                    setShowConfetti(true);
                  }

                  setTimeout(() => {
                      setActiveGridIndex(null);
                      resolve(res.data);
                  }, 800);
              }, 2500);
          } catch (e: any) {
              if (spinInterval) clearInterval(spinInterval);
              setActiveGridIndex(null);
              toast.error(e.response?.data?.message || '抽奖失败');
              resolve(null);
          }
      });
  };

  const handleLottery = async () => {
      if (loading) return;

      const cost = lotteryInfo.currentCost;
      if (childData.coins < cost) {
        showTip('金币不足', `本次抽奖需要 ${cost} 金币，你目前只有 ${childData.coins} 金币。\n快去完成任务赚取更多金币吧！`, '💰');
        return;
      }
      if ((lotteryInfo.remainingDraws ?? 10) <= 0) {
        showTip('今日抽奖已用完', `今天最多抽 ${lotteryInfo.dailyLimit || 10} 次，明天 0 点后会重新开始。`, '⏰');
        return;
      }
      if (lotteryPrizes.length === 0) {
        showTip('奖池为空', '家长还没有设置抽奖奖品哦，请联系家长添加奖品~', '🎁');
        return;
      }

      setLoading(true);

      try {
          // 第一次抽奖（花金币）
          let result = await runLotteryAnimation(() => api.post('/child/lottery/play'));
          if (!result) {
              setLoading(false);
              return;
          }

          // 如果抽到"再抽一次"，弹窗提示并立即免费再抽
          while (result.isDrawAgain) {
              const confirmed = await confirm({
                title: '🎉 恭喜抽到再抽一次！',
                message: `你抽中了「${prizeTitle(result.winner)}」！\n点击"立即再抽"免费再抽一次！`,
                type: 'info',
                confirmText: '🎲 立即再抽',
                cancelText: '知道了',
              });

              if (!confirmed) {
                  // 用户选择不再抽，直接退出
                  break;
              }

              // 调用免费再抽API
              result = await runLotteryAnimation(() => api.post('/child/lottery/redraw'));
              if (!result) {
                  break; // 出错了
              }
              // 继续循环检查是否又抽到"再抽一次"
          }

          // 最终展示中奖结果
          if (result && !result.isDrawAgain) {
              if (result.isNothing) {
                  showTip('谢谢参与', `这次没有中奖，下次再来试试运气吧~`, '😊');
              } else if (result.isBonusCoins) {
                  showTip('🎉 恭喜中奖！', `你抽中了：${prizeTitle(result.winner)}！直接获得 ${result.bonusCoins} 金币！`, '💰');
              } else if (result.isBonusXp) {
                  showTip('恭喜中奖', `抽中了 ${prizeTitle(result.winner)}，获得 ${result.bonusXp} 经验。`, '✨');
              } else if (result.isBonusPrivilegePoints) {
                  showTip('恭喜中奖', `抽中了 ${prizeTitle(result.winner)}，获得 ${result.bonusPrivilegePoints} 特权点。`, '💎');
              } else if (result.isFreeSpin) {
                  showTip('🎉 恭喜中奖！', `你抽中了：${prizeTitle(result.winner)}！获得一次免费抽奖机会，已放入背包！`, '🎫');
              } else if (result.isDoubleNext) {
                  showTip('🎉 恭喜中奖！', `你抽中了：${prizeTitle(result.winner)}！下次任务奖励将翻倍！`, '✨');
              } else if (result.pityTriggered?.rare) {
                  showTip('🌟 稀有保底触发！', `你抽中了：${prizeTitle(result.winner)}！（至少匹配稀有档奖励）`, '🎊');
              } else {
                  showTip('🎉 恭喜中奖！', `你抽中了：${prizeTitle(result.winner)}！已放入背包，快去"背包"查看并兑现吧！`, '🎊');
              }
          }

          refresh();
          fetchAll();
      } finally {
          setLoading(false);
      }
  };

  const isGoalComplete = (goal: any) => Number(goal.currentAmount || 0) >= Number(goal.targetAmount || 0) && Number(goal.targetAmount || 0) > 0;
  const activeSavingsGoals = savingsGoals.filter((goal: any) => !isGoalComplete(goal));
  const completedSavingsGoals = savingsGoals.filter((goal: any) => isGoalComplete(goal));
  const viewMeta = {
    shop: {
      icon: <ShoppingBag size={22} />,
      title: '奖励商店',
      description: '用金币兑换家长设置的奖励，屏幕时间会统一走游戏票限制。',
      stat: `${filteredShopItems.length} 个可兑换`,
      className: 'bg-pink-50 border-pink-100 text-pink-700',
    },
    bag: {
      icon: <Gift size={22} />,
      title: '我的背包',
      description: '已兑换、成就礼包和宝箱奖励都会放在这里，使用前可以再确认。',
      stat: `${filteredBagItems.length} 件物品`,
      className: 'bg-blue-50 border-blue-100 text-blue-700',
    },
    savings: {
      icon: <Coins size={22} />,
      title: '储蓄目标',
      description: '可以同时存多个目标，完成的目标会保留在历史里，不会自动消失。',
      stat: `${activeSavingsGoals.length} 个进行中`,
      className: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    },
    lottery: {
      icon: <Gift size={22} />,
      title: '宝箱抽奖',
      description: `固定 ${lotteryInfo.currentCost || 15} 金币一次，每天最多 ${lotteryInfo.dailyLimit || 10} 次；完成任务也会触发即时宝箱反馈。`,
      stat: `剩余 ${lotteryInfo.remainingDraws ?? Math.max(0, (lotteryInfo.dailyLimit || 10) - lotteryInfo.todayDrawCount)} 次`,
      className: 'bg-white/10 border-white/15 text-white',
    },
    privileges: {
      icon: <Dna size={22} />,
      title: '特权兑换',
      description: '特权点来自任务成长，可以立即使用，也可以先放进背包。',
      stat: `${privileges.length} 个特权`,
      className: 'bg-yellow-50 border-yellow-100 text-yellow-700',
    },
  }[view];

  return (
    <div className={`p-4 space-y-4 min-h-full ${view === 'lottery' ? 'bg-gradient-to-b from-purple-800 to-indigo-900' : ''}`}>
      {/* 顶部金币和特权点显示 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gradient-to-r from-yellow-400 to-orange-400 rounded-xl p-3 text-white text-center">
          <div className="text-xs opacity-80 font-bold">我的金币</div>
          <div className="text-2xl font-black leading-tight">{childData.coins} 💰</div>
        </div>
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-3 text-white text-center">
          <div className="text-xs opacity-80 font-bold">特权点</div>
          <div className="text-2xl font-black leading-tight">{childData.privilegePoints || 0} 💎</div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 bg-white rounded-xl p-1 shadow-sm">
          <button onClick={()=>setView('shop')} className={`min-h-[44px] px-1 py-2 text-sm font-bold rounded-lg transition-all ${view==='shop'?'bg-pink-500 text-white shadow-md':'text-gray-500 active:bg-gray-50'}`}>商店</button>
          <button onClick={()=>setView('bag')} className={`min-h-[44px] px-1 py-2 text-sm font-bold rounded-lg transition-all ${view==='bag'?'bg-blue-500 text-white shadow-md':'text-gray-500 active:bg-gray-50'}`}>背包</button>
          <button onClick={()=>setView('savings')} className={`min-h-[44px] px-1 py-2 text-sm font-bold rounded-lg transition-all ${view==='savings'?'bg-green-500 text-white shadow-md':'text-gray-500 active:bg-gray-50'}`}>储蓄</button>
          <button onClick={()=>setView('lottery')} className={`min-h-[44px] px-1 py-2 text-sm font-bold rounded-lg transition-all ${view==='lottery'?'bg-purple-500 text-white shadow-md':'text-gray-500 active:bg-gray-50'}`}>抽奖</button>
          <button onClick={()=>setView('privileges')} className={`min-h-[44px] px-1 py-2 text-sm font-bold rounded-lg transition-all ${view==='privileges'?'bg-yellow-500 text-white shadow-md':'text-gray-500 active:bg-gray-50'}`}>特权</button>
      </div>

      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${viewMeta.className}`}>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${view === 'lottery' ? 'bg-white/15' : 'bg-white'}`}>
          {viewMeta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-black ${view === 'lottery' ? 'text-white' : 'text-gray-900'}`}>{viewMeta.title}</div>
          <div className={`text-xs font-bold mt-0.5 leading-relaxed ${view === 'lottery' ? 'text-white/70' : 'text-gray-500'}`}>
            {viewMeta.description}
          </div>
        </div>
        <div className={`text-xs font-black px-2 py-1 rounded-full flex-shrink-0 ${view === 'lottery' ? 'bg-white/15 text-white' : 'bg-white/80'}`}>
          {viewMeta.stat}
        </div>
      </div>

      {view === 'shop' && (
        <button
          type="button"
          onClick={() => navigate('/child/calm', { state: { backTo: '/child/wishes', backLabel: '返回上一页' } })}
          className="w-full rounded-2xl bg-emerald-50 border border-emerald-100 p-3 flex items-center gap-3 text-left active:scale-[0.99]"
        >
          <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center">
            <Gamepad2 size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-emerald-800">游戏票在冷静页使用</div>
            <div className="text-xs font-bold text-emerald-600 mt-0.5">
              当前可用 {screenTime?.balance ?? 0} 分钟。可从家长发放、宝箱和部分任务获得，当天有效并受时间窗口限制。
            </div>
          </div>
          <span className="text-xs font-black text-emerald-600">去使用</span>
        </button>
      )}

      {/* SHOP VIEW */}
      {view === 'shop' && (
          pageLoading ? (
              <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
                          <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-gray-200 rounded-xl animate-pulse" />
                              <div className="flex-1 space-y-2">
                                  <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
                                  <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse" />
                              </div>
                          </div>
                          <div className="h-8 w-full bg-gray-200 rounded-lg animate-pulse" />
                      </div>
                  ))}
              </div>
          ) : (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {shopCategories.map(category => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setShopCategory(category)}
                  className={`px-3 py-1.5 rounded-full text-xs font-black whitespace-nowrap ${
                    shopCategory === category ? 'bg-pink-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-100'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredShopItems.map(item => (
                  <Card key={item.id} className="flex flex-col items-center text-center p-4 hover:scale-105 transition-transform">
                      <div className="text-4xl mb-2 drop-shadow-md">{item.icon}</div>
                      <div className="font-bold line-clamp-1 text-gray-800">{item.title}</div>
                      <div className="text-xs text-gray-500 mb-1">库存: {item.stock === -1 ? '无限' : item.stock}</div>
                      <div className="mb-3 text-[10px] font-black px-2 py-0.5 rounded-full bg-pink-50 text-pink-500">
                        {inferShopCategory(item)}
                      </div>
                      <Button size="sm" className="w-full bg-gradient-to-r from-pink-500 to-rose-500 border-none" disabled={childData.coins < item.cost || item.stock === 0 || loading} onClick={() => handleRedeem(item)}>
                          {item.stock === 0 ? '缺货' : `${item.cost} 💰 兑换`}
                      </Button>
                  </Card>
              ))}
              {filteredShopItems.length === 0 && <div className="col-span-2 text-center text-gray-400 py-10">这个分类暂无商品</div>}
            </div>
          </div>
          )
      )}

      {/* BAG VIEW */}
      {view === 'bag' && (
          pageLoading ? (
              <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-gray-200 rounded-full animate-pulse" />
                              <div className="space-y-2">
                                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                                  <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                              </div>
                          </div>
                          <div className="h-8 w-16 bg-gray-200 rounded-lg animate-pulse" />
                      </div>
                  ))}
              </div>
          ) : (
          <div className="space-y-3">
              {/* 状态筛选 */}
              <div className="flex gap-2 bg-white p-2 rounded-xl">
                  <button
                      onClick={() => setBagFilter('all')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      全部
                  </button>
                  <button
                      onClick={() => setBagFilter('pending')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'pending' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      待兑现
                  </button>
                  <button
                      onClick={() => setBagFilter('redeemed')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'redeemed' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      已兑现
                  </button>
                  <button
                      onClick={() => setBagFilter('cancelled')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'cancelled' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      已撤销
                  </button>
              </div>

              {filteredBagItems.map((item, index) => {
                  const statusMap: Record<string, {label: string, color: string, borderColor: string}> = {
                      'pending': { label: '待兑现', color: 'text-orange-600', borderColor: 'border-orange-400' },
                      'redeemed': { label: '已兑现', color: 'text-green-600', borderColor: 'border-green-400' },
                      'cancelled': { label: '已撤销', color: 'text-red-600', borderColor: 'border-red-400' },
                      'transferring': { label: '转赠中', color: 'text-purple-600', borderColor: 'border-purple-400' },
                      // 兼容旧数据
                      'unused': { label: '待兑现', color: 'text-orange-600', borderColor: 'border-orange-400' },
                      'used': { label: '已兑现', color: 'text-green-600', borderColor: 'border-green-400' },
                      'returned': { label: '已撤销', color: 'text-red-600', borderColor: 'border-red-400' },
                  };
                  const statusInfo = statusMap[item.status || 'pending'] || statusMap['pending'];
                  const isAchievementReward = item.source === 'achievement_reward';
                  const rewardParts = [
                      item.rewardCoins ? `💰 ${item.rewardCoins}` : '',
                      item.rewardXp ? `⭐ ${item.rewardXp}` : '',
                      item.rewardPrivilegePoints ? `💎 ${item.rewardPrivilegePoints}` : '',
                  ].filter(Boolean).join(' · ');

                  return (
                      <Card key={item.id} className={`flex justify-between items-center border-l-4 ${statusInfo.borderColor}`}>
                          <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full bg-slate-900 text-white text-[11px] font-black flex items-center justify-center flex-shrink-0">
                                  {index + 1}
                              </div>
                              <div className="text-3xl bg-blue-50 w-12 h-12 rounded-full flex items-center justify-center">{item.icon}</div>
                              <div>
                                  <div className="font-bold text-gray-800">{item.title}</div>
                                  <div className="text-xs text-gray-500 mt-1">
                                      {new Date(item.acquiredAt).toLocaleDateString()} 获得
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                      {item.source === 'lottery' ? (
                                          <span className="text-purple-600">🎰 抽奖获得 (-{item.cost || 15}💰)</span>
                                      ) : item.source === 'savings' ? (
                                          <span className="text-green-600">🎯 储蓄达成</span>
                                      ) : isAchievementReward ? (
                                          <span className="text-yellow-700">🏆 成就礼包{rewardParts ? `：${rewardParts}` : ''}</span>
                                      ) : item.costType === 'privilegePoints' ? (
                                          <span className="text-purple-600">👑 {item.cost} 特权点兑换</span>
                                      ) : (item.cost ?? 0) > 0 ? (
                                          <span className="text-yellow-600">💰 {item.cost} 金币兑换</span>
                                      ) : (
                                          <span className="text-green-600">🎁 免费获得</span>
                                      )}
                                  </div>
                                  <div className={`text-xs font-bold mt-1 ${statusInfo.color}`}>
                                      {statusInfo.label}
                                  </div>
                              </div>
                          </div>
                          <div className="flex items-center gap-2">
                              {item.status === 'transferring' ? (
                                  <span className="text-xs font-bold px-3 py-1.5 rounded-lg text-purple-600 bg-purple-100">
                                      转赠中
                                  </span>
                              ) : (item.status === 'pending' || item.status === 'unused') ? (
                                  <>
                                      {/* 时间窗口校验 */}
                                      {(() => {
                                        const timeCheck = checkTimeWindow(item.timeWindow || null);
                                        if (!timeCheck.ok) {
                                          return (
                                            <div className="px-3 py-1.5 bg-gray-100 text-gray-400 text-xs font-bold rounded-lg flex items-center gap-1">
                                              <Clock size={12}/> {timeCheck.message}
                                            </div>
                                          );
                                        }
                                        {/* 「再抽一次」类物品：使用 = 免费再抽一次；其他：兑现 */}
                                        if (item.effectType === 'draw_again') {
                                          return (
                                            <button
                                                onClick={() => handleUseDrawAgain(item)}
                                                disabled={loading}
                                                className="px-3 py-2.5 min-h-[44px] bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1"
                                            >
                                                🔄 使用
                                            </button>
                                          );
                                        }
                                        return (
                                            <>
                                              <button
                                                  onClick={() => handleUseItem(item)}
                                                  className="px-3 py-2.5 min-h-[44px] bg-blue-500 text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors"
                                              >
                                                  {isAchievementReward ? '打开礼包' : '马上使用'}
                                              </button>
                                              {!isAchievementReward && (
                                                <button
                                                    onClick={() => handleOpenTransfer(item)}
                                                    className="px-3 py-2.5 min-h-[44px] bg-purple-500 text-white text-xs font-bold rounded-lg hover:bg-purple-600 transition-colors"
                                                >
                                                    转赠
                                                </button>
                                              )}
                                            </>
                                        );
                                      })()}
                                      {/* 抽奖、储蓄达成、免费获得物品不可撤销；再抽一次不可撤销；cost=0的老数据也不可撤销 */}
                                      {canCancelInventoryItem(item) && (
                                          <button
                                              onClick={() => handleCancel(item)}
                                              className="px-3 py-2.5 min-h-[44px] bg-red-100 text-red-600 text-xs font-bold rounded-lg hover:bg-red-200 transition-colors flex items-center gap-1"
                                          >
                                              <RotateCcw size={12}/> 撤销
                                          </button>
                                      )}
                                  </>
                              ) : (
                                  <span className={`text-xs font-bold px-2 py-1 rounded ${statusInfo.color} bg-gray-100`}>
                                      {statusInfo.label}
                                  </span>
                              )}
                          </div>
                      </Card>
                  );
              })}
              {filteredBagItems.length === 0 && (
                  <div className="text-center text-gray-400 py-10">
                      {bagFilter === 'all' ? '背包空空如也' : `暂无${bagFilter === 'pending' ? '待兑现' : bagFilter === 'redeemed' ? '已兑现' : '已撤销'}的物品`}
                  </div>
              )}
          </div>
          )
      )}

      {/* SAVINGS VIEW - 储蓄目标 */}
      {view === 'savings' && (
          <div className="space-y-4">
              {savingsGoals.length > 0 ? (
                  <>
                    {activeSavingsGoals.length > 0 && (
                      <div className="text-xs font-black text-gray-400 px-1">正在储蓄</div>
                    )}
                    {activeSavingsGoals.map(goal => {
                      const target = Number(goal.targetAmount || 0);
                      const current = Number(goal.currentAmount || 0);
                      const percent = target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;
                      const remaining = Math.max(0, target - current);
                      const maxDeposit = Math.max(0, Math.min(Number(childData.coins || 0), remaining || Number(childData.coins || 0)));
                      const customAmount = Math.max(0, Math.floor(Number(customSavingsAmounts[goal.id] || 0)));
                      const safeCustomAmount = Math.min(customAmount, maxDeposit);
                      return (
                        <Card key={goal.id} className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                          <div className="text-center mb-4">
                            <div className="text-5xl mb-2">{goal.icon || '🎯'}</div>
                            <h3 className="font-bold text-xl text-gray-800">{goal.title}</h3>
                            <p className="text-gray-500 text-sm">储蓄目标</p>
                          </div>

                          <div className="mb-4">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-green-600 font-bold">已存 {current}</span>
                              <span className="text-gray-500">目标 {target}</span>
                            </div>
                            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500" style={{ width: `${percent}%` }} />
                            </div>
                            <div className="text-center mt-2">
                              <span className="text-2xl font-black text-green-600">{percent}%</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            {[10, 50, 100].map(amount => {
                              const depositAmount = target > 0 ? Math.min(amount, Math.max(0, target - current)) : amount;
                              return (
                                <button
                                  key={amount}
                                  onClick={() => handleDeposit(goal, amount)}
                                  disabled={depositAmount <= 0 || childData.coins < depositAmount}
                                  className={`py-3 rounded-xl font-bold text-sm transition-all ${
                                    depositAmount > 0 && childData.coins >= depositAmount
                                      ? 'bg-green-500 text-white hover:bg-green-600 active:scale-95'
                                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  }`}
                                >
                                  存入 {depositAmount || amount}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-3 rounded-2xl bg-white/80 border border-emerald-100 p-3">
                            <div className="flex items-center justify-between text-[11px] font-black text-emerald-700 mb-2">
                              <span>自定义存入</span>
                              <span>最多可存 {maxDeposit} 金币</span>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                min={1}
                                max={maxDeposit || undefined}
                                value={customSavingsAmounts[goal.id] || ''}
                                onChange={e => {
                                  const raw = e.target.value;
                                  const next = raw === '' ? '' : String(Math.max(0, Math.floor(Number(raw) || 0)));
                                  setCustomSavingsAmounts(prev => ({ ...prev, [goal.id]: next }));
                                }}
                                placeholder={maxDeposit > 0 ? `1-${maxDeposit}` : '金币不足'}
                                className="min-w-0 flex-1 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-300"
                              />
                              <button
                                type="button"
                                onClick={() => handleDeposit(goal, safeCustomAmount)}
                                disabled={safeCustomAmount <= 0}
                                className={`px-4 rounded-xl text-sm font-black transition-all ${
                                  safeCustomAmount > 0
                                    ? 'bg-emerald-600 text-white active:scale-95'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                存入
                              </button>
                            </div>
                            {customAmount > maxDeposit && maxDeposit > 0 && (
                              <div className="mt-2 text-[11px] font-bold text-orange-600">
                                当前金币或剩余目标不足，将按 {maxDeposit} 金币存入。
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}

                    {completedSavingsGoals.length > 0 && (
                      <div className="text-xs font-black text-gray-400 px-1 pt-2">已完成目标</div>
                    )}
                    {completedSavingsGoals.map(goal => (
                      <Card key={goal.id} className="bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200">
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-3xl shadow-sm">{goal.icon || '🎯'}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-black text-gray-800 truncate">{goal.title}</div>
                            <div className="text-xs text-yellow-700 font-bold mt-1">已存 {goal.currentAmount || 0} / {goal.targetAmount} 金币</div>
                            <div className="text-xs text-gray-500 mt-1">目标保留在这里，奖励已放入背包。</div>
                          </div>
                          <span className="text-2xl">🎉</span>
                        </div>
                      </Card>
                    ))}
                  </>
              ) : (
                  <div className="text-center py-10">
                      <div className="text-5xl mb-4">🎯</div>
                      <p className="text-gray-500">暂无储蓄目标</p>
                      <p className="text-gray-400 text-sm mt-1">让爸爸妈妈帮你设置一个吧~</p>
                  </div>
              )}
          </div>
      )}

      {/* LOTTERY VIEW (Dopamine Style) */}
      {view === 'lottery' && (
          <div className="flex flex-col items-center py-6">
              {/* Title & Decor */}
              <div className="mb-6 text-center animate-bounce-slow">
                  <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-300 to-cyan-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
                      幸运大转盘
                  </h2>
                  <p className="text-purple-200 text-xs mt-1">每次都会有奖品 · 普通奖品最常见</p>
              </div>

              <div className="bg-gradient-to-b from-orange-400 to-red-500 p-4 rounded-[2rem] shadow-[0_10px_30px_rgba(0,0,0,0.5)] border-4 border-yellow-400 relative w-full max-w-[320px] aspect-square mx-auto">
                  {/* Lights */}
                  <div className="absolute inset-0 rounded-[1.8rem] border-2 border-dashed border-yellow-200/50 pointer-events-none"></div>
                  <div className="absolute top-2 left-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping"/>
                  <div className="absolute top-2 right-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-75"/>
                  <div className="absolute bottom-2 left-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-150"/>
                  <div className="absolute bottom-2 right-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-300"/>

                  <div className="grid grid-cols-3 gap-2 h-full mt-1">
                      {/* Top Row: 0, 1, 2 */}
                      {[0, 1, 2].map(i => <GridItem key={i} item={gridPrizes[i]} active={activeGridIndex === i} />)}

                      {/* Middle Row: 7, Button, 3 */}
                      <GridItem item={gridPrizes[7]} active={activeGridIndex === 7} />

                      {/* CENTER BUTTON */}
                      <button
                          onClick={handleLottery}
                          disabled={loading || childData.coins < lotteryInfo.currentCost || (lotteryInfo.remainingDraws ?? 10) <= 0}
                          className="bg-gradient-to-b from-purple-500 to-purple-700 hover:from-purple-400 hover:to-purple-600 active:scale-95 transition-all rounded-xl flex flex-col items-center justify-center shadow-[0_4px_0_#4c1d95] text-white disabled:opacity-80 disabled:grayscale z-20"
                      >
                          <div className="font-black text-xl drop-shadow-md">{(lotteryInfo.remainingDraws ?? 10) <= 0 ? '明天再来' : '抽奖'}</div>
                          <div className="text-[10px] font-bold bg-black/20 px-2 rounded-full mt-1">{lotteryInfo.currentCost}💰</div>
                      </button>

                      <GridItem item={gridPrizes[3]} active={activeGridIndex === 3} />

                      {/* Bottom Row: 6, 5, 4 */}
                      {[6, 5, 4].map(i => <GridItem key={i} item={gridPrizes[i]} active={activeGridIndex === i} />)}
                  </div>
              </div>

              <div className="mt-4 text-center text-white/70 text-xs bg-black/20 px-4 py-2 rounded-full backdrop-blur-sm flex gap-3 divide-x divide-white/20">
                  <span>固定 {lotteryInfo.currentCost}💰/次</span>
                  <span className="pl-3">今日 {lotteryInfo.todayDrawCount}/{lotteryInfo.dailyLimit || 10}</span>
                  <span className="pl-3">剩余 {lotteryInfo.remainingDraws ?? Math.max(0, (lotteryInfo.dailyLimit || 10) - lotteryInfo.todayDrawCount)} 次</span>
              </div>
              <div className="mt-3 w-full max-w-[320px] rounded-2xl bg-white/10 border border-white/10 p-3 text-xs leading-relaxed text-white/75 font-bold">
                只有抽中“再抽一次”才会免费补抽一次；其他奖品都是本次固定金币抽奖的结果。
              </div>

              {/* 保底进度条 */}
              {lotteryInfo.pity && (
                <div className="mt-4 w-full max-w-[320px] space-y-2">
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <span>🎯 稀有保底</span>
                    <span>{lotteryInfo.pity.rareStreak}/10</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${lotteryInfo.pity.rarePityProgress}%` }} />
                  </div>

                  {lotteryInfo.pity.odds && (
                    <div className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80">
                      <div className="font-bold">
                        {lotteryInfo.pity.odds.expectedDrawsForOneEpicOrAbove
                          ? `当前奖池约 ${lotteryInfo.pity.odds.expectedDrawsForOneEpicOrAbove} 抽可能遇到一次史诗/传说。`
                          : '当前奖池还没有史诗/传说奖励。'}
                      </div>
                      <div className="mt-1 text-white/65">
                        {lotteryInfo.pity.epicOrAboveAvailable === false
                          ? '本月大奖机会已用完，接下来会优先遇到稀有及以下奖励。'
                          : lotteryInfo.pity.odds.expectedDrawsToMonthlyEpicOrAboveLimit
                            ? `按这个奖池，约 ${lotteryInfo.pity.odds.expectedDrawsToMonthlyEpicOrAboveLimit} 抽会接近本月大奖上限。`
                            : '普通和优秀奖励会更多，用来保持稳定反馈。'}
                      </div>
                      <div className="mt-1 text-white/65">
                        史诗/传说没有固定次数保底，最多合计每月 {lotteryInfo.pity.monthlyEpicOrAboveLimit || 2} 次。
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
      )}

      {/* PRIVILEGES VIEW - 特权兑换 */}
      {view === 'privileges' && (
          pageLoading ? (
              <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="w-16 h-16 bg-gray-200 rounded-xl animate-pulse" />
                              <div className="space-y-2">
                                  <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
                                  <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                              </div>
                          </div>
                          <div className="h-8 w-16 bg-gray-200 rounded-xl animate-pulse" />
                      </div>
                  ))}
              </div>
          ) : (
          <div className="space-y-6">
              {privileges.length > 0 ? (
                  ['diamond', 'gold', 'silver', 'bronze'].map(level => {
                      const levelPrivs = privileges.filter(p => (p.level || 'bronze') === level);
                      if (levelPrivs.length === 0) return null;

                      const levelConfig: Record<string, { title: string, bg: string, border: string, iconBg: string, label: string }> = {
                          'diamond': { title: '💎 钻石特权', bg: 'bg-gradient-to-br from-cyan-50 to-blue-50', border: 'border-cyan-200', iconBg: 'bg-cyan-100', label: '专属体验' },
                          'gold': { title: '🥇 黄金特权', bg: 'bg-gradient-to-br from-yellow-50 to-orange-50', border: 'border-yellow-200', iconBg: 'bg-yellow-100', label: '重大决定' },
                          'silver': { title: '🥈 白银特权', bg: 'bg-gradient-to-br from-gray-50 to-slate-50', border: 'border-gray-200', iconBg: 'bg-gray-200', label: '周末娱乐' },
                          'bronze': { title: '🥉 青铜特权', bg: 'bg-gradient-to-br from-orange-50 to-amber-50', border: 'border-orange-200', iconBg: 'bg-orange-100', label: '日常自由' },
                      };
                      const conf = levelConfig[level];

                      return (
                          <details key={level} open={level === 'bronze'} className="rounded-3xl border border-white/80 bg-white/70 p-3 space-y-3">
                              <summary className="cursor-pointer list-none flex items-center justify-between px-1">
                                  <h3 className="font-black text-gray-800 text-lg">{conf.title}</h3>
                                  <span className="text-xs font-bold text-gray-500 bg-white px-2 py-1 rounded-lg shadow-sm">{levelPrivs.length}项 · {conf.label}</span>
                              </summary>
                              {levelPrivs.map(priv => (
                                  <Card key={priv.id} className={`${conf.bg} ${conf.border}`}>
                                      <div className="flex justify-between items-center">
                                          <div className="flex items-center gap-3">
                                              <div className={`text-4xl ${conf.iconBg} w-16 h-16 rounded-xl flex items-center justify-center shadow-sm`}>
                                                  {priv.icon || '👑'}
                                              </div>
                                              <div>
                                                  <div className="font-bold text-gray-800 text-lg">{priv.title}</div>
                                                  {priv.description && (
                                                      <div className="text-xs text-gray-600 mt-1">{priv.description}</div>
                                                  )}
                                                  <div className="text-xs text-purple-600 font-bold mt-1">
                                                      {priv.cost} 特权点
                                                  </div>
                                              </div>
                                          </div>
                                          {(() => {
                                            const timeCheck = checkTimeWindow(priv.timeWindow || null);
                                            if (!timeCheck.ok) {
                                              return (
                                                <div className="px-4 py-2 bg-gray-100 text-gray-400 text-xs font-bold rounded-xl flex items-center gap-1">
                                                  <Clock size={12}/> {timeCheck.message}
                                                </div>
                                              );
                                            }
                                            return (
                                              <div className="flex flex-col gap-1">
                                                  <button
                                                      onClick={async () => {
                                                          const ok = await confirm({
                                                              title: '使用特权',
                                                              message: `确定现在使用「${priv.title}」吗？特权用掉就不能退回啦`,
                                                              type: 'warning',
                                                              confirmText: '确定使用',
                                                          });
                                                          if (ok) executeRedeemPrivilege(priv, true);
                                                      }}
                                                      disabled={(childData.privilegePoints || 0) < priv.cost}
                                                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                                                          (childData.privilegePoints || 0) >= priv.cost
                                                              ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md'
                                                              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                      }`}
                                                  >
                                                      ⚡ 立即使用
                                                  </button>
                                                  <button
                                                      onClick={() => executeRedeemPrivilege(priv, false)}
                                                      disabled={(childData.privilegePoints || 0) < priv.cost}
                                                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                                                          (childData.privilegePoints || 0) >= priv.cost
                                                              ? 'bg-white text-purple-600 border border-purple-200 hover:bg-purple-50 shadow-sm'
                                                              : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                                                      }`}
                                                  >
                                                      🎒 存入背包
                                                  </button>
                                              </div>
                                            );
                                          })()}
                                      </div>
                                  </Card>
                              ))}
                          </details>
                      );
                  })
              ) : (
                  <div className="text-center py-10">
                      <div className="text-5xl mb-4">👑</div>
                      <p className="text-gray-500">暂无特权</p>
                      <p className="text-gray-400 text-sm mt-1">让爸爸妈妈帮你设置特权吧~</p>
                  </div>
              )}
          </div>
          )
      )}

      {/* 友情提示弹窗 */}
      <BottomSheet
        isOpen={transferModal.isOpen && Boolean(transferModal.item)}
        onClose={() => setTransferModal({ isOpen: false, item: null })}
        title="转赠物品"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setTransferModal({ isOpen: false, item: null })}
              className="flex-1 py-3 bg-gray-100 text-gray-500 font-black rounded-xl active:scale-95 transition-all"
            >
              取消
            </button>
            <button
              onClick={submitTransfer}
              disabled={!transferTarget || transferLoading}
              className={`flex-[2] py-3 font-black rounded-xl shadow-lg active:scale-95 transition-all ${
                !transferTarget || transferLoading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-purple-200'
              }`}
            >
              {transferLoading ? '转赠中...' : '确认转赠'}
            </button>
          </div>
        }
      >
        {transferModal.item && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-2xl border border-purple-100">
              <div className="text-3xl">{transferModal.item.icon}</div>
              <div>
                <div className="text-xs font-black text-purple-500">准备转赠</div>
                <div className="font-bold text-gray-800">{transferModal.item.title}</div>
              </div>
            </div>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">选择接收人</label>
              <select
                className="w-full p-3 bg-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-4 ring-purple-100 transition-all"
                value={transferTarget}
                onChange={e => setTransferTarget(e.target.value)}
              >
                {familyMembers.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role === 'child' ? '孩子' : '家长'})</option>
                ))}
              </select>
              {familyMembers.length === 0 && (
                <p className="text-xs text-red-500 mt-2">当前家庭没有其他成员</p>
              )}
            </div>
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700 leading-relaxed">
              转赠送出后不能撤回，请确认这个奖励确实想送给对方。
            </div>
          </div>
        )}
      </BottomSheet>

      <TipModal
        isOpen={tipModal.isOpen}
        onClose={() => setTipModal(prev => ({...prev, isOpen: false}))}
        title={tipModal.title}
        message={tipModal.message}
        icon={tipModal.icon}
      />
      <ConfirmDialog />
      <Confetti active={showConfetti} onComplete={() => setShowConfetti(false)} />
    </div>
  );
}

const GridItem = ({ item, active }: { item: any, active: boolean }) => {
    const normalized = item?.effectType === 'draw_again' ? { ...item, title: '再抽一次', icon: '🔄' } : item;
    return (
        <div className={`bg-white rounded-xl flex flex-col items-center justify-center p-1 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] transition-all duration-100 relative overflow-hidden ${active ? 'ring-4 ring-yellow-300 ring-offset-2 ring-offset-orange-500 bg-yellow-50 scale-105 z-10' : ''}`}>
            {active && <div className="absolute inset-0 bg-yellow-200/30 animate-pulse"/>}
            {item?.effectType === 'draw_again' && (
              <div className="absolute top-0 right-0 left-0 text-[9px] font-bold text-amber-600 bg-amber-100/90 rounded-t-xl py-0.5">再抽一次</div>
            )}
            <div className="text-3xl mb-1 filter drop-shadow-sm">{normalized?.icon || '❓'}</div>
            <div className="text-[10px] font-bold text-gray-600 truncate w-full text-center leading-tight">{normalized?.title || '???'}</div>
        </div>
    );
};
