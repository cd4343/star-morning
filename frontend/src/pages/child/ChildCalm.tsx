import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Check, Gamepad2, HeartPulse, Play, RotateCcw, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import api, { isAuthError } from '../../services/api';

type EmotionScene = {
  id: string;
  icon: string;
  title: string;
  color: string;
  actions: string[];
};

type ScreenTimeSummary = {
  rules: {
    isEnabled: number;
    ticketMinutes: number;
    cooldownMinutes: number;
  };
  dailyBaseMinutes: number;
  dailyMaxMinutes: number;
  earnedMinutes: number;
  todayUsed: number;
  allowance: number;
  balance: number;
  breakdown?: {
    base: number;
    studySaved: number;
    morningStartup: number;
    morningStreak: number;
  };
  activeSession?: {
    id: string;
    plannedMinutes: number;
    startedAt: string;
  } | null;
  cooldown?: {
    cooldownMinutes: number;
    isCoolingDown: boolean;
    minutesUntilNext: number;
    lastEndedAt?: string | null;
  };
  window: {
    start: string;
    end: string;
    isAllowed: boolean;
    beijingTime: string;
  };
};

const SCENES: EmotionScene[] = [
  {
    id: 'itch',
    icon: '🧊',
    title: '身体很痒',
    color: 'from-cyan-500 to-blue-500',
    actions: ['冰一下或按压10秒', '涂药/找家长', '手放膝盖深呼吸'],
  },
  {
    id: 'angry',
    icon: '🔥',
    title: '我很急很气',
    color: 'from-rose-500 to-orange-500',
    actions: ['离开现场喝水', '攥拳松开5次', '说出我需要暂停'],
  },
  {
    id: 'study',
    icon: '📚',
    title: '不想学习',
    color: 'from-indigo-500 to-violet-500',
    actions: ['只做3分钟第一步', '先读题不动笔', '把不会的圈出来'],
  },
  {
    id: 'wake',
    icon: '🌤️',
    title: '起不来床',
    color: 'from-amber-400 to-orange-500',
    actions: ['坐起来数10下', '喝一口水', '完成穿衣第一步'],
  },
  {
    id: 'game',
    icon: '🎮',
    title: '很想玩手机',
    color: 'from-emerald-500 to-teal-500',
    actions: ['先看游戏票余额', '等3分钟再决定', '换一个短休息'],
  },
  {
    id: 'tired',
    icon: '🌙',
    title: '太累了',
    color: 'from-slate-500 to-blue-500',
    actions: ['闭眼休息30秒', '伸展肩膀', '告诉家长我累了'],
  },
];

const INTENSITIES = [
  { id: 'low', label: '小波动' },
  { id: 'medium', label: '有点难' },
  { id: 'high', label: '很难受' },
];

const parseStartedAt = (value: string) => {
  if (!value) return Date.now();
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : Date.now();
};

const formatSeconds = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60).toString().padStart(2, '0');
  const s = (safe % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function ChildCalm() {
  const { refresh } = useOutletContext<any>();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [summary, setSummary] = useState<ScreenTimeSummary | null>(null);
  const [selectedScene, setSelectedScene] = useState<EmotionScene | null>(SCENES[0]);
  const [intensity, setIntensity] = useState('medium');
  const [selectedAction, setSelectedAction] = useState('');
  const [calmSeconds, setCalmSeconds] = useState(30);
  const [calmRunning, setCalmRunning] = useState(false);
  const [savingEmotion, setSavingEmotion] = useState(false);
  const [ticketMinutes, setTicketMinutes] = useState(10);
  const [gameSecondsLeft, setGameSecondsLeft] = useState(0);
  const [loadingTicket, setLoadingTicket] = useState(false);
  const [activePanel, setActivePanel] = useState<'calm' | 'ticket'>('calm');

  const fetchScreenTime = async () => {
    const res = await api.get('/child/screen-time');
    setSummary(res.data);
    setTicketMinutes(Number(res.data?.rules?.ticketMinutes || 10));
  };

  useEffect(() => {
    fetchScreenTime().catch((e) => {
      if (!isAuthError(e)) toast.error('游戏票加载失败');
    });
  }, []);

  useEffect(() => {
    if (!calmRunning) return;
    const timer = setInterval(() => setCalmSeconds(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [calmRunning]);

  useEffect(() => {
    if (!summary?.activeSession) {
      setGameSecondsLeft(0);
      return;
    }
    const update = () => {
      const startedAt = parseStartedAt(summary.activeSession!.startedAt);
      const total = Number(summary.activeSession!.plannedMinutes || 0) * 60;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setGameSecondsLeft(Math.max(0, total - elapsed));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [summary?.activeSession?.id]);

  const ticketOptions = useMemo(() => {
    const base = Number(summary?.rules?.ticketMinutes || 10);
    return Array.from(new Set([5, base, 10, 15, 20])).filter(v => v > 0 && v <= 60);
  }, [summary?.rules?.ticketMinutes]);
  const isCoolingDown = Boolean(summary?.cooldown?.isCoolingDown);

  const chooseScene = (scene: EmotionScene) => {
    setSelectedScene(scene);
    setSelectedAction(scene.actions[0] || '');
    setCalmSeconds(30);
    setCalmRunning(false);
  };

  useEffect(() => {
    if (selectedScene && !selectedAction) setSelectedAction(selectedScene.actions[0] || '');
  }, [selectedScene, selectedAction]);

  const saveEmotion = async (helped: boolean) => {
    if (!selectedScene) return;
    setSavingEmotion(true);
    try {
      const res = await api.post('/child/emotion-checkins', {
        scene: selectedScene.id,
        intensity,
        action: selectedAction,
        helped,
      });
      const xpAwarded = Number(res.data?.xpAwarded || 0);
      if (xpAwarded > 0) {
        toast.success(res.data?.message || `冷静练习已记录，经验 +${xpAwarded}`);
      } else {
        toast.info(res.data?.message || '冷静练习已记录，本次不重复加经验');
      }
      setCalmRunning(false);
      setCalmSeconds(30);
      refresh?.();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '记录失败');
    } finally {
      setSavingEmotion(false);
    }
  };

  const startScreenTime = async () => {
    setLoadingTicket(true);
    try {
      const res = await api.post('/child/screen-time/start', { minutes: ticketMinutes });
      setSummary(res.data);
      toast.success('游戏票已开始');
    } catch (e: any) {
      toast.error(e.response?.data?.message || '游戏票启动失败');
    } finally {
      setLoadingTicket(false);
    }
  };

  const finishScreenTime = async (status: 'completed' | 'cancelled' = 'completed') => {
    if (!summary?.activeSession) return;
    setLoadingTicket(true);
    try {
      const res = await api.post(`/child/screen-time/sessions/${summary.activeSession.id}/finish`, { status });
      setSummary(res.data);
      toast.success('游戏时间已结束，分钟数已计入今日使用');
    } catch (e: any) {
      toast.error(e.response?.data?.message || '操作失败');
    } finally {
      setLoadingTicket(false);
    }
  };

  const activeScene = selectedScene || SCENES[0];
  const backTo = (location.state as any)?.backTo || '/child/challenge';
  const backLabel = (location.state as any)?.backLabel || '返回上一页';

  return (
    <div className="p-4 pb-24 min-h-full bg-gradient-to-b from-sky-50 via-white to-emerald-50 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-2 rounded-2xl bg-white border border-sky-100 px-3 py-2 text-sm font-black text-sky-700 shadow-sm active:scale-[0.98]"
        >
          <ArrowLeft size={17} /> {backLabel}
        </button>
        {summary?.activeSession && (
          <button
            type="button"
            onClick={() => setActivePanel('ticket')}
            className="rounded-2xl bg-slate-900 text-white px-3 py-2 text-xs font-black shadow-lg"
          >
            游戏中 {formatSeconds(gameSecondsLeft)}
          </button>
        )}
      </div>

      <div className="rounded-[1.7rem] bg-gradient-to-br from-sky-500 to-emerald-500 text-white p-4 shadow-lg shadow-sky-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-white/80">
              <HeartPulse size={16} /> 冷静能量站
            </div>
            <div className="text-2xl font-black mt-1">先稳住，再闯关</div>
            <div className="text-xs font-bold text-white/80 mt-1">先选感受，再选动作，最后记录有没有帮助。</div>
          </div>
          <div className="w-16 h-16 rounded-3xl bg-white/15 flex flex-col items-center justify-center flex-shrink-0">
            <div className="text-xl font-black">{summary?.balance ?? 0}</div>
            <div className="text-[10px] font-bold text-white/75">游戏票</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1 shadow-sm border border-slate-100">
        {[
          { key: 'calm' as const, label: '稳住一下', icon: <HeartPulse size={16} /> },
          { key: 'ticket' as const, label: '游戏票', icon: <Gamepad2 size={16} /> },
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActivePanel(tab.key)}
            className={`rounded-xl py-2.5 text-xs font-black flex items-center justify-center gap-1.5 ${
              activePanel === tab.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activePanel === 'calm' ? (
        <Card className="space-y-3 border-sky-100 shadow-lg">
          <div className="grid grid-cols-3 gap-2">
            {SCENES.map(scene => (
              <button
                key={scene.id}
                onClick={() => chooseScene(scene)}
                className={`rounded-2xl p-2 border text-center transition-all ${
                  activeScene.id === scene.id ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-100 bg-slate-50'
                }`}
              >
                <div className={`mx-auto w-10 h-10 rounded-2xl bg-gradient-to-br ${scene.color} flex items-center justify-center text-xl shadow-sm`}>
                  {scene.icon}
                </div>
                <div className="mt-1 text-[11px] font-black text-slate-700 truncate">{scene.title}</div>
              </button>
            ))}
          </div>

          <div className="rounded-3xl bg-gradient-to-br from-white to-sky-50 border border-sky-100 p-3">
            <div className="flex items-center gap-3">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${activeScene.color} flex items-center justify-center text-3xl`}>
                {activeScene.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black text-sky-500">现在的感觉</div>
                <h2 className="text-xl font-black text-gray-800 truncate">{activeScene.title}</h2>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black text-slate-400">倒计时</div>
                <div className="text-2xl font-mono font-black text-sky-600 tabular-nums">{formatSeconds(calmSeconds)}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-3">
              {INTENSITIES.map(item => (
                <button
                  key={item.id}
                  onClick={() => setIntensity(item.id)}
                  className={`py-2 rounded-xl text-xs font-black border ${
                    intensity === item.id ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-gray-600 border-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button onClick={() => setCalmRunning(prev => !prev)} className="bg-sky-500 border-none">
                {calmRunning ? <Timer size={18} /> : <Play size={18} />} {calmRunning ? '暂停' : '开始'}
              </Button>
              <Button onClick={() => { setCalmSeconds(30); setCalmRunning(false); }} variant="secondary">
                <RotateCcw size={18} /> 重来
              </Button>
            </div>
          </div>

          <div>
            <div className="text-xs font-black text-gray-500 mb-2">选一个现在能做的动作</div>
            <div className="grid gap-2">
              {activeScene.actions.map(action => (
                <button
                  key={action}
                  onClick={() => setSelectedAction(action)}
                  className={`w-full flex items-center gap-2 p-2.5 rounded-2xl border text-left text-sm font-bold ${
                    selectedAction === action ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-700'
                  }`}
                >
                  <ShieldCheck size={17} />
                  <span className="line-clamp-1">{action}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => saveEmotion(false)} loading={savingEmotion} variant="secondary">
              <Check size={18} /> 做到了
            </Button>
            <Button onClick={() => saveEmotion(true)} loading={savingEmotion} className="bg-emerald-500 border-none">
              <Sparkles size={18} /> 有帮助
            </Button>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-2.5 text-[11px] leading-relaxed text-slate-500 font-bold">
            每天最多前 3 次冷静记录给经验，间隔至少 10 分钟；之后仍会记录，但不重复刷经验。
          </div>
        </Card>
      ) : (
        <Card className="space-y-3 border-emerald-100 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                <Gamepad2 size={24} />
              </div>
              <div>
                <div className="text-xs font-black text-emerald-500">可用游戏票</div>
                <h2 className="text-2xl font-black text-gray-800">{summary?.balance ?? 0} 分钟</h2>
              </div>
            </div>
            <div className="text-right text-xs text-gray-500 font-bold">
              <div>已用 {summary?.todayUsed ?? 0} 分钟</div>
              <div>{summary?.window?.start || '--'}-{summary?.window?.end || '--'}</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-lg font-black text-gray-800">{summary?.dailyBaseMinutes ?? summary?.breakdown?.base ?? 0}</div>
              <div className="text-[10px] text-gray-400 font-bold">基础</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-lg font-black text-gray-800">{summary?.earnedMinutes ?? 0}</div>
              <div className="text-[10px] text-gray-400 font-bold">额外获得</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-lg font-black text-gray-800">{summary?.todayUsed ?? 0}</div>
              <div className="text-[10px] text-gray-400 font-bold">已用</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-lg font-black text-gray-800">{summary?.dailyMaxMinutes ?? 0}</div>
              <div className="text-[10px] text-gray-400 font-bold">上限</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px] font-black">
            <div className="rounded-xl bg-sky-50 text-sky-600 px-2 py-2 text-center">学习 +{summary?.breakdown?.studySaved ?? 0}</div>
            <div className="rounded-xl bg-amber-50 text-amber-600 px-2 py-2 text-center">早晨 +{(summary?.breakdown?.morningStartup ?? 0) + (summary?.breakdown?.morningStreak ?? 0)}</div>
            <div className="rounded-xl bg-slate-50 text-slate-500 px-2 py-2 text-center">现在 {summary?.window?.beijingTime || '--'}</div>
          </div>

          {summary?.activeSession && (
            <div className="rounded-2xl bg-slate-900 text-white p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Gamepad2 size={22} />
              </div>
              <div className="flex-1">
                <div className="text-xs text-white/60 font-bold">游戏票进行中</div>
                <div className="text-2xl font-black tabular-nums">{formatSeconds(gameSecondsLeft)}</div>
              </div>
              <button onClick={() => finishScreenTime('completed')} className="px-3 py-2 rounded-xl bg-white text-gray-900 text-xs font-black">
                结束
              </button>
            </div>
          )}

          <div className="grid grid-cols-5 gap-2">
            {ticketOptions.map(minutes => (
              <button
                key={minutes}
                onClick={() => setTicketMinutes(minutes)}
                disabled={minutes > (summary?.balance || 0) || Boolean(summary?.activeSession) || isCoolingDown}
                className={`py-2 rounded-xl text-xs font-black border disabled:opacity-40 ${
                  ticketMinutes === minutes ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {minutes}分
              </button>
            ))}
          </div>

          {summary?.window && !summary.window.isAllowed && (
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700">
              当前不在游戏票可用时间内，先把票留住。
            </div>
          )}

          {isCoolingDown && (
            <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3 text-xs font-bold text-sky-700">
              游戏票正在冷却，还需要约 {summary?.cooldown?.minutesUntilNext || 1} 分钟。
            </div>
          )}

          {summary?.activeSession ? (
            <Button onClick={() => finishScreenTime('completed')} loading={loadingTicket} className="w-full py-4 bg-emerald-500 border-none">
              <Check size={18} /> 结束并记录
            </Button>
          ) : (
            <Button
              onClick={startScreenTime}
              loading={loadingTicket}
              disabled={!summary?.window?.isAllowed || ticketMinutes > (summary?.balance || 0) || isCoolingDown}
              className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 border-none"
            >
              <Play size={18} /> {isCoolingDown ? `冷却中 ${summary?.cooldown?.minutesUntilNext || 1} 分钟` : `开始使用 ${ticketMinutes} 分钟`}
            </Button>
          )}

          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-2.5 text-[11px] leading-relaxed text-emerald-700 font-bold">
            游戏票当天有效。学习任务节省的分钟、家长发放和部分奖励会增加游戏票，开始使用后按本次分钟扣除。
          </div>
        </Card>
      )}
    </div>
  );
}
