import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ArrowLeft, Check, Clock, HelpCircle, Play, Send, Sparkles } from 'lucide-react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import api, { isAuthError } from '../../services/api';

type Step = {
  id: string;
  title: string;
  minutes: number;
  coins: number;
  xp: number;
  prompt?: string;
};

type Quest = {
  id: string;
  title: string;
  description?: string;
  subject: string;
  questType: string;
  feeling: string;
  resistanceLevel: string;
  icon?: string;
  estimatedMinutes: number;
  totalCoins: number;
  totalXp: number;
  stepCount?: number;
  sessionId?: string;
  sessionStatus?: string;
  currentStepIndex?: number;
  stuckReason?: string;
  steps: Step[];
};

const STUCK_OPTIONS = [
  { label: '不会做', hint: '先圈出题目关键词，再问一个具体问题。' },
  { label: '太多了', hint: '只看当前这一小关，先完成 3 分钟。' },
  { label: '太烦了', hint: '先离开屏幕，喝口水，回来只做第一步。' },
  { label: '怕做错', hint: '今天先奖励尝试，错了也可以改。' },
];

const feelingLabel: Record<string, string> = {
  like: '轻松关',
  normal: '普通关',
  bored: '无聊关',
  afraid: '勇气关',
};

const levelStyle: Record<string, string> = {
  hard: 'from-rose-500 to-orange-500',
  medium: 'from-indigo-500 to-sky-500',
  easy: 'from-emerald-500 to-teal-500',
};

const formatSeconds = (seconds: number) => {
  const value = Math.max(0, seconds);
  const m = Math.floor(value / 60).toString().padStart(2, '0');
  const s = (value % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function ChildLearning() {
  const { refresh } = useOutletContext<any>();
  const toast = useToast();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeQuest, setActiveQuest] = useState<Quest | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [stuckHint, setStuckHint] = useState('');
  const [stuckReason, setStuckReason] = useState('');
  const [proof, setProof] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchQuests = useCallback(async () => {
    try {
      const res = await api.get('/child/learning-quests');
      setQuests(res.data || []);
    } catch (e) {
      if (!isAuthError(e)) toast.error('学习闯关加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchQuests(); }, [fetchQuests]);

  useEffect(() => {
    const handleLayoutRefresh = () => {
      fetchQuests();
    };
    window.addEventListener('starcoin:child-refresh', handleLayoutRefresh);
    return () => window.removeEventListener('starcoin:child-refresh', handleLayoutRefresh);
  }, [fetchQuests]);

  const currentStep = activeQuest?.steps?.[currentStepIndex];
  const progressPercent = useMemo(() => {
    if (!activeQuest?.steps?.length) return 0;
    return Math.round((currentStepIndex / activeQuest.steps.length) * 100);
  }, [activeQuest, currentStepIndex]);

  useEffect(() => {
    if (!currentStep) return;
    setSecondsLeft(Math.max(60, Number(currentStep.minutes || 1) * 60));
    setIsRunning(false);
    setStuckHint('');
  }, [currentStep?.id]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  const startQuest = async (quest: Quest) => {
    if (quest.sessionStatus === 'pending') return toast.info('这个学习关卡已经提交，等待家长确认');
    if (quest.sessionStatus === 'approved') return toast.info('今天已经完成这个学习关卡啦');
    try {
      const res = await api.post(`/child/learning-quests/${quest.id}/start`);
      setActiveQuest(quest);
      setSessionId(res.data.id);
      setCurrentStepIndex(Math.min(Number(res.data.currentStepIndex || 0), Math.max(0, quest.steps.length - 1)));
      setStuckReason(res.data.stuckReason || '');
    } catch (e: any) {
      toast.error(e.response?.data?.message || '启动失败');
    }
  };

  const updateProgress = async (nextIndex: number, reason?: string) => {
    if (!sessionId) return;
    await api.post(`/child/learning-sessions/${sessionId}/progress`, {
      currentStepIndex: nextIndex,
      stuckReason: reason || stuckReason || undefined,
    });
  };

  const completeStep = async () => {
    if (!activeQuest || !currentStep) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < activeQuest.steps.length) {
      setCurrentStepIndex(nextIndex);
      setIsRunning(false);
      await updateProgress(nextIndex);
      toast.success('小关卡完成，继续下一关');
      return;
    }
    toast.success('所有小关卡完成，可以提交啦');
    setIsRunning(false);
  };

  const chooseStuck = async (option: typeof STUCK_OPTIONS[0]) => {
    setStuckReason(option.label);
    setStuckHint(option.hint);
    try {
      await updateProgress(currentStepIndex, option.label);
    } catch { /* 忽略：进度保存失败不打断孩子操作，下次会重试 */ }
  };

  const submitQuest = async () => {
    if (!sessionId || !activeQuest) return;
    setSubmitting(true);
    try {
      await api.post(`/child/learning-sessions/${sessionId}/submit`, { proof, stuckReason });
      toast.success('学习关卡已提交，等待家长确认');
      setActiveQuest(null);
      setSessionId('');
      setProof('');
      setStuckReason('');
      await fetchQuests();
      refresh?.();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const closeRunner = () => {
    setActiveQuest(null);
    setSessionId('');
    setIsRunning(false);
    setProof('');
    setStuckHint('');
  };

  if (activeQuest) {
    const isLastStep = currentStepIndex >= activeQuest.steps.length - 1;
    const allStepsDone = currentStepIndex >= activeQuest.steps.length - 1 && secondsLeft === 0;
    return (
      <div className="p-4 pb-24 min-h-full bg-gradient-to-b from-indigo-50 via-sky-50 to-white">
        <button onClick={closeRunner} className="mb-4 flex items-center gap-2 text-sm font-bold text-indigo-600">
          <ArrowLeft size={18}/> 返回学习闯关
        </button>

        <Card className="bg-white/90 border-indigo-100 shadow-lg space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-100 to-sky-100 flex items-center justify-center text-4xl">{activeQuest.icon || '📚'}</div>
            <div className="flex-1">
              <div className="text-xs font-black text-indigo-500">{activeQuest.subject} · {feelingLabel[activeQuest.feeling] || '学习关'}</div>
              <h2 className="text-xl font-black text-gray-800">{activeQuest.title}</h2>
              <div className="text-xs text-gray-500 mt-1">{activeQuest.description || '先完成当前这一小步。'}</div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
              <span>进度 {currentStepIndex + 1}/{activeQuest.steps.length}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all" style={{ width: `${Math.min(100, progressPercent)}%` }} />
            </div>
          </div>

          {currentStep && (
            <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-sky-500 text-white p-5 text-center shadow-xl shadow-indigo-200">
              <div className="text-xs font-bold opacity-80 mb-1">当前小关卡</div>
              <div className="text-2xl font-black mb-3">{currentStep.title}</div>
              <div className="text-6xl font-black tabular-nums mb-3">{formatSeconds(secondsLeft)}</div>
              <div className="text-xs opacity-90">{currentStep.prompt || '只做当前这一小步，完成就很棒。'}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => setIsRunning(!isRunning)} className="py-3 bg-indigo-500 border-none">
              {isRunning ? <Clock size={18}/> : <Play size={18}/>} {isRunning ? '暂停' : '开始'}
            </Button>
            <Button onClick={completeStep} className="py-3 bg-green-500 border-none">
              <Check size={18}/> {isLastStep ? '完成最后一关' : '完成本关'}
            </Button>
          </div>

          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-100">
            <div className="flex items-center gap-2 text-sm font-black text-amber-700 mb-2"><HelpCircle size={16}/> 我卡住了</div>
            <div className="grid grid-cols-2 gap-2">
              {STUCK_OPTIONS.map(option => (
                <button key={option.label} onClick={() => chooseStuck(option)} className={`py-2 rounded-xl text-xs font-bold border ${stuckReason === option.label ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-700 border-amber-100'}`}>
                  {option.label}
                </button>
              ))}
            </div>
            {stuckHint && <div className="mt-2 text-xs text-amber-700 bg-white rounded-xl p-2">{stuckHint}</div>}
          </div>

          {isLastStep && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500">提交证明（可写一句话，口头/书面作业都可）</label>
              <textarea value={proof} onChange={e => setProof(e.target.value)} className="w-full p-3 rounded-2xl border bg-gray-50 text-sm outline-none min-h-[84px]" placeholder="例如：完成第1-6题；背给妈妈听了；阅读到第20页。" />
              <Button onClick={submitQuest} disabled={submitting} className="w-full py-4 bg-gradient-to-r from-yellow-400 to-orange-500 border-none">
                <Send size={18}/> {submitting ? '提交中...' : `提交闯关 +${activeQuest.totalCoins}金币 +${activeQuest.totalXp}经验`}
              </Button>
              {!allStepsDone && <div className="text-[10px] text-gray-400 text-center">倒计时结束前也可以提交，家长会根据完成情况确认。</div>}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 min-h-full bg-gradient-to-b from-indigo-50 via-sky-50 to-white">
      <div className="mb-4 rounded-3xl p-5 text-white bg-gradient-to-br from-indigo-600 to-sky-500 shadow-xl shadow-indigo-200">
        <div className="flex items-center gap-3">
          <div className="text-5xl">🗺️</div>
          <div>
            <div className="text-xs font-bold opacity-80">今日学习闯关</div>
            <h1 className="text-2xl font-black">一关一关来</h1>
            <p className="text-xs opacity-90 mt-1">害怕也没关系，先开始最小一步。</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-8">学习闯关加载中...</div>
      ) : quests.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-6xl mb-3">📚</div>
          <div className="font-black text-gray-700">还没有学习关卡</div>
          <div className="text-xs text-gray-400 mt-1">请家长在“学习闯关”里创建关卡。</div>
        </Card>
      ) : (
        <div className="space-y-3">
          {quests.map((quest, index) => {
            const status = quest.sessionStatus;
            const done = status === 'approved';
            const pending = status === 'pending';
            const gradient = levelStyle[quest.resistanceLevel] || levelStyle.medium;
            return (
              <Card key={quest.id} className="relative overflow-hidden">
                <div className={`absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-b ${gradient}`} />
                <div className="flex items-center gap-3 pl-2">
                  <div className="w-14 h-14 rounded-3xl bg-indigo-50 flex items-center justify-center text-3xl shadow-inner">{quest.icon || '📚'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-black">第 {index + 1} 站</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-black">{feelingLabel[quest.feeling] || '学习关'}</span>
                    </div>
                    <div className="font-black text-gray-800 truncate">{quest.title}</div>
                    <div className="text-xs text-gray-500 truncate">{quest.subject} · {quest.stepCount || quest.steps?.length || 0}关 · 约{quest.estimatedMinutes}分钟</div>
                    <div className="flex gap-1 mt-1">
                      <span className="text-[10px] text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">💰{quest.totalCoins}</span>
                      <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">⭐{quest.totalXp}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => startQuest(quest)}
                    disabled={pending || done}
                    className={`px-3 py-2 rounded-2xl text-xs font-black text-white shadow-lg ${done ? 'bg-green-400' : pending ? 'bg-orange-400' : 'bg-indigo-500 active:scale-95'}`}
                  >
                    {done ? '已完成' : pending ? '待确认' : quest.sessionStatus === 'in_progress' ? '继续' : '开始'}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4 p-3 rounded-2xl bg-white/80 border border-sky-100 text-xs text-gray-500 flex items-start gap-2">
        <Sparkles size={16} className="text-sky-500 flex-shrink-0 mt-0.5" />
        <span>学习闯关奖励的是“开始、尝试、求助和完成”。不会的时候点“我卡住了”，这也算在练习学习能力。</span>
      </div>
    </div>
  );
}
