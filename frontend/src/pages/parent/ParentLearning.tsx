import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Sparkles, Trash2, X } from 'lucide-react';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { BottomSheet } from '../../components/BottomSheet';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { CreateActionCard } from '../../components/CreateActionCard';
import api from '../../services/api';

type LearningStep = {
  title: string;
  minutes: number;
  coins: number;
  xp: number;
  prompt: string;
};

type LearningTemplate = {
  title: string;
  subject: string;
  questType: string;
  feeling: string;
  resistanceLevel: string;
  icon: string;
  description: string;
  focus: string;
  gradeNote: string;
  steps: LearningStep[];
};

const SUBJECTS = ['语文', '数学', '英语', '阅读', '复习', '综合'];
const QUEST_TYPES = [
  { value: 'written', label: '书面作业' },
  { value: 'oral', label: '口头背诵' },
  { value: 'reading', label: '阅读' },
  { value: 'review', label: '复习预习' },
];
const FEELINGS = [
  { value: 'like', label: '感兴趣', hint: '多给探索感' },
  { value: 'normal', label: '普通', hint: '保持稳定反馈' },
  { value: 'bored', label: '无聊', hint: '拆短一点' },
  { value: 'afraid', label: '害怕', hint: '奖励启动和求助' },
];
const RESISTANCE_LEVELS = [
  { value: 'easy', label: '低阻力' },
  { value: 'medium', label: '中阻力' },
  { value: 'hard', label: '高阻力' },
];

const TEMPLATES: LearningTemplate[] = [
  {
    title: '口算闪电 8 分钟',
    subject: '数学',
    questType: 'written',
    feeling: 'bored',
    resistanceLevel: 'medium',
    icon: '🧮',
    description: '适合口算、竖式或计算订正。',
    focus: '短时启动',
    gradeNote: '先做少量题，正确率比速度更重要。',
    steps: [
      { title: '准备草稿纸和铅笔', minutes: 1, coins: 1, xp: 1, prompt: '先把工具放好，完成准备就算第一关。' },
      { title: '完成 5 道口算', minutes: 4, coins: 3, xp: 5, prompt: '只做 5 道，先追求写下来。' },
      { title: '圈出 1 道要检查的题', minutes: 2, coins: 2, xp: 4, prompt: '只检查一题，找到一个容易错的地方。' },
      { title: '给自己打星', minutes: 1, coins: 1, xp: 2, prompt: '完成就给自己一颗启动星。' },
    ],
  },
  {
    title: '应用题三步拆解',
    subject: '数学',
    questType: 'written',
    feeling: 'afraid',
    resistanceLevel: 'hard',
    icon: '📐',
    description: '把应用题拆成读题、找数、列式。',
    focus: '降低害怕',
    gradeNote: '卡住时允许只完成读题和画线，不把不会做当失败。',
    steps: [
      { title: '读题并画关键词', minutes: 3, coins: 2, xp: 4, prompt: '圈出“求什么”和关键数字。' },
      { title: '写出已知条件', minutes: 3, coins: 2, xp: 4, prompt: '把能看到的数字写下来，不急着算。' },
      { title: '尝试列一个式子', minutes: 4, coins: 3, xp: 6, prompt: '只要写出一个可能的式子，卡住可以求助。' },
      { title: '说一句解题思路', minutes: 2, coins: 2, xp: 4, prompt: '用一句话说：我是怎么想的。' },
    ],
  },
  {
    title: '课文朗读接力',
    subject: '语文',
    questType: 'oral',
    feeling: 'normal',
    resistanceLevel: 'medium',
    icon: '📖',
    description: '朗读、圈词、复述，适合语文课文预习。',
    focus: '语文表达',
    gradeNote: '每一小段都有结束点，减少“看不到头”的压力。',
    steps: [
      { title: '读第一自然段', minutes: 3, coins: 2, xp: 4, prompt: '只读一段，读顺就可以。' },
      { title: '圈出 2 个生字词', minutes: 2, coins: 2, xp: 4, prompt: '找两个不熟的词，圈出来就是进步。' },
      { title: '再读一小段', minutes: 3, coins: 2, xp: 4, prompt: '声音不用大，保持读完。' },
      { title: '复述一句内容', minutes: 2, coins: 2, xp: 5, prompt: '用自己的话说一句：这一段讲了什么。' },
    ],
  },
  {
    title: '阅读侦探',
    subject: '阅读',
    questType: 'reading',
    feeling: 'like',
    resistanceLevel: 'easy',
    icon: '🕵️',
    description: '阅读理解用找线索替代长时间硬坐。',
    focus: '阅读理解',
    gradeNote: '把理解任务游戏化，读短一点但要有发现。',
    steps: [
      { title: '读一页或一小段', minutes: 4, coins: 2, xp: 5, prompt: '只读这一小段，读完就停。' },
      { title: '找出人物或地点', minutes: 2, coins: 2, xp: 4, prompt: '像侦探一样找一个线索。' },
      { title: '说出发生了什么', minutes: 3, coins: 2, xp: 5, prompt: '用一句话说出来，不用写长答案。' },
      { title: '给故事选一个表情', minutes: 1, coins: 1, xp: 2, prompt: '开心、惊讶、紧张，选一个就好。' },
    ],
  },
  {
    title: '英语单词卡片',
    subject: '英语',
    questType: 'oral',
    feeling: 'bored',
    resistanceLevel: 'medium',
    icon: '🔤',
    description: '把单词记忆拆成看、读、遮、说。',
    focus: '轻量记忆',
    gradeNote: '短轮次复现更稳，不建议一次背太多。',
    steps: [
      { title: '看 5 个单词', minutes: 2, coins: 1, xp: 3, prompt: '先看，不要求马上记住。' },
      { title: '跟读 2 遍', minutes: 3, coins: 2, xp: 5, prompt: '读出来，声音小也可以。' },
      { title: '遮住中文说 3 个', minutes: 3, coins: 3, xp: 6, prompt: '说出 3 个就通过，忘了可以看一眼。' },
      { title: '选一个最熟的单词', minutes: 1, coins: 1, xp: 2, prompt: '挑一个今天最熟的单词。' },
    ],
  },
  {
    title: '错题小修理',
    subject: '复习',
    questType: 'review',
    feeling: 'afraid',
    resistanceLevel: 'hard',
    icon: '🔧',
    description: '只修一题，降低订正压力。',
    focus: '复盘订正',
    gradeNote: '订正先聚焦一个具体错误，降低压力。',
    steps: [
      { title: '选 1 道错题', minutes: 2, coins: 1, xp: 3, prompt: '今天只选一题，不是一整页。' },
      { title: '找出错在哪里', minutes: 3, coins: 2, xp: 5, prompt: '是看错、算错，还是不会？选一个原因。' },
      { title: '重做一遍', minutes: 5, coins: 4, xp: 8, prompt: '只重做这一题，卡住可以求助。' },
      { title: '写一句提醒', minutes: 2, coins: 2, xp: 4, prompt: '写一句下次提醒自己的话。' },
    ],
  },
  {
    title: '作业启动站',
    subject: '综合',
    questType: 'written',
    feeling: 'afraid',
    resistanceLevel: 'hard',
    icon: '🚉',
    description: '不知道先做什么时，用它启动第一步。',
    focus: '执行功能',
    gradeNote: '目标不是完成全部作业，而是帮孩子跨过启动门槛。',
    steps: [
      { title: '列出今天 2 件作业', minutes: 2, coins: 1, xp: 3, prompt: '只写两件，写不全也没关系。' },
      { title: '选最容易的一件', minutes: 1, coins: 1, xp: 2, prompt: '先选最容易开始的。' },
      { title: '做 5 分钟', minutes: 5, coins: 4, xp: 7, prompt: '只做 5 分钟，到了就可以停下来确认。' },
      { title: '决定继续或休息', minutes: 1, coins: 1, xp: 2, prompt: '做完后选：继续 5 分钟，或休息一下。' },
    ],
  },
  {
    title: '背诵分段挑战',
    subject: '语文',
    questType: 'oral',
    feeling: 'bored',
    resistanceLevel: 'medium',
    icon: '🎙️',
    description: '适合古诗、课文片段和英语短句。',
    focus: '分段背诵',
    gradeNote: '允许看提示，先完成“说出来”，再追求流利。',
    steps: [
      { title: '读 2 遍目标句', minutes: 3, coins: 2, xp: 4, prompt: '先读熟，不要求马上背。' },
      { title: '遮住一半试背', minutes: 3, coins: 2, xp: 5, prompt: '遮住一半，记得多少说多少。' },
      { title: '完整试背一次', minutes: 4, coins: 3, xp: 7, prompt: '允许停顿，先完整走一遍。' },
      { title: '给家长或录音确认', minutes: 2, coins: 2, xp: 4, prompt: '录音也可以，完成提交。' },
    ],
  },
];

const emptyStep = (): LearningStep => ({ title: '新的小关卡', minutes: 5, coins: 2, xp: 4, prompt: '' });

const normalizeQuestTitle = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export default function ParentLearning() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [quests, setQuests] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('数学');
  const [questType, setQuestType] = useState('written');
  const [feeling, setFeeling] = useState('normal');
  const [resistanceLevel, setResistanceLevel] = useState('medium');
  const [icon, setIcon] = useState('📚');
  const [steps, setSteps] = useState<LearningStep[]>([emptyStep(), emptyStep()]);

  const totalCoins = steps.reduce((sum, step) => sum + Number(step.coins || 0), 0);
  const totalXp = steps.reduce((sum, step) => sum + Number(step.xp || 0), 0);
  const totalMinutes = steps.reduce((sum, step) => sum + Number(step.minutes || 0), 0);
  const titleAlreadyExists = Boolean(normalizeQuestTitle(title)) && quests.some(quest =>
    Number(quest.isActive) !== 0 && normalizeQuestTitle(quest.title) === normalizeQuestTitle(title)
  );

  const hasActiveQuest = (questTitle: string) => quests.some(quest =>
    Number(quest.isActive) !== 0 && normalizeQuestTitle(quest.title) === normalizeQuestTitle(questTitle)
  );

  const fetchData = async () => {
    try {
      const [questRes, sessionRes] = await Promise.all([
        api.get('/parent/learning-quests'),
        api.get('/parent/learning-sessions?status=pending'),
      ]);
      setQuests(questRes.data || []);
      setSessions(sessionRes.data || []);
    } catch (e) {
      toast.error('学习闯关数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSubject('数学');
    setQuestType('written');
    setFeeling('normal');
    setResistanceLevel('medium');
    setIcon('📚');
    setSteps([emptyStep(), emptyStep()]);
  };

  const applyTemplate = (tpl: LearningTemplate) => {
    setTitle(tpl.title);
    setDescription(tpl.description);
    setSubject(tpl.subject);
    setQuestType(tpl.questType);
    setFeeling(tpl.feeling);
    setResistanceLevel(tpl.resistanceLevel);
    setIcon(tpl.icon);
    setSteps(tpl.steps.map(step => ({ ...step })));
  };

  const openBlankSheet = () => {
    resetForm();
    setShowAdd(true);
  };

  const openTemplateSheet = (tpl: LearningTemplate) => {
    if (hasActiveQuest(tpl.title)) {
      toast.info('这个学习关卡已经添加过了');
      return;
    }
    resetForm();
    applyTemplate(tpl);
    setShowAdd(true);
  };

  const updateStep = (index: number, patch: Partial<LearningStep>) => {
    setSteps(prev => prev.map((step, i) => i === index ? { ...step, ...patch } : step));
  };

  const saveQuest = async () => {
    if (!title.trim()) return toast.warning('请输入关卡名称');
    if (titleAlreadyExists) return toast.warning('这个学习关卡已经添加过了');
    if (steps.some(step => !step.title.trim())) return toast.warning('每个小关卡都需要名称');
    try {
      await api.post('/parent/learning-quests', {
        title,
        description,
        subject,
        questType,
        feeling,
        resistanceLevel,
        icon,
        estimatedMinutes: totalMinutes,
        steps,
      });
      toast.success('学习关卡已创建');
      setShowAdd(false);
      resetForm();
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    }
  };

  const stopQuest = async (quest: any) => {
    const ok = await confirm({
      title: '停用学习关卡',
      message: `确定停用「${quest.title}」吗？已有记录不会删除。`,
      type: 'warning',
      confirmText: '停用',
      cancelText: '取消',
    });
    if (!ok) return;
    await api.delete(`/parent/learning-quests/${quest.id}`);
    toast.success('已停用');
    fetchData();
  };

  const reviewSession = async (session: any, action: 'approve' | 'reject') => {
    try {
      const res = await api.post(`/parent/learning-sessions/${session.id}/review`, {
        action,
        finalCoins: session.totalCoins,
        finalXp: session.totalXp,
      });
      const awarded = Number(res.data?.gameTicketMinutesAwarded || 0);
      const capped = Number(res.data?.gameTicketMinutesCapped || 0);
      const requested = Number(res.data?.gameTicketMinutesRequested || res.data?.gameTicketGrant?.requestedMinutes || 0);
      const ticketText = awarded > 0
        ? `，学习节省 +${awarded} 分钟游戏票${capped > 0 ? `，${capped} 分钟因今日上限未发放` : ''}`
        : capped > 0
          ? `，学习节省已记录，但今日游戏时间已满，${capped} 分钟未发放`
          : requested > 0
            ? '，符合游戏票规则，但暂无可发放分钟'
            : '';
      toast.success(action === 'approve' ? `学习关卡已通过${ticketText}` : '已打回');
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '处理失败');
    }
  };

  return (
    <Layout>
      <Header title="学习闯关" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 pb-20 space-y-4 overflow-y-auto flex-1">
        <CreateActionCard
          icon="🗺️"
          title="学习闯关规则"
          description="把作业拆成 3-10 分钟的小关卡。短轮次、明确结束点和可求助提示，会比一次做很久更容易启动。"
          primaryLabel="🗺️ 新建学习关卡"
          onPrimary={openBlankSheet}
          primaryClassName="bg-indigo-600 border-none"
          tone="from-indigo-50 to-sky-50 border-indigo-100"
        />

        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-black text-gray-900">低阻力学习模板</div>
              <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                每个模板都控制在小步、短时、能看见结束点。建议先选一个低阻力模板试运行，再按孩子当天状态微调。
              </div>
            </div>
            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full whitespace-nowrap">
              {TEMPLATES.length} 个
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {TEMPLATES.slice(0, 5).map(tpl => {
              const duplicated = hasActiveQuest(tpl.title);
              return (
                <button
                  key={tpl.title}
                  type="button"
                  disabled={duplicated}
                  onClick={() => openTemplateSheet(tpl)}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    duplicated
                      ? 'bg-gray-100 border-gray-100 opacity-60 cursor-not-allowed'
                      : 'bg-gray-50 border-gray-100 hover:bg-indigo-50 hover:border-indigo-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-2xl shadow-sm">{tpl.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-gray-900 truncate">{tpl.title}</div>
                      <div className="text-[10px] text-gray-500 truncate">{tpl.subject} · {tpl.focus} · {tpl.steps.length} 步 · {tpl.steps.reduce((sum, step) => sum + Number(step.minutes || 0), 0)} 分钟</div>
                    </div>
                    {duplicated ? (
                      <span className="text-[10px] font-black text-gray-400 bg-white px-2 py-1 rounded-full">已添加</span>
                    ) : (
                      <Sparkles size={16} className="text-indigo-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">{tpl.gradeNote}</div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={openBlankSheet}
            className="w-full rounded-xl bg-white border border-indigo-100 text-indigo-600 text-xs font-black py-2"
          >
            打开完整模板列表
          </button>
        </Card>

        {sessions.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-gray-400 px-1">待确认学习提交</div>
            {sessions.map(session => (
              <Card key={session.id} className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-2xl">{session.icon || '📚'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black truncate">{session.title}</div>
                    <div className="text-xs text-gray-500">{session.childName} · {session.subject} · {new Date(session.submittedAt || session.startedAt).toLocaleString()}</div>
                    {session.stuckReason && <div className="text-[10px] text-orange-600 mt-1">卡住原因：{session.stuckReason}</div>}
                    {session.proof && <div className="text-[10px] text-gray-500 mt-1 line-clamp-2">证明：{session.proof}</div>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => reviewSession(session, 'approve')} className="flex-1 bg-green-500 border-none"><Check size={14}/> 通过 +{session.totalCoins}金币</Button>
                  <Button size="sm" variant="ghost" onClick={() => reviewSession(session, 'reject')} className="flex-1 text-red-600">打回</Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-gray-400 px-1">已配置关卡</div>
          </div>
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : quests.length === 0 ? (
            <Card className="text-center py-8">
              <div className="text-5xl mb-3">📚</div>
              <div className="font-bold text-gray-700">还没有学习关卡</div>
              <p className="text-xs text-gray-400 mt-1">先从模板创建一个数学、背诵或阅读关卡。</p>
            </Card>
          ) : quests.map(quest => (
            <Card key={quest.id} className={`flex items-center gap-3 ${quest.isActive ? '' : 'opacity-50'}`}>
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-sky-100 flex items-center justify-center text-2xl">{quest.icon || '📚'}</div>
              <div className="flex-1 min-w-0">
                <div className="font-black truncate">{quest.title}</div>
                <div className="text-xs text-gray-500 truncate">{quest.subject} · {quest.stepCount || quest.steps?.length || 0} 关 · {quest.estimatedMinutes} 分钟</div>
                <div className="flex gap-1 mt-1">
                  <span className="text-[10px] bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">💰{quest.totalCoins}</span>
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">⭐{quest.totalXp}</span>
                  {quest.pendingCount > 0 && <span className="text-[10px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">{quest.pendingCount} 待审</span>}
                </div>
              </div>
              {quest.isActive ? (
                <button onClick={() => stopQuest(quest)} className="p-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
              ) : <span className="text-xs text-gray-400">已停用</span>}
            </Card>
          ))}
        </div>
      </div>

      <BottomSheet
        isOpen={showAdd}
        onClose={() => { setShowAdd(false); resetForm(); }}
        title="🗺️ 新建学习关卡"
        footer={
          <div className="flex gap-3">
            <Button onClick={saveQuest} disabled={titleAlreadyExists} className="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-sky-500 border-none">保存关卡</Button>
            <Button variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-2">模板</label>
            <div className="grid grid-cols-1 gap-2">
              {TEMPLATES.map(tpl => {
                const duplicated = hasActiveQuest(tpl.title);
                return (
                  <button
                    key={tpl.title}
                    type="button"
                    disabled={duplicated}
                    onClick={() => applyTemplate(tpl)}
                    className={`p-3 rounded-xl border text-left flex items-center gap-3 ${
                      duplicated ? 'bg-gray-100 text-gray-400 opacity-60 cursor-not-allowed' : 'bg-white'
                    }`}
                  >
                    <span className="text-2xl">{tpl.icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-black">{tpl.title}</div>
                      <div className="text-[10px] text-gray-400">{tpl.subject} · {tpl.focus} · {tpl.steps.length} 步</div>
                      <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{duplicated ? '已添加，不能重复创建同名关卡。' : tpl.description}</div>
                    </div>
                    {duplicated ? (
                      <span className="ml-auto text-[10px] font-black text-gray-400 bg-white px-2 py-1 rounded-full">已添加</span>
                    ) : (
                      <Sparkles size={14} className="ml-auto text-indigo-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-16">
              <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
              <input value={icon} onChange={e => setIcon(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50 text-center text-xl" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">关卡名称</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50 outline-none" placeholder="例如：数学作业闯关" />
              {titleAlreadyExists && (
                <div className="mt-1 text-[10px] font-bold text-orange-600">这个学习关卡已经添加过了，不能重复创建。</div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">说明</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50 outline-none" placeholder="孩子看到的简短鼓励语" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">学科</label>
              <select value={subject} onChange={e => setSubject(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50">{SUBJECTS.map(s => <option key={s}>{s}</option>)}</select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">类型</label>
              <select value={questType} onChange={e => setQuestType(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50">{QUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">孩子感受</label>
              <select value={feeling} onChange={e => setFeeling(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50">{FEELINGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">阻力等级</label>
              <select value={resistanceLevel} onChange={e => setResistanceLevel(e.target.value)} className="w-full p-2.5 rounded-xl border bg-gray-50">{RESISTANCE_LEVELS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-800">
            <div className="font-black mb-1">当前建议</div>
            <div>{FEELINGS.find(f => f.value === feeling)?.hint}。总计约 {totalMinutes} 分钟，建议奖励 {totalCoins} 金币 / {totalXp} 经验。</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500 font-bold">小关卡步骤</label>
              <button type="button" onClick={() => setSteps([...steps, emptyStep()])} className="text-xs font-bold text-indigo-600">添加一步</button>
            </div>
            {steps.map((step, index) => (
              <div key={index} className="p-3 rounded-xl border bg-gray-50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black">{index + 1}</span>
                  <input value={step.title} onChange={e => updateStep(index, { title: e.target.value })} className="flex-1 p-2 rounded-lg border bg-white text-sm" />
                  {steps.length > 1 && <button type="button" onClick={() => setSteps(steps.filter((_, i) => i !== index))} className="p-1 text-red-400"><X size={16}/></button>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={step.minutes} onChange={e => updateStep(index, { minutes: Number(e.target.value) })} className="p-2 rounded-lg border bg-white text-sm" placeholder="分钟" />
                  <input type="number" value={step.coins} onChange={e => updateStep(index, { coins: Number(e.target.value) })} className="p-2 rounded-lg border bg-white text-sm" placeholder="金币" />
                  <input type="number" value={step.xp} onChange={e => updateStep(index, { xp: Number(e.target.value) })} className="p-2 rounded-lg border bg-white text-sm" placeholder="经验" />
                </div>
                <input value={step.prompt} onChange={e => updateStep(index, { prompt: e.target.value })} className="w-full p-2 rounded-lg border bg-white text-sm" placeholder="提示语：卡住时给孩子看的下一步" />
              </div>
            ))}
          </div>
        </div>
      </BottomSheet>
      <ConfirmDialog />
    </Layout>
  );
}
