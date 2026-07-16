import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Gamepad2, HeartPulse, Save, Sparkles } from 'lucide-react';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import api from '../../services/api';
import { getDateLocale, t } from '../../i18n';

type ScreenTimeRules = {
  isEnabled: number;
  dailyBaseMinutes: number;
  dailyMaxMinutes: number;
  ticketMinutes: number;
  cooldownMinutes: number;
  studySavedTimeEnabled: number;
  studySavedTimeRatio: number;
  weekdayAllowedStart: string;
  weekdayAllowedEnd: string;
  weekendAllowedStart: string;
  weekendAllowedEnd: string;
};

type ChildOverview = {
  id: string;
  name: string;
  avatar?: string;
  balance: number;
  todayUsed: number;
  allowance: number;
  earnedMinutes: number;
  dailyBaseMinutes?: number;
  dailyMaxMinutes?: number;
  breakdown?: {
    base: number;
    earned: number;
    studySaved: number;
    morningStartup: number;
    morningStreak: number;
    manual: number;
    other: number;
    used: number;
    allowance: number;
    balance: number;
  };
  cooldown?: {
    cooldownMinutes: number;
    isCoolingDown: boolean;
    minutesUntilNext: number;
    lastEndedAt?: string | null;
  };
  window: { start: string; end: string; isAllowed: boolean };
};

const SCENE_LABELS: Record<string, string> = {
  itch: '身体很痒',
  angry: '急躁生气',
  study: '学习抵触',
  wake: '起床困难',
  game: '想玩手机',
  tired: '疲惫',
  other: '其他',
};

const INTENSITY_LABELS: Record<string, string> = {
  low: '小波动',
  medium: '有点难',
  high: '很难受',
};

const defaultRules: ScreenTimeRules = {
  isEnabled: 1,
  dailyBaseMinutes: 15,
  dailyMaxMinutes: 45,
  ticketMinutes: 10,
  cooldownMinutes: 3,
  studySavedTimeEnabled: 1,
  studySavedTimeRatio: 1,
  weekdayAllowedStart: '17:30',
  weekdayAllowedEnd: '20:30',
  weekendAllowedStart: '09:00',
  weekendAllowedEnd: '20:30',
};

const EMOTION_DATE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '近7天' },
  { value: 'month', label: '本月' },
] as const;

const SCREEN_RECORD_TIME_FILTERS = [
  { value: 'week', label: '近7天' },
  { value: 'today', label: '今天' },
  { value: 'month', label: '近30天' },
  { value: 'all', label: '全部' },
] as const;

const SCREEN_RECORD_TYPE_FILTERS = [
  { value: 'all', label: '全部类型' },
  { value: 'grant', label: '发放' },
  { value: 'deduct', label: '扣减' },
  { value: 'study_saved_time', label: '学习节省' },
  { value: 'privilege_redemption', label: t('screenTime.source.privilegeRedemption') },
  { value: 'morning_startup', label: '历史晨间（已停用）' },
  { value: 'session', label: '使用' },
  { value: 'completed', label: '已结束' },
] as const;

type EmotionDateFilter = typeof EMOTION_DATE_FILTERS[number]['value'];
type EmotionHelpedFilter = 'all' | 'true' | 'false';
type ScreenRecordTimeFilter = typeof SCREEN_RECORD_TIME_FILTERS[number]['value'];

const formatLocalDate = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const getEmotionDateParams = (filter: EmotionDateFilter) => {
  const now = new Date();
  if (filter === 'today') return { date: formatLocalDate(now) };
  if (filter === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { startDate: formatLocalDate(start), endDate: formatLocalDate(now) };
  }
  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: formatLocalDate(start), endDate: formatLocalDate(now) };
  }
  return {};
};

export default function ParentWellbeing() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rules, setRules] = useState<ScreenTimeRules>(defaultRules);
  const [overview, setOverview] = useState<ChildOverview[]>([]);
  const [checkins, setCheckins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grantChildId, setGrantChildId] = useState('');
  const [grantMinutes, setGrantMinutes] = useState(10);
  const [grantReason, setGrantReason] = useState('');
  const [emotionDateFilter, setEmotionDateFilter] = useState<EmotionDateFilter>('week');
  const [emotionSceneFilter, setEmotionSceneFilter] = useState('all');
  const [emotionHelpedFilter, setEmotionHelpedFilter] = useState<EmotionHelpedFilter>('all');
  const [emotionStartDate, setEmotionStartDate] = useState('');
  const [emotionEndDate, setEmotionEndDate] = useState('');
  const [screenRecords, setScreenRecords] = useState<any[]>([]);
  const [screenRecordTimeFilter, setScreenRecordTimeFilter] = useState<ScreenRecordTimeFilter>('week');
  const [screenRecordTypeFilter, setScreenRecordTypeFilter] = useState('all');
  const [screenRecordStartDate, setScreenRecordStartDate] = useState('');
  const [screenRecordEndDate, setScreenRecordEndDate] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const checkinParams = {
        ...(emotionStartDate || emotionEndDate ? {
          ...(emotionStartDate ? { startDate: emotionStartDate } : {}),
          ...(emotionEndDate ? { endDate: emotionEndDate } : {}),
        } : getEmotionDateParams(emotionDateFilter)),
        ...(emotionSceneFilter !== 'all' ? { scene: emotionSceneFilter } : {}),
        ...(emotionHelpedFilter !== 'all' ? { helped: emotionHelpedFilter } : {}),
      };
      const screenRecordParams = {
        limit: 80,
        type: screenRecordTypeFilter,
        ...(screenRecordStartDate || screenRecordEndDate ? {
          ...(screenRecordStartDate ? { startDate: screenRecordStartDate } : {}),
          ...(screenRecordEndDate ? { endDate: screenRecordEndDate } : {}),
        } : { timeFilter: screenRecordTimeFilter }),
      };
      const [rulesRes, overviewRes, checkinRes, screenRecordRes] = await Promise.all([
        api.get('/parent/screen-time-rules'),
        api.get('/parent/screen-time/overview'),
        api.get('/parent/emotion-checkins', { params: checkinParams }),
        api.get('/parent/screen-time-records', { params: screenRecordParams }),
      ]);
      setRules({ ...defaultRules, ...rulesRes.data });
      setOverview(overviewRes.data || []);
      setCheckins(checkinRes.data || []);
      setScreenRecords(screenRecordRes.data || []);
      setGrantChildId(prev => prev || overviewRes.data?.[0]?.id || '');
    } catch (e) {
      toast.error('情绪与游戏票数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [
    emotionDateFilter,
    emotionEndDate,
    emotionHelpedFilter,
    emotionSceneFilter,
    emotionStartDate,
    screenRecordEndDate,
    screenRecordStartDate,
    screenRecordTimeFilter,
    screenRecordTypeFilter,
    toast,
  ]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateRule = (key: keyof ScreenTimeRules, value: string | number | boolean) => {
    setRules(prev => ({
      ...prev,
      [key]: typeof value === 'boolean' ? (value ? 1 : 0) : value,
    }));
  };

  const saveRules = async () => {
    setSaving(true);
    try {
      const res = await api.put('/parent/screen-time-rules', rules);
      setRules({ ...defaultRules, ...res.data });
      toast.success('游戏票规则已保存');
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const grantTicket = async () => {
    if (!grantChildId) return toast.warning('请先选择孩子');
    if (grantReason.trim().length < 2) return toast.warning('请填写至少 2 个字的纠错原因');
    try {
      await api.post('/parent/screen-time/grant', {
        childId: grantChildId,
        minutes: grantMinutes,
        reason: grantReason,
      });
      toast.success(grantMinutes > 0 ? '游戏票余额已增加' : '游戏票余额已扣减');
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '调整失败');
    }
  };

  return (
    <Layout>
      <Header title="情绪与游戏票" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 pb-20 space-y-4 overflow-y-auto flex-1">
        <Card className="bg-gradient-to-br from-sky-50 to-emerald-50 border-sky-100">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white text-sky-600 flex items-center justify-center shadow-sm">
              <HeartPulse size={26} />
            </div>
            <div>
              <div className="font-black text-gray-800">冷静练习 + 游戏票</div>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                情绪记录用来发现触发点；游戏票让手机娱乐变成可预期、可兑换、可结束的规则。
              </p>
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-black text-gray-800">
              <Gamepad2 size={20} className="text-emerald-600" /> 游戏票规则
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
              <input type="checkbox" checked={Boolean(rules.isEnabled)} onChange={e => updateRule('isEnabled', e.target.checked)} />
              开启
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="每日基础分钟">
              <input type="number" value={rules.dailyBaseMinutes} onChange={e => updateRule('dailyBaseMinutes', Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="每日上限分钟">
              <input type="number" value={rules.dailyMaxMinutes} onChange={e => updateRule('dailyMaxMinutes', Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="默认票面分钟">
              <input type="number" value={rules.ticketMinutes} onChange={e => updateRule('ticketMinutes', Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="冷却分钟">
              <input type="number" value={rules.cooldownMinutes} onChange={e => updateRule('cooldownMinutes', Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
          </div>

          <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3 space-y-3">
            <label className="flex items-start gap-2 text-xs font-bold text-sky-700">
              <input
                type="checkbox"
                checked={Boolean(rules.studySavedTimeEnabled)}
                onChange={e => updateRule('studySavedTimeEnabled', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                学习节省时间自动兑换游戏票
                <span className="block mt-1 text-[11px] leading-relaxed text-sky-600">
                  仅学习任务/学习关卡适用。孩子在预计时间内完成并通过审核后，节省的分钟数当天入账，仍受每日上限限制。
                </span>
              </span>
            </label>
            <details className="rounded-xl bg-white border border-sky-100 px-3 py-2">
              <summary className="min-h-11 flex items-center cursor-pointer text-xs font-black text-sky-700">高级设置：兑换比例</summary>
              <Field label="节省 1 分钟 = ? 分钟游戏票">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={rules.studySavedTimeRatio}
                  onChange={e => updateRule('studySavedTimeRatio', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border bg-white"
                />
              </Field>
            </details>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="工作日开始">
              <input type="time" value={rules.weekdayAllowedStart} onChange={e => updateRule('weekdayAllowedStart', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="工作日结束">
              <input type="time" value={rules.weekdayAllowedEnd} onChange={e => updateRule('weekdayAllowedEnd', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="周末开始">
              <input type="time" value={rules.weekendAllowedStart} onChange={e => updateRule('weekendAllowedStart', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="周末结束">
              <input type="time" value={rules.weekendAllowedEnd} onChange={e => updateRule('weekendAllowedEnd', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
          </div>

          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700 font-bold leading-relaxed">
            规则说明：游戏票按北京时间当天统计，未使用分钟不会结转到明天；每日基础建议 15 分钟；每日可用分钟会被“每日上限”封顶；任务奖励只来自家长确认后的学习省时；每次结束后会按“冷却分钟”限制再次开启。
          </div>

          <Button onClick={saveRules} loading={saving} className="w-full bg-emerald-500 border-none">
            <Save size={18} /> 保存规则
          </Button>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2 font-black text-gray-800">
            <Sparkles size={20} className="text-yellow-500" /> 游戏票余额纠错
          </div>
          {overview.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-6">还没有孩子成员，先到家庭管理添加孩子。</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="孩子">
                  <select value={grantChildId} onChange={e => setGrantChildId(e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-gray-50">
                    {overview.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
                  </select>
                </Field>
                <Field label="分钟（可为负数）">
                  <input type="number" value={grantMinutes} onChange={e => setGrantMinutes(Number(e.target.value) || 0)} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
                </Field>
              </div>
              <Field label="纠错原因（必填）">
                <input value={grantReason} onChange={e => setGrantReason(e.target.value)} placeholder="例如：补记昨日少算的 5 分钟" className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
              </Field>
              <Button onClick={grantTicket} variant="secondary" className="w-full">
                确认纠错
              </Button>
            </>
          )}
        </Card>

        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-400 px-1">孩子今日游戏票</div>
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : overview.length === 0 ? (
            <Card className="text-center py-8 text-sm text-gray-400">暂无孩子成员</Card>
          ) : overview.map(child => (
            <Card key={child.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">{child.avatar || '🙂'}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-gray-800">{child.name}</div>
                  <div className="text-xs text-gray-500">可用 {child.balance} 分钟 · 已用 {child.todayUsed} 分钟 · 今日额度 {child.allowance} 分钟</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    基础 {child.dailyBaseMinutes ?? child.breakdown?.base ?? rules.dailyBaseMinutes} 分钟 · 额外 {child.earnedMinutes} 分钟 · 上限 {child.dailyMaxMinutes ?? rules.dailyMaxMinutes} 分钟
                    {child.cooldown?.isCoolingDown ? ` · 冷却中 ${child.cooldown.minutesUntilNext} 分钟` : ` · 冷却 ${child.cooldown?.cooldownMinutes ?? rules.cooldownMinutes} 分钟`}
                  </div>
                </div>
                <div className={`px-2 py-1 rounded-full text-[10px] font-black ${
                  child.cooldown?.isCoolingDown ? 'bg-sky-100 text-sky-700' : child.window?.isAllowed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {child.cooldown?.isCoolingDown ? '冷却中' : child.window?.isAllowed ? '可用' : '未到时间'}
                </div>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${Math.min(100, child.allowance ? (child.todayUsed / child.allowance) * 100 : 0)}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold">
                <div className="rounded-xl bg-sky-50 text-sky-600 px-2 py-1.5">学习 +{child.breakdown?.studySaved ?? 0}</div>
                <div className="rounded-xl bg-amber-50 text-amber-600 px-2 py-1.5">历史晨间 +{(child.breakdown?.morningStartup ?? 0) + (child.breakdown?.morningStreak ?? 0)}</div>
                <div className="rounded-xl bg-gray-50 text-gray-500 px-2 py-1.5">纠错 {child.breakdown?.manual ?? 0}</div>
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
              <Gamepad2 size={14} /> 游戏票记录
            </div>
            <div className="text-[10px] font-bold text-gray-400">按日期和类型查看</div>
          </div>
          <div className="bg-white rounded-2xl p-3 border shadow-sm space-y-3">
            <div>
              <div className="text-xs font-bold text-gray-400 mb-2">快捷日期</div>
              <div className="grid grid-cols-4 gap-1.5">
                {SCREEN_RECORD_TIME_FILTERS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => { setScreenRecordTimeFilter(option.value); setScreenRecordStartDate(''); setScreenRecordEndDate(''); }}
                    className={`py-2 rounded-lg text-[10px] font-bold transition-all ${
                      screenRecordTimeFilter === option.value && !screenRecordStartDate && !screenRecordEndDate ? 'bg-sky-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-400">自定义日期</div>
                {(screenRecordStartDate || screenRecordEndDate) && (
                  <button
                    type="button"
                    onClick={() => { setScreenRecordStartDate(''); setScreenRecordEndDate(''); setScreenRecordTimeFilter('week'); }}
                    className="text-[10px] font-bold text-blue-500"
                  >
                    清除范围
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={screenRecordStartDate}
                  onChange={e => setScreenRecordStartDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="游戏票记录开始日期"
                />
                <input
                  type="date"
                  value={screenRecordEndDate}
                  onChange={e => setScreenRecordEndDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="游戏票记录结束日期"
                />
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-400 mb-2">记录类型</div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {SCREEN_RECORD_TYPE_FILTERS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setScreenRecordTypeFilter(option.value)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                      screenRecordTypeFilter === option.value ? 'bg-indigo-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {screenRecords.length === 0 ? (
            <Card className="text-center py-8 text-sm text-gray-400">当前筛选下暂无游戏票记录</Card>
          ) : screenRecords.map(record => {
            const isSession = record.type === 'session';
            const isStudySaved = record.source === 'study_saved_time';
            const isPrivilegeRedemption = record.source === 'privilege_redemption';
            const isMorningStartup = record.source === 'morning_startup' || record.source === 'morning_startup_streak_3';
            const isPositive = Number(record.minutes || 0) >= 0;
            const title = isSession
              ? `使用 ${record.minutes || 0} 分钟`
              : isStudySaved
                ? `学习节省 +${Math.abs(Number(record.minutes || 0))} 分钟`
                : isPrivilegeRedemption
                  ? `${t('screenTime.source.privilegeRedemption')} +${Math.abs(Number(record.minutes || 0))} 分钟`
                : isMorningStartup
                  ? `历史晨间（已停用） +${Math.abs(Number(record.minutes || 0))} 分钟`
                  : `${isPositive ? '发放' : '扣减'} ${Math.abs(Number(record.minutes || 0))} 分钟`;
            const statusText: Record<string, string> = {
              running: '进行中',
              completed: '已结束',
              cancelled: '已取消',
              grant: '发放',
              deduct: '扣减',
            };
            return (
              <Card key={`${record.type}-${record.id}`} className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                  isSession ? 'bg-sky-50 text-sky-600' : isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'
                }`}>
                  {isSession ? <Gamepad2 size={20} /> : <Sparkles size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-black text-gray-800 text-sm truncate">{record.childName} · {title}</div>
                    <div className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 flex-shrink-0">
                      {statusText[record.subtype] || statusText[record.status] || record.subtype || '记录'}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {record.reason || (isSession ? '孩子开启游戏票' : '家长余额纠错')}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">{new Date(record.createdAt).toLocaleString(getDateLocale())}</div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
              <Clock size={14} /> 冷静记录
            </div>
            <div className="text-[10px] font-bold text-gray-400">按日期、场景和效果查看</div>
            </div>
            <div className="bg-white rounded-2xl p-3 border shadow-sm space-y-3">
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                {EMOTION_DATE_FILTERS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => { setEmotionDateFilter(option.value); setEmotionStartDate(''); setEmotionEndDate(''); }}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    emotionDateFilter === option.value && !emotionStartDate && !emotionEndDate ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold text-gray-400">自定义日期</div>
                {(emotionStartDate || emotionEndDate) && (
                  <button
                    type="button"
                    onClick={() => { setEmotionStartDate(''); setEmotionEndDate(''); setEmotionDateFilter('week'); }}
                    className="text-[10px] font-bold text-blue-500"
                  >
                    清除范围
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={emotionStartDate}
                  onChange={e => setEmotionStartDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="冷静记录开始日期"
                />
                <input
                  type="date"
                  value={emotionEndDate}
                  onChange={e => setEmotionEndDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="冷静记录结束日期"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="场景类型">
                <select
                  value={emotionSceneFilter}
                  onChange={e => setEmotionSceneFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border bg-gray-50 text-sm"
                >
                  <option value="all">全部场景</option>
                  {Object.entries(SCENE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="练习效果">
                <select
                  value={emotionHelpedFilter}
                  onChange={e => setEmotionHelpedFilter(e.target.value as EmotionHelpedFilter)}
                  className="w-full px-3 py-2 rounded-xl border bg-gray-50 text-sm"
                >
                  <option value="all">全部结果</option>
                  <option value="true">有帮助</option>
                  <option value="false">未确认</option>
                </select>
              </Field>
            </div>
          </div>
          {checkins.length === 0 ? (
            <Card className="text-center py-8 text-sm text-gray-400">当前筛选下暂无冷静练习记录</Card>
          ) : checkins.slice(0, 20).map(item => (
            <Card key={item.id} className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${item.helped ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}>
                <HeartPulse size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 text-sm">{item.childName} · {SCENE_LABELS[item.scene] || item.scene}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {INTENSITY_LABELS[item.intensity] || item.intensity} · {item.action || '未选择动作'} · 经验 +{item.xpAwarded || 0}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">{new Date(item.createdAt).toLocaleString()}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
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
