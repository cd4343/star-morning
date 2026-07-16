import { useState, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { Header } from '../../components/Header';
import api from '../../services/api';
import { getDateLocale } from '../../i18n';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { TrendingUp, BarChart, AlertCircle, Calendar, Trophy, ChevronRight, ListFilter } from 'lucide-react';
import { useConfirmDialog } from '../../components/ConfirmDialog';

interface PunishmentSettings {
  enabled: boolean;
  mildName: string;
  mildRate: number;
  mildMin: number;
  mildMax: number;
  moderateName: string;
  moderateRate: number;
  moderateMin: number;
  moderateMax: number;
  severeName: string;
  severeRate: number;
  severeExtra: number;
  severeMax: number;
  customName: string;
  customMin: number;
  customMax: number;
  allowNegative: boolean;
  negativeLimit: number;
  notifyChild: boolean;
  requireReason: boolean;
}

type PunishmentTab = 'settings' | 'stats' | 'records';

const getInitialPunishmentTab = (search: string): PunishmentTab => {
  const value = new URLSearchParams(search).get('tab');
  return value === 'stats' || value === 'records' || value === 'settings' ? value : 'settings';
};

const RECORD_TIME_FILTERS = [
  { value: 'week', label: '近7天' },
  { value: 'today', label: '今天' },
  { value: 'month', label: '近30天' },
  { value: 'all', label: '全部' },
];

const RECORD_LEVEL_FILTERS = [
  { value: 'all', label: '全部等级' },
  { value: 'mild', label: '轻度' },
  { value: 'moderate', label: '中度' },
  { value: 'severe', label: '严重' },
  { value: 'custom', label: '自定义' },
];

const RECORD_CATEGORY_FILTERS = ['all', '生活', '学习', '运动', '活动', '情绪调节', '其他'];

const LEVEL_LABELS: Record<string, string> = {
  mild: '轻度',
  moderate: '中度',
  severe: '严重',
  custom: '自定义',
};

const numberOrZero = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;

function SettingField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-black text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 rounded text-blue-600"
      />
      <span className="min-w-0">
        <span className="block text-sm font-black text-slate-900">{title}</span>
        <span className="block text-xs text-slate-600 mt-0.5 leading-relaxed">{description}</span>
      </span>
    </label>
  );
}

function RuleCard({
  icon,
  title,
  description,
  tone,
  children,
  example,
}: {
  icon: string;
  title: string;
  description: string;
  tone: string;
  children: ReactNode;
  example: string;
}) {
  return (
    <Card className={`space-y-3 ${tone}`}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-2xl shadow-sm">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="font-black text-slate-900">{title}</div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
      <div className="rounded-xl bg-white/90 border border-white px-3 py-2 text-xs text-slate-700 font-bold">
        {example}
      </div>
    </Card>
  );
}

function SettingsSaveCard({
  saving,
  onSave,
  onReset,
  compact = false,
}: {
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  compact?: boolean;
}) {
  return (
    <Card className={`border-blue-100 bg-gradient-to-br from-white to-blue-50 ${compact ? 'space-y-3' : 'space-y-4'}`}>
      {!compact && (
        <div>
          <div className="font-black text-slate-900">保存惩罚规则</div>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
            修改后需要手动保存才会生效。顶部返回箭头负责离开页面，这里只保留和设置相关的动作。
          </p>
        </div>
      )}
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <Button onClick={onSave} loading={saving} className="py-3 bg-green-500 border-none">
          保存设置
        </Button>
        <Button variant="secondary" onClick={onReset} className="py-3 bg-white">
          恢复默认
        </Button>
      </div>
    </Card>
  );
}

const ParentPunishment = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [settings, setSettings] = useState<PunishmentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<PunishmentTab>(() => getInitialPunishmentTab(location.search));
  const [records, setRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordTimeFilter, setRecordTimeFilter] = useState('week');
  const [recordStartDate, setRecordStartDate] = useState('');
  const [recordEndDate, setRecordEndDate] = useState('');
  const [recordLevelFilter, setRecordLevelFilter] = useState('all');
  const [recordCategoryFilter, setRecordCategoryFilter] = useState('all');

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  useEffect(() => {
    setActiveTab(getInitialPunishmentTab(location.search));
  }, [location.search]);

  useEffect(() => {
    if (activeTab === 'records') {
      loadRecords();
    }
  }, [activeTab, recordTimeFilter, recordStartDate, recordEndDate, recordLevelFilter, recordCategoryFilter]);

  const loadStats = async () => {
    try {
      const res = await api.get('/parent/punishment-stats');
      setStats(res.data);
    } catch (e) {
      console.error('加载统计失败:', e);
    }
  };

  const loadRecords = async () => {
    try {
      setRecordsLoading(true);
      const params: Record<string, string | number> = {
        limit: 80,
      };
      if (recordStartDate || recordEndDate) {
        if (recordStartDate) params.startDate = recordStartDate;
        if (recordEndDate) params.endDate = recordEndDate;
      } else {
        params.timeFilter = recordTimeFilter;
      }
      if (recordLevelFilter !== 'all') params.level = recordLevelFilter;
      if (recordCategoryFilter !== 'all') params.taskCategory = recordCategoryFilter;
      const res = await api.get('/parent/punishment-records', { params });
      setRecords(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error('加载惩罚记录失败:', e);
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await api.get('/parent/punishment-settings');
      setSettings({
        ...res.data,
        enabled: Boolean(res.data.enabled),
        allowNegative: Boolean(res.data.allowNegative),
        notifyChild: Boolean(res.data.notifyChild),
        requireReason: Boolean(res.data.requireReason),
      });
    } catch (error) {
      console.error('加载设置失败:', error);
      setMessage('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    setSaving(true);
    setMessage('');

    try {
      await api.put('/parent/punishment-settings', settings);
      setMessage('✅ 设置已保存');
      loadStats();
      setTimeout(() => {
        setMessage('');
      }, 1500);
    } catch (error) {
      console.error('保存设置失败:', error);
      setMessage('❌ 保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = await confirm({
      title: '恢复默认惩罚规则',
      message: '确定要把惩罚规则恢复为默认值吗？恢复后仍需要点击“保存设置”才会生效。',
      type: 'warning',
      confirmText: '恢复默认',
      cancelText: '先不恢复',
    });
    if (!confirmed) return;

    setSettings({
      enabled: false,
      mildName: '轻度警告',
      mildRate: 0.3,
      mildMin: 2,
      mildMax: 10,
      moderateName: '中度惩罚',
      moderateRate: 0.5,
      moderateMin: 5,
      moderateMax: 20,
      severeName: '严重惩罚',
      severeRate: 1.0,
      severeExtra: 5,
      severeMax: 50,
      customName: '自定义扣除',
      customMin: 1,
      customMax: 100,
      allowNegative: true,
      negativeLimit: -10,
      notifyChild: true,
      requireReason: true
    });
    setMessage('已恢复默认设置，请点击保存生效');
  };

  const updateSetting = <K extends keyof PunishmentSettings>(key: K, value: PunishmentSettings[K]) => {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
  };

  if (loading) {
    return (
      <Layout>
        <Header title="惩罚设置" showBack onBack={() => navigate('/parent/dashboard')} />
        <div className="flex-1 grid place-items-center text-sm text-gray-400">加载中...</div>
      </Layout>
    );
  }

  if (!settings) {
    return (
      <Layout>
        <Header title="惩罚设置" showBack onBack={() => navigate('/parent/dashboard')} />
        <div className="flex-1 grid place-items-center p-4">
          <Card className="text-center space-y-3">
            <div className="font-black text-gray-800">无法加载设置</div>
            <Button onClick={loadSettings}>重试</Button>
          </Card>
        </div>
      </Layout>
    );
  }

  const levelStats = Array.isArray(stats?.byLevel) ? stats.byLevel : [];
  const taskStats = Array.isArray(stats?.taskStats) ? stats.taskStats : [];
  const topViolationTasks = Array.isArray(stats?.topViolationTasks)
    ? stats.topViolationTasks
    : taskStats
        .filter((item: any) => Number(item.punishmentCount || 0) > 0)
        .sort((a: any, b: any) => Number(b.punishmentCount || 0) - Number(a.punishmentCount || 0))
        .slice(0, 5)
        .map((item: any) => ({ title: item.title, count: item.punishmentCount }));
  const perfectDays = Number(stats?.perfectDays ?? Math.max(0, 30 - Number(stats?.totalCount || 0)));

  return (
    <Layout>
      <Header title="惩罚设置" showBack onBack={() => navigate('/parent/dashboard')} />

      <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 pb-8">

      {/* 选项卡切换 */}
      <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
        <button
          onClick={() => setActiveTab('stats')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'stats' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
        >
          <BarChart size={16}/> 违规画像
        </button>
        <button
          onClick={() => setActiveTab('records')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'records' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
        >
          <ListFilter size={16}/> 记录
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'settings' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
        >
          <AlertCircle size={16}/> 惩罚规则
        </button>
      </div>

      {activeTab === 'stats' && (
        <div className="space-y-4 animate-in fade-in duration-500">
          {!stats && (
            <Card className="text-center py-8 text-sm text-gray-400">暂无违规画像数据</Card>
          )}
          {stats && (
          <>
          {/* 核心指标 */}
          <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 fill-mode-both">
            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-100">
              <div className="text-xs text-green-600 font-bold mb-1">连续表现最佳</div>
              <div className="text-2xl font-black text-green-700">{perfectDays} <span className="text-xs font-normal">天</span></div>
              <div className="text-[10px] text-green-500 mt-1 flex items-center gap-1">
                <Trophy size={10}/> 未发生任何违规
              </div>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100">
              <div className="text-xs text-blue-600 font-bold mb-1">30天违规数</div>
              <div className="text-2xl font-black text-blue-700">{stats.totalCount} <span className="text-xs font-normal">次</span></div>
              <div className="text-[10px] text-blue-500 mt-1 flex items-center gap-1">
                <TrendingUp size={10}/> 本周发生 {stats.weekCount} 次
              </div>
            </Card>
          </div>

          {/* 违规等级分布 */}
          <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 fill-mode-both">
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <AlertCircle size={16} className="text-orange-500"/> 违规等级分布 (30天)
            </h4>
            <div className="space-y-3">
              {['mild', 'moderate', 'severe', 'custom'].map(lv => {
                const item = levelStats.find((d: any) => d.level === lv);
                const count = item ? item.count : 0;
                const total = levelStats.reduce((a: any, b: any) => a + b.count, 0) || 1;
                const percent = Math.round((count / total) * 100);
                const labels: any = { mild: '轻度警告', moderate: '中度惩罚', severe: '严重惩罚', custom: '自定义' };
                const colors: any = { mild: 'bg-yellow-400', moderate: 'bg-orange-500', severe: 'bg-red-500', custom: 'bg-purple-500' };

                return (
                  <div key={lv} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-gray-600">
                      <span>{labels[lv]}</span>
                      <span>{count} 次 ({percent}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${colors[lv]}`} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 高频违规任务 */}
          <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both">
            <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <Calendar size={16} className="text-blue-500"/> 高频违规任务 (30天)
            </h4>
            {topViolationTasks.length > 0 ? (
              <div className="space-y-2">
                {topViolationTasks.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="text-xs font-bold text-gray-700 flex items-center gap-2">
                      <span className="w-5 h-5 bg-gray-200 rounded flex items-center justify-center text-[10px]">{i+1}</span>
                      {t.title}
                    </span>
                    <span className="text-xs font-bold text-red-500">{t.count} 次</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-xs text-gray-400">暂无记录，继续保持哦！</div>
            )}
          </Card>

          <button
            onClick={() => setActiveTab('settings')}
            className="w-full py-4 rounded-2xl bg-white border-2 border-dashed border-gray-200 flex items-center justify-center gap-2 text-gray-400 font-bold hover:border-blue-300 hover:text-blue-500 transition-all animate-in fade-in duration-500 delay-500 fill-mode-both"
          >
            调整惩罚规则设置 <ChevronRight size={16}/>
          </button>
          </>
          )}
        </div>
      )}

      {activeTab === 'records' && (
        <div className="space-y-4 animate-in fade-in duration-500">
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-2xl shadow-sm">🧾</div>
              <div>
                <div className="font-black text-gray-800">惩罚记录查询</div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  按日期范围、惩罚等级和任务分类组合查看，便于判断是任务设计问题，还是某个时段需要额外支持。
                </p>
              </div>
            </div>
          </Card>

          <Card className="space-y-3">
            <div>
              <div className="text-xs font-bold text-gray-400 mb-2">日期范围</div>
              <div className="grid grid-cols-4 gap-1.5">
                {RECORD_TIME_FILTERS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setRecordTimeFilter(option.value); setRecordStartDate(''); setRecordEndDate(''); }}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${
                      recordTimeFilter === option.value && !recordStartDate && !recordEndDate ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
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
                {(recordStartDate || recordEndDate) && (
                  <button
                    type="button"
                    onClick={() => { setRecordStartDate(''); setRecordEndDate(''); setRecordTimeFilter('week'); }}
                    className="text-[10px] font-bold text-blue-500"
                  >
                    清除范围
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={recordStartDate}
                  onChange={e => setRecordStartDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="惩罚记录开始日期"
                />
                <input
                  type="date"
                  value={recordEndDate}
                  onChange={e => setRecordEndDate(e.target.value)}
                  className="w-full rounded-xl border bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600"
                  aria-label="惩罚记录结束日期"
                />
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-400 mb-2">惩罚等级</div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {RECORD_LEVEL_FILTERS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRecordLevelFilter(option.value)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      recordLevelFilter === option.value ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-400 mb-2">任务分类</div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {RECORD_CATEGORY_FILTERS.map(category => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setRecordCategoryFilter(category)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      recordCategoryFilter === category ? 'bg-indigo-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {category === 'all' ? '全部类型' : category}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {recordsLoading ? (
            <Card className="text-center py-8 text-sm text-gray-400">记录加载中...</Card>
          ) : records.length === 0 ? (
            <Card className="text-center py-8 text-sm text-gray-400">当前筛选下暂无惩罚记录</Card>
          ) : (
            <div className="space-y-2">
              {records.map((record: any) => (
                <Card key={record.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-black text-gray-800 truncate">{record.taskTitle || '未知任务'}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {record.childName || '孩子'} · {record.taskCategory || '未分类'} · {new Date(record.createdAt).toLocaleString(getDateLocale())}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-black text-red-500">-{record.deductedCoins || 0} 金币</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{LEVEL_LABELS[record.level] || record.level || '惩罚'}</div>
                    </div>
                  </div>
                  {record.reason && (
                    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600 leading-relaxed">
                      {record.reason}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-4 animate-in fade-in duration-500">
          <Card className="bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-100 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-2xl shadow-sm">⚠️</div>
              <div>
                <div className="font-black text-gray-800">惩罚只处理少数明确情况</div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  用于严重超时、态度极差或需要复盘的行为。建议先沟通原因，首次多用提醒，连续出现再执行扣除。
                </p>
              </div>
            </div>
            <ToggleRow
              checked={settings.enabled}
              onChange={checked => updateSetting('enabled', checked)}
              title="启用惩罚功能"
              description="关闭后审核任务时不会出现扣金币流程。"
            />
          </Card>

          {message && (
            <div className={`rounded-2xl px-4 py-3 text-center text-sm font-bold ${
              message.includes('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
            }`}>
              {message}
            </div>
          )}

          <div className={settings.enabled ? 'space-y-3' : 'space-y-3'}>
            <RuleCard
              icon="🟡"
              title={settings.mildName}
              description="适用于态度一般、轻微马虎。建议扣得轻，让孩子知道需要调整，但不打断继续努力。"
              tone="bg-yellow-50 border-yellow-100"
              example={`示例：10 金币任务扣 ${Math.max(settings.mildMin, Math.min(settings.mildMax, Math.round(10 * settings.mildRate)))} 金币`}
            >
              <SettingField label="扣除比例（%）">
                <input type="number" min="0" max="100" step="5" value={Math.round(settings.mildRate * 100)} onChange={e => updateSetting('mildRate', numberOrZero(e.target.value) / 100)} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最少扣除">
                <input type="number" min="0" value={settings.mildMin} onChange={e => updateSetting('mildMin', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最多扣除">
                <input type="number" min="0" value={settings.mildMax} onChange={e => updateSetting('mildMax', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
            </RuleCard>

            <RuleCard
              icon="🟠"
              title={settings.moderateName}
              description="适用于态度较差、轻微超时。建议作为复盘信号，而不是经常触发的默认处理。"
              tone="bg-orange-50 border-orange-100"
              example={`示例：20 金币任务扣 ${Math.max(settings.moderateMin, Math.min(settings.moderateMax, Math.round(20 * settings.moderateRate)))} 金币`}
            >
              <SettingField label="扣除比例（%）">
                <input type="number" min="0" max="100" step="5" value={Math.round(settings.moderateRate * 100)} onChange={e => updateSetting('moderateRate', numberOrZero(e.target.value) / 100)} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最少扣除">
                <input type="number" min="0" value={settings.moderateMin} onChange={e => updateSetting('moderateMin', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最多扣除">
                <input type="number" min="0" value={settings.moderateMax} onChange={e => updateSetting('moderateMax', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
            </RuleCard>

            <RuleCard
              icon="🔴"
              title={settings.severeName}
              description="适用于态度极差、严重超时。建议保留为少数情况，并在审核时写清楚原因。"
              tone="bg-red-50 border-red-100"
              example={`示例：20 金币任务扣 ${Math.min(settings.severeMax, Math.round(20 * settings.severeRate) + settings.severeExtra)} 金币`}
            >
              <SettingField label="扣除比例（%）">
                <input type="number" min="0" max="100" step="10" value={Math.round(settings.severeRate * 100)} onChange={e => updateSetting('severeRate', numberOrZero(e.target.value) / 100)} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="额外扣除">
                <input type="number" min="0" value={settings.severeExtra} onChange={e => updateSetting('severeExtra', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最多扣除">
                <input type="number" min="0" value={settings.severeMax} onChange={e => updateSetting('severeMax', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
            </RuleCard>

            <RuleCard
              icon="🟣"
              title={settings.customName || '自定义扣除'}
              description="审核时手动输入金额，适合需要按具体情况判断的少数场景。"
              tone="bg-purple-50 border-purple-100"
              example={`说明：审核时可输入 ${settings.customMin ?? 1}～${settings.customMax ?? 100} 金币`}
            >
              <SettingField label="显示名称">
                <input type="text" value={settings.customName || '自定义扣除'} onChange={e => updateSetting('customName', e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最小扣除">
                <input type="number" min="0" value={settings.customMin ?? 1} onChange={e => updateSetting('customMin', Math.max(0, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
              <SettingField label="最大扣除">
                <input type="number" min="1" value={settings.customMax ?? 100} onChange={e => updateSetting('customMax', Math.max(1, Math.round(numberOrZero(e.target.value))))} className="w-full px-3 py-2 rounded-xl border bg-white" />
              </SettingField>
            </RuleCard>

            <Card className="bg-blue-50 border-blue-100 space-y-3">
              <div className="font-black text-gray-800">🛡️ 保护设置</div>
              <ToggleRow
                checked={settings.allowNegative}
                onChange={checked => updateSetting('allowNegative', checked)}
                title="允许金币为负数"
                description="适合把扣除变成可偿还的债务，但建议设置最低限制。"
              />
              {settings.allowNegative && (
                <SettingField label="金币最低限制">
                  <input type="number" max="-1" step="5" value={settings.negativeLimit} onChange={e => updateSetting('negativeLimit', Math.round(numberOrZero(e.target.value)))} className="w-full px-3 py-2 rounded-xl border bg-white" />
                </SettingField>
              )}
            </Card>

            <Card className="bg-emerald-50 border-emerald-100 space-y-3">
              <div className="font-black text-gray-800">📢 通知设置</div>
              <ToggleRow
                checked={settings.notifyChild}
                onChange={checked => updateSetting('notifyChild', checked)}
                title="扣金币时通知孩子"
                description="让孩子知道发生了什么，避免只看到金币变少。"
              />
              <ToggleRow
                checked={settings.requireReason}
                onChange={checked => updateSetting('requireReason', checked)}
                title="扣金币时必须填写原因"
                description="保留可复盘记录，家长后续可以按原因查询。"
              />
            </Card>
            <SettingsSaveCard saving={saving} onSave={handleSave} onReset={handleReset} compact />
          </div>
        </div>
      )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
};

export default ParentPunishment;
