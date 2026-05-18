import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Brain, Calculator, Coins, Lightbulb, RefreshCw, Sparkles, Star } from 'lucide-react';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import api from '../../services/api';

const defaults = {
  category: '学习',
  minutes: 15,
  difficulty: 'normal',
  resistance: 'medium',
  independence: 'reminded',
  quality: 'complete',
  estimatedRmb: 0,
};

const labelMaps: Record<string, Record<string, string>> = {
  difficulty: { easy: '简单', normal: '普通', hard: '困难', challenge: '挑战' },
  resistance: { low: '低抗拒', medium: '普通', high: '高抗拒', crisis: '情绪阻力高' },
  independence: { assisted: '陪伴完成', reminded: '提醒后做', independent: '独立完成', proactive: '主动完成' },
  quality: { try: '愿意尝试', complete: '完成要求', good: '认真完成', excellent: '超预期' },
};

export default function ParentRulesInsights() {
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'rules' | 'insights'>('rules');
  const [assistant, setAssistant] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [form, setForm] = useState<any>(defaults);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const fetchData = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [assistantRes, insightsRes] = await Promise.all([
        api.get('/parent/rules-assistant-v2'),
        api.get('/parent/growth-insights?days=14'),
      ]);
      setAssistant(assistantRes.data);
      setInsights(insightsRes.data);
      if (!suggestion) {
        const suggestRes = await api.post('/parent/rules-assistant-v2/suggest', defaults);
        setSuggestion(suggestRes.data);
      }
      if (silent) toast.success('洞察数据已更新');
    } catch (e) {
      toast.error('规则与洞察加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const updateForm = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  const calculate = async () => {
    setSuggesting(true);
    try {
      const res = await api.post('/parent/rules-assistant-v2/suggest', form);
      setSuggestion(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || '计算失败');
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <Layout>
      <Header title="规则与洞察" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 pb-20 space-y-4 overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('rules')}
            className={`py-2 rounded-xl text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'rules' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <Calculator size={16} /> 规则助手
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`py-2 rounded-xl text-sm font-black flex items-center justify-center gap-2 ${activeTab === 'insights' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <BarChart3 size={16} /> 成长洞察
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">加载中...</div>
        ) : activeTab === 'rules' ? (
          <RulesTab
            assistant={assistant}
            form={form}
            suggestion={suggestion}
            suggesting={suggesting}
            updateForm={updateForm}
            calculate={calculate}
          />
        ) : (
          <InsightsTab insights={insights} refresh={() => fetchData(true)} refreshing={refreshing} />
        )}
      </div>
    </Layout>
  );
}

function RulesTab({ assistant, form, suggestion, suggesting, updateForm, calculate }: any) {
  const categories = assistant?.categories || [];
  const isActivityMode = form.category === '运动' || form.category === '活动';
  const isEmotionMode = form.category === '情绪调节';
  const isBreakfastMode = form.category === '早餐选择';
  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white text-blue-600 flex items-center justify-center shadow-sm">
            <Brain size={25} />
          </div>
          <div>
            <div className="font-black text-gray-800">分类化奖励公式</div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              不同类别不只按时间算。学习看启动和质量，运动看参与和连续，情绪调节看是否使用替代动作，早餐主要是消费选择权。
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="font-black text-gray-800 flex items-center gap-2">
          <Calculator size={18} className="text-blue-600" /> 推荐值计算
        </div>
        <Field label="任务类别">
          <select value={form.category} onChange={e => updateForm('category', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50">
            {categories.map((cat: any) => <option key={cat.name} value={cat.name}>{cat.icon} {cat.name}</option>)}
          </select>
        </Field>
        {isBreakfastMode ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 space-y-3">
            <div>
              <div className="text-sm font-black text-amber-800">早餐只计算升级选择权</div>
              <div className="mt-1 text-xs font-bold leading-relaxed text-amber-700">
                基础早餐建议免费。这里把“想升级的早餐大约值多少钱”换算成金币参考，具体早餐项仍在「早餐小厨房」里设置。
              </div>
            </div>
            <Field label="升级早餐参考人民币">
              <input type="number" min={0} value={form.estimatedRmb} onChange={e => updateForm('estimatedRmb', Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-xl border bg-white" />
            </Field>
          </div>
        ) : (
          <Field label={isActivityMode ? (form.category === '运动' ? '参与量/组数' : '活动段数') : isEmotionMode ? '练习步骤/次数' : '预计分钟'}>
            <input type="number" min={1} value={form.minutes} onChange={e => updateForm('minutes', Number(e.target.value) || 1)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
          </Field>
        )}
        {isActivityMode && (
          <div className="rounded-2xl bg-green-50 border border-green-100 p-3 text-xs font-bold text-green-700 leading-relaxed">
            运动和活动使用“参与模式”：按参与完整、动作/过程质量、是否需要提醒来估算，不按分钟数越长奖励越高。
          </div>
        )}
        {isEmotionMode && (
          <div className="rounded-2xl bg-pink-50 border border-pink-100 p-3 text-xs font-bold text-pink-700 leading-relaxed">
            情绪调节可以作为任务分类，也可以在孩子端「冷静」里单独记录。建议少金币、多经验和认可，重点看有没有识别感受、使用替代动作、恢复后表达。
          </div>
        )}
        {!isBreakfastMode && (
          <>
            <OptionGrid label="难度" field="difficulty" value={form.difficulty} updateForm={updateForm} />
            <OptionGrid label="抗拒度" field="resistance" value={form.resistance} updateForm={updateForm} />
            <OptionGrid label="独立度" field="independence" value={form.independence} updateForm={updateForm} />
            <OptionGrid label="质量" field="quality" value={form.quality} updateForm={updateForm} />
          </>
        )}
        <Button onClick={calculate} loading={suggesting} className="w-full bg-blue-600 border-none">
          <Sparkles size={18} /> 重新计算推荐
        </Button>
      </Card>

      {suggestion && (
        <Card className="space-y-4 border-blue-100 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="font-black text-gray-800">推荐结果</div>
            <div className="text-xs font-black text-blue-600">{suggestion.rule?.icon} {suggestion.category}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="金币" value={suggestion.coins} icon={<Coins size={18} />} color="text-yellow-600" />
            <Metric label="经验" value={suggestion.xp} icon={<Star size={18} />} color="text-blue-600" />
            <Metric label="特权点" value={suggestion.privilegePoints} icon={<Sparkles size={18} />} color="text-purple-600" />
          </div>
          {suggestion.breakfastCost !== null && (
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-sm font-bold text-amber-700">
              早餐升级参考价：{suggestion.breakfastCost} 金币。基础早餐仍建议免费。
            </div>
          )}
          <div className="space-y-2">
            {suggestion.explanation?.map((line: string, index: number) => (
              <div key={index} className="flex gap-2 text-xs text-gray-600 leading-relaxed">
                <Lightbulb size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <div className="text-xs font-bold text-gray-400 px-1">分类规则说明</div>
        {categories.map((cat: any) => (
          <Card key={cat.name} className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl">{cat.icon}</div>
            <div className="flex-1">
              <div className="font-black text-gray-800">{cat.name}</div>
              <div className="text-xs text-gray-500 mt-1">重点：{cat.focus}</div>
              <div className="text-xs text-blue-600 font-bold mt-1">{cat.advice}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function InsightsTab({ insights, refresh, refreshing }: any) {
  const overview = insights?.overview || {};
  const summaryCards = overview.summaryCards || [];
  const taskSummary = insights?.tasks?.summary || {};
  const taskCategoryStats = insights?.tasks?.categoryStats || [];
  const taskChildStats = insights?.tasks?.childStats || [];
  const punishments = insights?.punishments?.summary || {};
  const punishmentReasons = insights?.punishments?.reasons || [];
  const rewards = insights?.rewards || {};

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-emerald-50 to-sky-50 border-emerald-100">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white text-emerald-600 flex items-center justify-center shadow-sm">
            <BarChart3 size={25} />
          </div>
          <div className="flex-1">
            <div className="font-black text-gray-800">近 {insights?.days || 14} 天洞察</div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              这里把学习、情绪、早餐、游戏票和金币流向放在一起看，帮助判断规则是否过重或过轻。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="mt-4 w-full rounded-2xl bg-white text-emerald-700 border border-emerald-100 py-2.5 text-sm font-black flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '正在更新' : '更新洞察数据'}
        </button>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-black text-gray-800">总览想回答什么</div>
            <div className="text-xs text-gray-500 mt-1 leading-relaxed">{overview.purpose}</div>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center text-emerald-600 flex-shrink-0">
            <div className="text-xl font-black">{overview.balanceScore ?? '-'}</div>
            <div className="text-[10px] font-bold">平衡分</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(overview.focus || []).map((line: string, index: number) => (
            <div key={index} className="rounded-xl bg-gray-50 p-3 text-xs font-bold text-gray-600 leading-relaxed">{line}</div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        {summaryCards.length > 0 ? summaryCards.map((card: any) => (
          <MetricCard key={card.key} label={card.label} value={`${card.value}${card.suffix || ''}`} tone={card.tone} />
        )) : (
          <>
            <MetricCard label="任务收入" value={insights?.economy?.earnedCoins || 0} tone="yellow" />
            <MetricCard label="金币净变化" value={insights?.economy?.netCoins || 0} tone="blue" />
          </>
        )}
      </div>

      <Card className="space-y-2">
        <div className="font-black text-gray-800 flex items-center gap-2">
          <Lightbulb size={18} className="text-amber-500" /> 建议
        </div>
        {(insights?.recommendations || []).map((item: string, index: number) => (
          <div key={index} className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 font-bold leading-relaxed">
            {item}
          </div>
        ))}
      </Card>

      <Section title="任务启动与完成">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="提交" value={taskSummary.submittedCount || 0} tone="blue" />
          <MetricCard label="通过" value={taskSummary.approvedCount || 0} tone="green" />
          <MetricCard label="打回" value={taskSummary.rejectedCount || 0} tone="red" />
        </div>
        {taskChildStats.length === 0 ? (
          <EmptyText text="还没有任务提交记录。" />
        ) : taskChildStats.map((row: any) => (
          <MiniRow key={row.childId} label={row.childName} value={`启动 ${row.activeDays || 0} 天 / 通过 ${row.approvedCount || 0}`} />
        ))}
      </Section>

      <Section title="任务类别分布">
        {taskCategoryStats.length === 0 ? (
          <EmptyText text="有任务完成后，这里会显示学习、运动、劳动、兴趣的分布。" />
        ) : taskCategoryStats.map((row: any) => (
          <MiniRow key={row.category} label={row.category || '未分类'} value={`提交 ${row.submittedCount || 0} / 通过 ${row.approvedCount || 0}`} />
        ))}
      </Section>

      <Section title="奖励与获得感">
        <MiniRow label="即时宝箱" value={`${rewards.chest?.totalCount || 0} 次`} />
        <MiniRow label="成就解锁" value={`${rewards.achievements?.unlockedCount || 0} 次`} />
        <MiniRow label="特权兑换" value={`${rewards.privileges?.redeemedCount || 0} 次`} />
        <MiniRow label="储蓄目标" value={`${rewards.savings?.completedGoals || 0} 已完成 / ${rewards.savings?.activeGoals || 0} 进行中`} />
      </Section>

      <Section title="规则压力">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="惩罚次数" value={punishments.totalCount || 0} tone={(punishments.totalCount || 0) > 0 ? 'orange' : 'green'} />
          <MetricCard label="高风险" value={punishments.highCount || 0} tone={(punishments.highCount || 0) > 0 ? 'red' : 'green'} />
          <MetricCard label="扣除金币" value={punishments.deductedCoins || 0} tone="red" />
        </div>
        {punishmentReasons.length === 0 ? (
          <EmptyText text="近期没有惩罚记录，这是很好的信号。" />
        ) : punishmentReasons.map((row: any, index: number) => (
          <MiniRow key={`${row.reason}-${row.level}-${index}`} label={row.reason} value={`${row.count} 次 / 扣 ${row.deductedCoins || 0}`} />
        ))}
      </Section>

      <Section title="学习卡住点">
        {(insights?.learning?.stuckReasons || []).length === 0 ? (
          <EmptyText text="近期开启学习闯关后，还没有明显卡住记录。" />
        ) : insights.learning.stuckReasons.map((row: any) => (
          <MiniRow key={row.stuckReason} label={row.stuckReason} value={`${row.count} 次`} />
        ))}
      </Section>

      <Section title="高摩擦学习关卡">
        {(insights?.learning?.frictionQuests || []).length === 0 ? (
          <EmptyText text="暂时没有高摩擦学习关卡。" />
        ) : insights.learning.frictionQuests.map((row: any) => (
          <MiniRow key={row.id} label={`${row.icon || '📚'} ${row.title}`} value={`卡住 ${row.stuckCount || 0} / 打回 ${row.rejectedCount || 0}`} />
        ))}
      </Section>

      <Section title="情绪触发">
        {(insights?.emotions?.sceneStats || []).length === 0 ? (
          <EmptyText text="暂时没有情绪急救记录。" />
        ) : insights.emotions.sceneStats.slice(0, 8).map((row: any, index: number) => (
          <MiniRow key={`${row.scene}-${row.intensity}-${index}`} label={`${sceneLabel(row.scene)} · ${intensityLabel(row.intensity)}`} value={`${row.count} 次 / 有效 ${row.helpedCount || 0}`} />
        ))}
      </Section>

      <Section title="有效安抚动作">
        {(insights?.emotions?.actionStats || []).length === 0 ? (
          <EmptyText text="还没有可比较的安抚动作。" />
        ) : insights.emotions.actionStats.map((row: any) => (
          <MiniRow key={row.action} label={row.action} value={`有效 ${row.helpedCount || 0} / 共 ${row.count}`} />
        ))}
      </Section>

      <Section title="早餐选择">
        {(insights?.breakfast?.stats || []).length === 0 ? (
          <EmptyText text="还没有早餐选择记录。" />
        ) : insights.breakfast.stats.map((row: any, index: number) => (
          <MiniRow key={`${row.title}-${index}`} label={`${row.icon || '🥣'} ${row.title || '早餐'}`} value={`${row.count || 0} 次 / ${row.spentCoins || 0} 金币`} />
        ))}
      </Section>

      <Section title="游戏票使用">
        {(insights?.screenTime?.childStats || []).map((row: any) => (
          <MiniRow key={row.childId} label={row.childName} value={`${row.usedMinutes || 0} 分钟 / ${row.sessionCount || 0} 次`} />
        ))}
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-black text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function OptionGrid({ label, field, value, updateForm }: any) {
  const options = Object.entries(labelMaps[field] || {});
  return (
    <div>
      <div className="text-[11px] font-black text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([key, text]) => (
          <button
            key={key}
            onClick={() => updateForm(field, key)}
            className={`py-2 px-2 rounded-xl text-xs font-black border ${value === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-100'}`}
          >
            {text as string}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, icon, color }: any) {
  return (
    <div className="rounded-2xl bg-gray-50 p-3">
      <div className={`flex items-center justify-center gap-1 ${color}`}>{icon}</div>
      <div className={`text-2xl font-black mt-1 ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400 font-bold">{label}</div>
    </div>
  );
}

function MetricCard({ label, value, tone }: any) {
  const toneClass: Record<string, string> = {
    yellow: 'text-yellow-600 bg-yellow-50 border-yellow-100',
    blue: 'text-blue-600 bg-blue-50 border-blue-100',
    orange: 'text-orange-600 bg-orange-50 border-orange-100',
    green: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    red: 'text-red-600 bg-red-50 border-red-100',
    purple: 'text-purple-600 bg-purple-50 border-purple-100',
  };
  return (
    <div className={`rounded-2xl border p-3 text-center ${toneClass[tone] || toneClass.blue}`}>
      <div className="text-xl font-black">{value}</div>
      <div className="text-[10px] font-bold opacity-70">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-2">
      <div className="font-black text-gray-800 text-sm">{title}</div>
      {children}
    </Card>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 p-3">
      <span className="text-sm font-bold text-gray-700 truncate">{label}</span>
      <span className="text-xs font-black text-gray-500 flex-shrink-0">{value}</span>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-2xl bg-gray-50 p-4 text-center text-xs text-gray-400 font-bold">{text}</div>;
}

function sceneLabel(scene: string) {
  const labels: Record<string, string> = {
    itch: '身体很痒',
    angry: '急躁生气',
    study: '学习抵触',
    wake: '起床困难',
    game: '想玩手机',
    tired: '疲惫',
    other: '其他',
  };
  return labels[scene] || scene;
}

function intensityLabel(intensity: string) {
  const labels: Record<string, string> = {
    low: '小波动',
    medium: '有点难',
    high: '很难受',
  };
  return labels[intensity] || intensity;
}
