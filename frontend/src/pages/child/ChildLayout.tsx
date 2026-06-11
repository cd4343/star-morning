import { useEffect, useState, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CheckSquare, ChevronDown, Compass, Gift, HeartPulse, User, ShieldCheck, AlertCircle, Utensils } from 'lucide-react';
import api, { isAuthError } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { InputModal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import PullToRefresh from '../../components/PullToRefresh';
import { GlobalTimerBar } from '../../components/GlobalTimerBar';
import LevelUpModal from '../../components/LevelUpModal';
import { getLevelTitle } from '../../utils/levelPerks';

export default function ChildLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token, login } = useAuth();
  const toast = useToast();
  const [childData, setChildData] = useState<any>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showDefaultPinHint, setShowDefaultPinHint] = useState(false);
  const [showPinChangeReminder, setShowPinChangeReminder] = useState(false);
  const [taskReminders, setTaskReminders] = useState<any[]>([]);
  // R3: 升级庆祝弹窗要展示的新等级（null = 不显示）
  const [levelUpCelebration, setLevelUpCelebration] = useState<number | null>(null);
  // M18: 顶栏进度详情默认收起，展开偏好记在本地
  const [headerExpanded, setHeaderExpanded] = useState(() => {
    try { return localStorage.getItem('starcoin:headerExpanded') === '1'; } catch { return false; }
  });
  const retryCount = useRef(0);
  const lastDataErrorAt = useRef(0);
  const previousUserId = useRef<string | null>(null);
  const lastSeenReviewAt = useRef<string>(''); // B3-5: 上次看到的审核时间
  const MAX_RETRIES = 3;

  const fetchData = useCallback(async () => {
    if (!token || !user) return;
    try {
      const res = await api.get('/child/dashboard');
      // 验证返回的数据是否与当前用户匹配
      if (res.data.child && user && res.data.child.id !== user.id) {
        console.warn('Child data mismatch, refetching...');
        // 数据不匹配，可能是缓存问题，限制重试次数
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current++;
          setTimeout(fetchData, 500);
          return;
        }
      }
      retryCount.current = 0;
      setChildData(res.data.child);

      // R3: 升级检测——本地基线 starcoin:lastLevel:<userId>，先更新记录再弹窗，30 秒轮询不会重复触发
      if (res.data.child) {
        const currentLevel = Number(res.data.child.level) || (Math.floor((Number(res.data.child.xp) || 0) / 100) + 1);
        const levelStorageKey = `starcoin:lastLevel:${user.id}`;
        try {
          const storedLevel = localStorage.getItem(levelStorageKey);
          if (storedLevel === null) {
            // 首次没有本地记录：只写入基线，不弹窗
            localStorage.setItem(levelStorageKey, String(currentLevel));
          } else if (currentLevel > Number(storedLevel)) {
            localStorage.setItem(levelStorageKey, String(currentLevel));
            setLevelUpCelebration(currentLevel); // 一次跨多级也只弹最新等级
          }
        } catch { /* 忽略：本地存储不可用 */ }
      }

      // B3-5: 检测新的审核结果（通过+打回），显示即时通知；基线持久化，应用重开也不漏
      if (res.data.recentReviews?.length > 0) {
        const latestReviewAt = res.data.recentReviews[0]?.reviewedAt;
        const storageKey = `starcoin:lastSeenReviewAt:${user.id}`;
        const lastSeen = lastSeenReviewAt.current || localStorage.getItem(storageKey) || '';
        if (lastSeen && latestReviewAt > lastSeen) {
          const newReviews = res.data.recentReviews.filter(
            (r: any) => r.reviewedAt > lastSeen
          );
          const approvedNew = newReviews.filter((r: any) => r.status === 'approved');
          const rejectedNew = newReviews.filter((r: any) => r.status === 'rejected');
          if (approvedNew.length > 0) {
            const totalCoins = approvedNew.reduce((sum: number, r: any) => sum + (r.earnedCoins || 0), 0);
            const totalXp = approvedNew.reduce((sum: number, r: any) => sum + (r.earnedXp || 0), 0);
            toast.showToast(`🌟 审核通过！获得 ${totalCoins} 金币 + ${totalXp} 经验`, 'success', 5000);
          }
          // 打回不是失败，是修复机会：告诉孩子原因和下一步
          rejectedNew.slice(0, 2).forEach((r: any) => {
            toast.showToast(
              `💬 「${r.taskTitle}」需要再试一次：${r.reviewNote || '问问爸爸妈妈哪里可以改进'}`,
              'info', 8000
            );
          });
        }
        lastSeenReviewAt.current = latestReviewAt;
        try { localStorage.setItem(storageKey, latestReviewAt); } catch { /* 忽略：本地存储不可用 */ }
      }

      try {
        const reminderRes = await api.get('/child/task-session-reminders');
        setTaskReminders(reminderRes.data || []);
      } catch (reminderErr) {
        console.error('task reminders load failed:', reminderErr);
      }
    } catch (e) {
      console.error(e);
      if (isAuthError(e)) return;
      const now = Date.now();
      if (now - lastDataErrorAt.current > 15000) {
        toast.error('加载数据失败，请下拉刷新');
        lastDataErrorAt.current = now;
      }
    }
  }, [token, user, toast]);

  const refreshChildPage = useCallback(async () => {
    await fetchData();
    window.dispatchEvent(new CustomEvent('starcoin:child-refresh'));
  }, [fetchData]);

  // 当用户或路径变化时重新获取数据
  useEffect(() => {
    // 清除旧数据，避免显示上一个用户的信息
    const userId = user?.id || null;
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      setChildData(null);
    }
    retryCount.current = 0;
    fetchData();
  }, [location.pathname, user?.id, fetchData]);

  // 定时轮询刷新数据（每 30 秒）
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleHeaderExpanded = () => {
    setHeaderExpanded(prev => {
      const next = !prev;
      try { localStorage.setItem('starcoin:headerExpanded', next ? '1' : '0'); } catch { /* 忽略：本地存储不可用 */ }
      return next;
    });
  };

  const handleSwitchUser = () => {
      // 先提示需要家长 PIN，再进入输入弹窗
      setShowDefaultPinHint(true);
  };
  
  const handleContinueToPin = () => {
      setShowDefaultPinHint(false);
      setShowPinModal(true);
  };

  const handlePinConfirm = async (pin: string) => {
      try {
          const res = await api.post('/child/switch-to-parent', { pin });
          login(res.data.token, res.data.user);
          
          // 如果使用的是默认PIN，提醒修改
          if (res.data.isDefaultPin) {
              setShowPinChangeReminder(true);
          } else {
              navigate('/parent/dashboard');
          }
      } catch (e: any) {
          toast.error(e.response?.data?.message || 'PIN 码错误');
      }
  };
  
  const handlePinChangeReminderClose = () => {
      setShowPinChangeReminder(false);
      navigate('/parent/dashboard');
  };

  const currentTaskReminder = taskReminders[0];
  const markTaskReminderRead = async () => {
      if (!currentTaskReminder) return;
      try {
          await api.post(`/child/task-session-reminders/${currentTaskReminder.id}/read`);
      } catch (err) {
          console.error('task reminder dismiss failed:', err);
      }
      setTaskReminders(prev => prev.slice(1));
      window.dispatchEvent(new CustomEvent('starcoin:child-refresh'));
  };

  return (
    <div className="min-h-screen bg-gray-200 md:flex md:items-center md:justify-center md:p-6">
      {/* PC Device Frame Container */}
      <div
        data-child-app-frame="true"
        className="w-full h-screen md:h-[850px] md:max-w-md bg-gray-50 flex flex-col md:rounded-[2.5rem] md:shadow-2xl md:border-[8px] md:border-gray-900 overflow-hidden relative"
      >
          
          {/* Top Bar */}
          <div className="bg-white p-3 shadow-sm z-10 sticky top-0">
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={toggleHeaderExpanded}
                aria-expanded={headerExpanded}
                aria-label={headerExpanded ? '收起成长进度' : '查看成长进度'}
                className="flex items-center gap-3 min-h-[40px] text-left rounded-2xl active:bg-gray-50 transition-colors"
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl border-2 border-white shadow-sm ${childData?.gender === 'girl' ? 'bg-pink-100' : 'bg-green-100'}`}>
                   {childData?.avatar || (childData?.gender === 'girl' ? '👧' : '👦')}
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-sm flex items-center gap-2">
                    {childData?.name || 'Loading...'}
                    <span className="text-[10px] bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                      Lv.{childData?.level || 1}
                    </span>
                    <span className="text-[10px] text-indigo-400 font-bold whitespace-nowrap">
                      {getLevelTitle(childData?.level || 1)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 flex gap-3 font-mono">
                     <span className="flex items-center gap-0.5"><span className="text-yellow-500">🪙</span><span className="text-yellow-600 font-bold">{childData?.coins || 0}</span><span className="text-[10px] text-gray-400 ml-0.5">金币</span></span>
                     <span className="flex items-center gap-0.5"><span className="text-blue-500">💎</span><span className="text-blue-600 font-bold">{childData?.privilegePoints || 0}</span><span className="text-[10px] text-gray-400 ml-0.5">特权点</span></span>
                  </div>
                </div>
                <ChevronDown size={16} className={`text-gray-300 transition-transform duration-200 ${headerExpanded ? 'rotate-180' : ''}`} />
              </button>
              <button onClick={handleSwitchUser} className="px-3 py-2 min-h-[40px] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full text-blue-600 transition-colors flex items-center gap-1.5 text-xs font-bold">
                  <ShieldCheck size={14}/> 家长模式
              </button>
            </div>
            
            {headerExpanded && (<>
            {/* 经验进度条 */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-purple-500 font-bold whitespace-nowrap">经验</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-400 to-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(((childData?.xp || 0) % (childData?.maxXp || 100)) / (childData?.maxXp || 100) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                {(childData?.xp || 0) % (childData?.maxXp || 100)}/{childData?.maxXp || 100}
              </span>
            </div>

            {/* 特权点进度条 */}
            {(() => {
              // 任务/学习审核经验每累计 100 点自动兑换 1 个特权点；抽奖经验只用于等级成长。
              const rewardXpTotal = childData?.rewardXpTotal || 0;
              const xpInCurrentCycle = rewardXpTotal % 100;
              const xpNeeded = 100 - xpInCurrentCycle;
              const progressPercent = Math.min((xpInCurrentCycle / 100) * 100, 100);
              const privPoints = childData?.privilegePoints || 0;
              return (
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blue-500 font-bold whitespace-nowrap">特权进度</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden" title="任务和学习审核经验每100点=1特权点；抽奖经验只用于等级">
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-indigo-400 rounded-full transition-all duration-700"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className={`text-[9px] font-bold whitespace-nowrap ${xpInCurrentCycle >= 80 ? 'text-blue-600 animate-pulse' : 'text-gray-500'}`}>
                      {xpInCurrentCycle}/100
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-gray-400 font-medium">
                    <span>任务/学习经验 100 = 1 特权点</span>
                    <span>{privPoints} 点 · 还差 {xpNeeded === 100 ? 100 : xpNeeded} 点</span>
                  </div>
                </div>
              );
            })()}
            </>)}
          </div>

          {/* Main Content */}
          <PullToRefresh
            data-child-main-viewport="true"
            onRefresh={refreshChildPage}
            className="flex-1 min-h-0 pb-20 scrollbar-hide"
          >
            <Outlet context={{ childData, refresh: fetchData }} />
          </PullToRefresh>

          <div
            data-child-overlay-root="true"
            className="absolute inset-0 pointer-events-none z-[60]"
          />

          {/* 跨页面「挑战进行中」浮窗：挑战页有自带的完整版，避免重复渲染 */}
          {!location.pathname.startsWith('/child/challenge') && <GlobalTimerBar />}

          {currentTaskReminder && (
            <div className="absolute inset-0 z-[70] bg-slate-900/45 backdrop-blur-sm flex items-end px-4 pb-24">
              <div className="w-full rounded-3xl bg-white shadow-2xl border border-slate-100 p-5">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-2xl">
                    {currentTaskReminder.icon || '⏰'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-amber-600">任务已自动收尾</div>
                    <div className="mt-1 font-black text-slate-900 truncate">{currentTaskReminder.title}</div>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                      昨天开始后没有点“完成”，系统已按常规时长提交给家长确认。下次完成后记得点一下完成按钮。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={markTaskReminderRead}
                  className="mt-4 w-full rounded-2xl bg-slate-900 text-white py-3 font-black active:scale-[0.99]"
                >
                  知道了
                </button>
              </div>
            </div>
          )}

          {/* Bottom Nav - 支持安全区域 */}
          {!location.pathname.includes('calm') && (
            <button
              type="button"
              onClick={() => navigate('/child/calm', { state: { backTo: `${location.pathname}${location.search}`, backLabel: '返回上一页' } })}
              className="absolute right-4 bottom-[5.6rem] z-30 w-14 h-14 rounded-full shadow-xl shadow-cyan-200/60 border-2 border-white flex flex-col items-center justify-center text-[10px] font-black transition-transform active:scale-95 bg-gradient-to-br from-cyan-400 to-blue-500 text-white"
              aria-label="打开冷静"
            >
              <HeartPulse size={20} />
              冷静
            </button>
          )}

          <div className="bg-white/90 backdrop-blur-md border-t absolute bottom-0 w-full grid grid-cols-5 px-2 py-3 text-xs text-gray-400 font-medium z-20 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-3">
            <NavLink onClick={() => navigate('/child/challenge')} icon={<CheckSquare size={22}/>} label="挑战" active={['challenge', 'tasks', 'learning'].some(path => location.pathname.includes(path)) || location.pathname === '/child'} />
            <NavLink onClick={() => navigate('/child/morning')} icon={<Utensils size={22}/>} label="早餐" active={location.pathname.includes('morning')} />
            <NavLink onClick={() => navigate('/child/explore')} icon={<Compass size={22}/>} label="探索" active={location.pathname.includes('explore')} />
            <NavLink onClick={() => navigate('/child/wishes')} icon={<Gift size={22}/>} label="奖励" active={location.pathname.includes('wishes')} />
            <NavLink onClick={() => navigate('/child/me')} icon={<User size={22}/>} label="我的" active={location.pathname.includes('me')} />
          </div>
      </div>

      {/* R3: 升级庆祝弹窗（纯展示，不影响任何功能） */}
      {levelUpCelebration !== null && (
        <LevelUpModal level={levelUpCelebration} onClose={() => setLevelUpCelebration(null)} />
      )}

      {/* 家长 PIN 提示弹窗 - 支持安全区域 */}
      {showDefaultPinHint && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 overflow-y-auto" style={{ maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">切换到家长模式</h3>
              <p className="text-gray-600 mb-2">需要输入家长 PIN 码才能切换</p>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                <p className="text-blue-800 text-sm font-medium">请让家长输入已经设置的安全 PIN。</p>
                <p className="text-blue-600 text-xs mt-1">如果还没有设置，请家长先登录账号并到家庭管理中设置。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDefaultPinHint(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-all">
                  取消
                </button>
                <button onClick={handleContinueToPin} className="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all">
                  继续
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIN 输入弹窗 */}
      <InputModal 
          isOpen={showPinModal}
          onClose={() => setShowPinModal(false)}
          onConfirm={handlePinConfirm}
          title="切换到家长模式"
          placeholder="请输入家长 PIN 码"
          type="password"
      />
      
      {/* 修改PIN码提醒弹窗 - 支持安全区域 */}
      {showPinChangeReminder && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 overflow-y-auto" style={{ maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}>
            <div className="text-center">
              <div className="text-5xl mb-3">🔐</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">安全提醒</h3>
              <p className="text-gray-600 mb-4">
                您正在使用默认 PIN 码 (1234)，<br/>
                建议尽快到「家庭管理」中修改为个人专属 PIN 码，<br/>
                以防止孩子随意切换到家长模式。
              </p>
              <button onClick={handlePinChangeReminderClose} className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95">
                知道了，进入家长模式
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const NavLink = ({ icon, label, active, onClick }: any) => (
  <div onClick={onClick} className={`flex flex-col items-center gap-1 cursor-pointer transition-all duration-200 ${active ? 'text-blue-600 scale-105 font-bold' : 'hover:text-gray-600'}`}>
    {icon}
    <span>{label}</span>
  </div>
);
