import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Trash2, Sparkles, Check, Pen } from 'lucide-react';
import api from '../../services/api';
import { t } from '../../i18n';
import { useTemplateSelector } from '../../hooks/useTemplateSelector';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';
import { IconPicker } from '../../components/IconPicker';
import { TimeWindowEditor } from '../../components/TimeWindowEditor';
import { CreateActionCard } from '../../components/CreateActionCard';
import { ParentGameTimePrivilegeApprovals } from '../../components/parent/ParentGameTimePrivilegeApprovals';

// 系统模板只提供安全的家庭选择权，不把基本生活、安全和照护商品化。
const PRIVILEGE_TEMPLATES = [
  { title: t('privilege.template.dinner.title'), desc: t('privilege.template.dinner.desc'), cost: 3, icon: '🍽️', category: '家庭选择权' },
  { title: t('privilege.template.weekend.title'), desc: t('privilege.template.weekend.desc'), cost: 5, icon: '🗓️', category: '家庭活动' },
  { title: t('privilege.template.parentTime.title'), desc: t('privilege.template.parentTime.desc'), cost: 5, icon: '👨‍👩‍👧', category: '亲子体验' },
  { title: t('privilege.template.together.title'), desc: t('privilege.template.together.desc'), cost: 8, icon: '🤝', category: '亲子体验' },
  { title: t('privilege.template.order.title'), desc: t('privilege.template.order.desc'), cost: 3, icon: '🔀', category: '任务自主' },
  { title: t('privilege.template.retry.title'), desc: t('privilege.template.retry.desc'), cost: 3, icon: '🔁', category: '任务自主' },
  { title: t('privilege.template.delay.title'), desc: t('privilege.template.delay.desc'), cost: 5, icon: '⏳', category: '任务自主' },
  { title: t('privilege.template.content.title'), desc: t('privilege.template.content.desc'), cost: 5, icon: '🎬', category: '娱乐选择' },
  { title: t('privilege.template.familyGame.title'), desc: t('privilege.template.familyGame.desc'), cost: 5, icon: '🎲', category: '娱乐选择' },
  { title: t('privilege.template.game15.title'), desc: t('privilege.template.game15.desc'), cost: 5, icon: '🎮', category: '娱乐选择', gameMinutes: 15 },
];

const PRIVILEGE_CATEGORIES = ['家庭选择权', '亲子体验', '任务自主', '娱乐选择', '家庭活动', '其他'];

const PRIVILEGE_GUIDE = [
  { label: '小特权', cost: 3, desc: '5-15 分钟、低成本、可频繁兑现' },
  { label: '中等奖励', cost: 8, desc: '30-60 分钟或一次小选择权' },
  { label: '大目标', cost: 20, desc: '需要多天积累，适合玩具或外出类' },
];

export default function ParentPrivileges() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [list, setList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const { showTemplates, selectedIndexes, selectedCount, toggleTemplate, isSelected, openTemplates, closeTemplates } = useTemplateSelector();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');
  const [icon, setIcon] = useState('👑');
  const [category, setCategory] = useState('家庭选择权');
  const [gameMinutes, setGameMinutes] = useState('0');
  const [editGameMinutes, setEditGameMinutes] = useState('0');
  const [editEnabled, setEditEnabled] = useState(true);

  // 编辑状态
  const [editingPrivilege, setEditingPrivilege] = useState<any>(null);
  const [editIcon, setEditIcon] = useState('👑');
  const [level, setLevel] = useState('bronze');
  const [editLevel, setEditLevel] = useState('bronze');
  const [editCategory, setEditCategory] = useState('其他');

  // 时间限制设置
  const [timeWindowEnabled, setTimeWindowEnabled] = useState(false);
  const [timeWindowStart, setTimeWindowStart] = useState('08:00');
  const [timeWindowEnd, setTimeWindowEnd] = useState('21:00');
  const [timeWindowDays, setTimeWindowDays] = useState<number[]>([1,2,3,4,5,6,0]);

  // 编辑状态 - 时间限制
  const [editTimeWindowEnabled, setEditTimeWindowEnabled] = useState(false);
  const [editTimeWindowStart, setEditTimeWindowStart] = useState('08:00');
  const [editTimeWindowEnd, setEditTimeWindowEnd] = useState('21:00');
  const [editTimeWindowDays, setEditTimeWindowDays] = useState<number[]>([1,2,3,4,5,6,0]);

  useEffect(() => { fetchList(); }, []);
  const fetchList = async () => {
    try {
      const res = await api.get('/parent/privileges');
      setList(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error('获取特权列表失败:', error);
      setList([]);
      toast.error('特权列表暂时无法加载，请稍后重试');
    }
  };

  // 打开编辑
  const openEdit = (p: any) => {
    setEditingPrivilege(p);
    setTitle(p.title);
    setDesc(p.description || '');
    setCost(String(p.cost));
    setEditIcon(p.icon || '👑');
    setEditLevel(p.level || 'bronze');
    setEditCategory(p.category || '其他');
    setEditGameMinutes(String(p.game_minutes || 0));
    setEditEnabled(p.is_enabled !== 0);
    // 解析时间限制
    if (p.timeWindow) {
      try {
        const tw = JSON.parse(p.timeWindow);
        setEditTimeWindowEnabled(tw.enabled || false);
        setEditTimeWindowStart(tw.start || '08:00');
        setEditTimeWindowEnd(tw.end || '21:00');
        setEditTimeWindowDays(tw.days || [1,2,3,4,5,6,0]);
      } catch {
        setEditTimeWindowEnabled(false);
      }
    } else {
      setEditTimeWindowEnabled(false);
      setEditTimeWindowStart('08:00');
      setEditTimeWindowEnd('21:00');
      setEditTimeWindowDays([1,2,3,4,5,6,0]);
    }
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingPrivilege) return;
    if (!title || !title.trim()) return toast.warning('请输入特权名称');
    if (title.trim().length > 50) return toast.warning('特权名称不能超过50个字');
    const costNum = Number(cost);
    if (isNaN(costNum) || costNum < 0 || costNum > 999999) return toast.warning('特权点必须是 0-999999 之间的数字');
    try {
      const timeWindow = editTimeWindowEnabled
        ? JSON.stringify({ enabled: true, start: editTimeWindowStart, end: editTimeWindowEnd, days: editTimeWindowDays })
        : null;
      await api.put(`/parent/privileges/${editingPrivilege.id}`, {
        title, description: desc, cost: +cost, icon: editIcon, level: editLevel, timeWindow,
        category: editCategory || '其他', isEnabled: editEnabled ? 1 : 0,
        gameMinutes: Math.max(0, Number(editGameMinutes) || 0)
      });
      setEditingPrivilege(null);
      setTitle(''); setDesc(''); setCost(''); setEditIcon('👑'); setEditLevel('bronze'); setEditCategory('其他');
      fetchList();
    } catch {
      toast.error('保存失败');
    }
  };

  const handleAdd = async () => {
    if (!title || !title.trim()) return toast.warning('请输入标题');
    if (title.trim().length > 50) return toast.warning('特权名称不能超过50个字');
    const costNum = Number(cost);
    if (isNaN(costNum) || costNum < 0 || costNum > 999999) return toast.warning('特权点必须是 0-999999 之间的数字');
    const timeWindow = timeWindowEnabled
      ? JSON.stringify({ enabled: true, start: timeWindowStart, end: timeWindowEnd, days: timeWindowDays })
      : null;
    await api.post('/parent/privileges', { title, description: desc, cost: +cost, icon, level, timeWindow, category, gameMinutes: Math.max(0, Number(gameMinutes) || 0) });
    setShowAdd(false); setTitle(''); setDesc(''); setCost(''); setIcon('👑'); setLevel('bronze'); setCategory('家庭选择权'); setGameMinutes('0'); setTimeWindowEnabled(false);
    toast.success('添加成功');
    fetchList();
  };

  const handleDelete = async (privilege: any) => {
    const confirmed = await confirm({
      title: privilege.is_preset ? '停用系统特权' : '删除特权',
      message: privilege.is_preset ? '停用后孩子端不再显示，之后仍可在编辑中重新启用。' : '确定删除这个特权吗？',
      type: 'danger',
      confirmText: privilege.is_preset ? '停用' : '删除',
    });
    if (!confirmed) return;
    await api.delete(`/parent/privileges/${privilege.id}`);
    toast.success(privilege.is_preset ? '已停用' : '删除成功');
    fetchList();
  };

  const handleAddTemplates = async () => {
    if (selectedCount === 0) return toast.warning('请至少选择一个特权模板');

    try {
      for (const index of selectedIndexes) {
        const template = PRIVILEGE_TEMPLATES[index];
        await api.post('/parent/privileges', {
          title: template.title,
          description: template.desc,
          cost: template.cost,
          icon: template.icon,
          category: template.category,
          level: 'bronze',
          gameMinutes: 'gameMinutes' in template ? template.gameMinutes : 0,
          isPreset: 1
        });
      }
      toast.success(`成功添加 ${selectedCount} 个特权！`);
      closeTemplates();
      fetchList();
    } catch {
      toast.error('添加失败');
    }
  };

  // 按类别分组模板
  const groupedTemplates = PRIVILEGE_TEMPLATES.reduce((acc, template, index) => {
    if (!acc[template.category]) acc[template.category] = [];
    acc[template.category].push({ ...template, index });
    return acc;
  }, {} as Record<string, (typeof PRIVILEGE_TEMPLATES[0] & { index: number })[]>);

  const groupedPrivileges = list.reduce((acc, item) => {
    const group = item.category || '其他';
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const privilegeCategoryOrder = Array.from(new Set([
    ...PRIVILEGE_CATEGORIES,
    ...Object.keys(groupedPrivileges),
  ])).filter(cat => groupedPrivileges[cat]?.length);

  return (
    <Layout>
      <Header title="特权管理" showBack onBack={() => navigate('/parent/dashboard')} />

      {/* 新建特权 - 底部抽屉 */}
      <BottomSheet
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        title="👑 新建特权"
        footer={
          <div className="flex gap-3">
            <Button onClick={handleAdd} className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 border-none">保存特权</Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
              <IconPicker value={icon} onChange={setIcon} categories={['time', 'chores', 'entertainment', 'outing', 'food', 'emoji']} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">特权名称</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none transition-all" placeholder="例如：周末晚睡一小时" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">描述</label>
            <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" placeholder="简短描述（可选）" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">分类</label>
            <select className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" value={category} onChange={e => setCategory(e.target.value)}>
              {PRIVILEGE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">💎 兑换消耗 (特权点)</label>
            <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" type="number" placeholder="1" value={cost} onChange={e => setCost(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{t('privileges.costHint')}</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">🎮 {t('privilege.form.gameMinutes')}</label>
            <input className="w-full min-h-[44px] p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" type="number" min="0" max="120" value={gameMinutes} onChange={e => setGameMinutes(e.target.value)} />
            <p className="text-[11px] text-gray-400 mt-1">{t('privilege.form.gameMinutesHint')}</p>
          </div>
          <div className="p-3 rounded-xl border border-purple-100 bg-purple-50 text-xs text-purple-800">
            <div className="font-bold mb-2">特权点规则助手</div>
            <div className="mb-2">特权点建议和金币分离：金币对应商品价值，特权点对应“选择权/服务/时间”。孩子通常每 30 分钟认真任务获得 1 点更容易理解。</div>
            <div className="grid grid-cols-3 gap-2">
              {PRIVILEGE_GUIDE.map(item => (
                <button key={item.label} type="button" onClick={() => setCost(String(item.cost))} className="rounded-lg bg-white border border-purple-100 p-2 text-left">
                  <div className="font-bold">{item.label}</div>
                  <div className="text-purple-600 font-bold">{item.cost} 点</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-bold block mb-1">🏅 特权层级</label>
            <div className="flex gap-2">
              {[
                { id: 'diamond', label: '钻石 💎' },
                { id: 'gold', label: '黄金 🥇' },
                { id: 'silver', label: '白银 🥈' },
                { id: 'bronze', label: '青铜 🥉' }
              ].map(lvl => (
                <button
                  key={lvl.id}
                  onClick={() => setLevel(lvl.id)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                    level === lvl.id ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-100 bg-gray-50 text-gray-500'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>
          <TimeWindowEditor
            enabled={timeWindowEnabled}
            start={timeWindowStart}
            end={timeWindowEnd}
            days={timeWindowDays}
            onToggle={setTimeWindowEnabled}
            onChangeStart={setTimeWindowStart}
            onChangeEnd={setTimeWindowEnd}
            onChangeDays={setTimeWindowDays}
          />
        </div>
      </BottomSheet>

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <ParentGameTimePrivilegeApprovals />
        <CreateActionCard
          icon="👑"
          title="把“选择权”做成孩子能期待的特权"
          description="特权更适合时间、服务、外出和亲子活动，不建议和普通商品混在一起定价。"
          primaryLabel="👑 新建特权"
          onPrimary={() => setShowAdd(true)}
          primaryClassName="bg-purple-600 border-none"
          secondaryLabel="从模板添加"
          secondaryIcon={<Sparkles size={15} />}
          onSecondary={openTemplates}
          tone="from-purple-50 to-pink-50 border-purple-100"
        />

        {/* 空状态 */}
        {list.length === 0 && !showAdd && !showTemplates && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">👑</div>
            <div className="text-gray-500 mb-4">还没有特权哦</div>
            <div className="flex flex-col gap-2">
              <button onClick={openTemplates} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all">
                <Sparkles size={18}/> 从模板快速添加
              </button>
              <button onClick={() => setShowAdd(true)} className="text-purple-600 font-medium text-sm">
                或手动创建特权
              </button>
            </div>
          </div>
        )}

        {/* 模板选择界面 */}
        {showTemplates && (
          <div className="animate-in fade-in pb-20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="text-purple-500" size={20}/> 选择特权模板
              </h3>
              <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
            </div>

            <p className="text-xs text-gray-500 mb-4 bg-purple-50 p-3 rounded-lg">
              💡 特权是孩子用特权点兑换的服务性奖励，完成任务可获得特权点。选择适合您家庭的特权吧！
            </p>

            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-4">
                <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">{cat}类特权</div>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map(template => (
                    <button
                      key={template.index}
                      onClick={() => toggleTemplate(template.index)}
                      className={`p-3 rounded-xl text-left transition-all border-2 ${
                        isSelected(template.index)
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-xl">{template.icon}</span>
                        {isSelected(template.index) && <Check size={16} className="text-purple-500"/>}
                      </div>
                      <div className="font-bold text-sm mt-1 text-gray-800">{template.title}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{template.desc}</div>
                      <div className="text-xs text-purple-600 font-bold mt-1">{template.cost} 特权点</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 模板选择底部操作栏 - 绝对定位 + 安全区域 */}
        {showTemplates && (
          <div className="absolute bottom-0 left-0 right-0 bg-white py-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t shadow-[0_-4px_12px_rgba(0,0,0,0.1)] z-20 flex gap-2">
            <Button onClick={closeTemplates} variant="ghost" className="flex-1">取消</Button>
            <Button onClick={handleAddTemplates} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 border-none" disabled={selectedCount === 0}>
              添加 {selectedCount} 个特权
            </Button>
          </div>
        )}

        {/* 已有特权列表 */}
        {list.length > 0 && !showTemplates && (
          <>
            <button onClick={openTemplates} className="w-full p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-center justify-center gap-2 text-purple-600 font-medium text-sm hover:from-purple-100 hover:to-pink-100 transition-all mb-2">
              <Sparkles size={16}/> 从模板快速添加更多特权
            </button>

            {privilegeCategoryOrder.map((cat, index) => (
              <details key={cat} open={index === 0} className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                <summary className="cursor-pointer list-none flex items-center justify-between">
                  <span className="text-sm font-black text-gray-800">{cat}类特权</span>
                  <span className="text-[10px] text-gray-400 font-bold">{groupedPrivileges[cat].length} 项 · 展开/收起</span>
                </summary>
                <div className="space-y-2 mt-3">
                {groupedPrivileges[cat].map((p: any) => (
                  <Card key={p.id} className="flex justify-between items-center">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                        {p.icon || '👑'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold truncate">{p.title}</div>
                        <div className="text-xs text-gray-500 truncate">{p.description}</div>
                        <div className="text-[10px] text-purple-500 mt-1 bg-purple-50 inline-block px-2 py-0.5 rounded-full">{p.category || '其他'}</div>
                        {Number(p.game_minutes || 0) > 0 && <div className="text-[10px] text-amber-700 mt-1">🎮 {t('privilege.item.gameMinutes', { minutes: p.game_minutes })}</div>}
                        {p.is_enabled === 0 && <div className="text-[10px] text-gray-400 mt-1">{t('privilege.item.disabled')}</div>}
                        {/* 时间限制标签 */}
                        {p.timeWindow && (() => {
                          try {
                            const tw = JSON.parse(p.timeWindow);
                            if (tw.enabled) {
                              const dayNames = ['日','一','二','三','四','五','六'];
                              const daysText = tw.days?.length === 7 ? '每天' : tw.days?.map((d: number) => dayNames[d]).join('、');
                              return (
                                <div className="text-[10px] text-indigo-600 mt-1">
                                  ⏰ {tw.start}-{tw.end} {daysText}
                                </div>
                              );
                            }
                          } catch { /* 忽略：数据解析失败时不展示该项 */ }
                          return null;
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`text-xs font-bold px-2 py-1 rounded-lg ${
                          p.level === 'diamond' ? 'bg-cyan-100 text-cyan-700' :
                          p.level === 'gold' ? 'bg-yellow-100 text-yellow-700' :
                          p.level === 'silver' ? 'bg-gray-200 text-gray-700' :
                          'bg-orange-100 text-orange-700'
                      }`}>
                        {p.level === 'diamond' ? '💎 钻石' :
                         p.level === 'gold' ? '🥇 黄金' :
                         p.level === 'silver' ? '🥈 白银' : '🥉 青铜'}
                      </div>
                      <div className="font-bold text-purple-600 text-sm bg-purple-50 px-2 py-1 rounded-lg">{p.cost} 点</div>
                      <button onClick={() => openEdit(p)} className="text-purple-400 hover:text-purple-600 min-w-[44px] min-h-[44px] flex items-center justify-center"><Pen size={16}/></button>
                      <button onClick={() => handleDelete(p)} className="text-red-400 hover:text-red-600 min-w-[44px] min-h-[44px] flex items-center justify-center"><Trash2 size={16}/></button>
                    </div>
                  </Card>
                ))}
                </div>
              </details>
            ))}
          </>
        )}

        <BottomSheet
          isOpen={Boolean(editingPrivilege)}
          onClose={() => setEditingPrivilege(null)}
          title="编辑特权"
          footer={
            <div className="flex gap-3">
              <Button onClick={handleSaveEdit} className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 border-none">保存修改</Button>
              <Button variant="ghost" onClick={() => setEditingPrivilege(null)} className="flex-1 py-3">取消</Button>
            </div>
          }
        >
          {editingPrivilege && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div>
                    <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
                    <IconPicker value={editIcon} onChange={setEditIcon} categories={['time', 'chores', 'entertainment', 'outing', 'food', 'emoji']} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold block mb-1">特权名称</label>
                    <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" value={title} onChange={e => setTitle(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-bold block mb-1">描述</label>
                  <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" placeholder="简短描述（可选）" value={desc} onChange={e => setDesc(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-bold block mb-1">分类</label>
                  <select className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" value={editCategory} onChange={e => setEditCategory(e.target.value)}>
                    {PRIVILEGE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-bold block mb-1">💎 兑换消耗 (特权点)</label>
                  <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" type="number" value={cost} onChange={e => setCost(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-bold block mb-1">🎮 {t('privilege.form.gameMinutes')}</label>
                  <input className="w-full min-h-[44px] p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none" type="number" min="0" max="120" value={editGameMinutes} onChange={e => setEditGameMinutes(e.target.value)} />
                </div>
                <label className="min-h-[44px] flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700">
                  <input type="checkbox" checked={editEnabled} onChange={e => setEditEnabled(e.target.checked)} className="w-5 h-5 accent-purple-600" />
                  {t('privilege.form.childEnabled')}
                </label>
                <div className="p-3 rounded-xl border border-purple-100 bg-purple-50 text-xs text-purple-800">
                  <div className="font-bold mb-2">特权点规则助手</div>
                  <div className="mb-2">小特权 3 点，中等奖励 8 点，大目标 20 点起；家长仍可按家庭规则微调。</div>
                  <div className="grid grid-cols-3 gap-2">
                    {PRIVILEGE_GUIDE.map(item => (
                      <button key={item.label} type="button" onClick={() => setCost(String(item.cost))} className="rounded-lg bg-white border border-purple-100 p-2 text-left">
                        <div className="font-bold">{item.label}</div>
                        <div className="text-purple-600 font-bold">{item.cost} 点</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-bold block mb-1">🏅 特权层级</label>
                  <div className="flex gap-2">
                    {[
                      { id: 'diamond', label: '钻石 💎' },
                      { id: 'gold', label: '黄金 🥇' },
                      { id: 'silver', label: '白银 🥈' },
                      { id: 'bronze', label: '青铜 🥉' }
                    ].map(lvl => (
                      <button
                        key={lvl.id}
                        onClick={() => setEditLevel(lvl.id)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                          editLevel === lvl.id ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-100 bg-gray-50 text-gray-500'
                        }`}
                      >
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                </div>
                <TimeWindowEditor
                  enabled={editTimeWindowEnabled}
                  start={editTimeWindowStart}
                  end={editTimeWindowEnd}
                  days={editTimeWindowDays}
                  onToggle={setEditTimeWindowEnabled}
                  onChangeStart={setEditTimeWindowStart}
                  onChangeEnd={setEditTimeWindowEnd}
                  onChangeDays={setEditTimeWindowDays}
                />
              </div>
          )}
        </BottomSheet>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
