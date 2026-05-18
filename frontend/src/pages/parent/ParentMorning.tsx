import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, Edit2, Plus, Trash2, Utensils } from 'lucide-react';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { BottomSheet } from '../../components/BottomSheet';
import { CreateActionCard } from '../../components/CreateActionCard';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import api from '../../services/api';

type BreakfastItem = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  category: string;
  costCoins: number;
  isActive: number;
  isDefault?: number;
};

type BreakfastPlan = {
  id: string;
  childId: string;
  planDate: string;
  defaultItemId: string;
  optionItemIds: string[];
  note?: string;
  defaultItem?: BreakfastItem | null;
  optionItems?: BreakfastItem[];
};

const BREAKFAST_CATEGORIES = ['套餐', '主食', '蛋白', '水果', '饮品', '小食', '其他'];

const emptyBreakfast = () => ({
  title: '',
  description: '',
  icon: '🥪',
  category: '主食',
  costCoins: 0,
});

const toDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getWeekDates = (dateKey: string) => {
  const base = new Date(`${dateKey}T00:00:00`);
  const mondayOffset = (base.getDay() + 6) % 7;
  const monday = addDays(base, -mondayOffset);
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return names.map((label, index) => {
    const date = addDays(monday, index);
    return { label, date: toDateKey(date), day: `${date.getMonth() + 1}.${date.getDate()}` };
  });
};

export default function ParentMorning() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [items, setItems] = useState<BreakfastItem[]>([]);
  const [overview, setOverview] = useState<any[]>([]);
  const [plans, setPlans] = useState<BreakfastPlan[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [breakfastForm, setBreakfastForm] = useState<any>(emptyBreakfast());
  const [editingBreakfastId, setEditingBreakfastId] = useState('');
  const [showBreakfastSheet, setShowBreakfastSheet] = useState(false);

  const [showPlanSheet, setShowPlanSheet] = useState(false);
  const [planForm, setPlanForm] = useState({
    childId: '',
    planDate: selectedDate,
    defaultItemId: '',
    optionItemIds: [] as string[],
    note: '',
  });

  const activeItems = useMemo(() => items.filter(item => Number(item.isActive) !== 0), [items]);
  const groupedActiveItems = useMemo(() => {
    const groups = new Map<string, BreakfastItem[]>();
    activeItems.forEach(item => {
      const key = item.category || '其他';
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [
      ...BREAKFAST_CATEGORIES.filter(category => groups.has(category)).map(category => [category, groups.get(category)!] as const),
      ...Array.from(groups.entries()).filter(([category]) => !BREAKFAST_CATEGORIES.includes(category)),
    ];
  }, [activeItems]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const week = getWeekDates(selectedDate);
      const [itemsRes, overviewRes, plansRes] = await Promise.all([
        api.get('/parent/breakfast-items'),
        api.get('/parent/morning-overview', { params: { date: selectedDate } }),
        api.get('/parent/breakfast-plans', { params: { startDate: week[0].date, endDate: week[6].date } }),
      ]);
      setItems(itemsRes.data || []);
      setOverview(overviewRes.data?.rows || []);
      setPlans(plansRes.data?.plans || []);
    } catch (e) {
      toast.error('早餐数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [selectedDate]);

  const getPlan = (childId: string, date = selectedDate) => (
    plans.find(plan => plan.childId === childId && plan.planDate === date)
  );

  const openPlanSheet = (date = selectedDate, childId = overview[0]?.id || '') => {
    const plan = childId ? getPlan(childId, date) : undefined;
    setPlanForm({
      childId,
      planDate: date,
      defaultItemId: plan?.defaultItemId || '',
      optionItemIds: plan?.optionItemIds || [],
      note: plan?.note || '',
    });
    setShowPlanSheet(true);
  };

  const savePlan = async () => {
    if (!planForm.childId) return toast.warning('请选择孩子');
    if (!planForm.defaultItemId && planForm.optionItemIds.length === 0) return toast.warning('请至少选择一个早餐内容');
    setSaving(true);
    try {
      await api.post('/parent/breakfast-plans', planForm);
      toast.success('早餐计划已保存');
      setShowPlanSheet(false);
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (plan?: BreakfastPlan) => {
    if (!plan) return;
    await api.delete(`/parent/breakfast-plans/${plan.id}`);
    toast.success('早餐计划已删除');
    fetchData();
  };

  const saveBreakfast = async () => {
    if (!breakfastForm.title.trim()) return toast.warning('请输入早餐名称');
    setSaving(true);
    try {
      if (editingBreakfastId) {
        await api.put(`/parent/breakfast-items/${editingBreakfastId}`, breakfastForm);
        toast.success('早餐项已更新');
      } else {
        await api.post('/parent/breakfast-items', breakfastForm);
        toast.success('早餐项已新增');
      }
      setBreakfastForm(emptyBreakfast());
      setEditingBreakfastId('');
      setShowBreakfastSheet(false);
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const editBreakfast = (item: BreakfastItem) => {
    setEditingBreakfastId(item.id);
    setBreakfastForm({
      title: item.title,
      description: item.description || '',
      icon: item.icon || '🥪',
      category: item.category || '主食',
      costCoins: Number(item.costCoins || 0),
      isActive: Boolean(item.isActive),
    });
    setShowBreakfastSheet(true);
  };

  const stopBreakfast = async (item: BreakfastItem) => {
    const confirmed = await confirm({
      title: '删除早餐项',
      message: `确认从早餐库删除「${item.title}」？历史选择记录会保留名称和金币，未来计划会移除这个选项。`,
      confirmText: '删除',
      cancelText: '取消',
      type: 'danger',
    });
    if (!confirmed) return;
    await api.delete(`/parent/breakfast-items/${item.id}`);
    toast.success('早餐项已删除');
    fetchData();
  };

  const updateOrderStatus = async (orderId: string, status: 'served' | 'cancelled') => {
    await api.post(`/parent/breakfast-orders/${orderId}/status`, { status });
    toast.success(status === 'served' ? '已标记准备完成' : '已取消并退回金币');
    fetchData();
  };

  const toggleOption = (itemId: string) => {
    setPlanForm(prev => ({
      ...prev,
      optionItemIds: prev.optionItemIds.includes(itemId)
        ? prev.optionItemIds.filter(id => id !== itemId)
        : [...prev.optionItemIds, itemId],
    }));
  };

  return (
    <Layout>
      <Header title="早餐小厨房" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 pb-20 space-y-4 overflow-y-auto flex-1">
        <Card className="bg-gradient-to-br from-amber-50 to-sky-50 border-amber-100">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white text-amber-500 flex items-center justify-center shadow-sm">
              <Utensils size={26} />
            </div>
            <div>
              <div className="font-black text-gray-800">早餐计划</div>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                家长维护早餐组件库，并按日期给出当天可选范围。孩子端按分类自由组合，免费项和升级项会自动结算。
              </p>
            </div>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-black text-gray-800 flex items-center gap-2">
              <CalendarDays size={20} className="text-blue-500" /> 本周预选
            </div>
            <Button size="sm" onClick={() => openPlanSheet()} className="bg-blue-500 border-none">
              <Plus size={14} /> 设置
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weekDates.map(day => (
              <button
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                className={`rounded-2xl px-1 py-2 text-center border transition-all ${
                  selectedDate === day.date ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 text-gray-500 border-gray-100'
                }`}
              >
                <div className="text-[10px] font-black">{day.label}</div>
                <div className="text-[10px] mt-0.5">{day.day}</div>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : overview.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">暂无孩子成员</div>
          ) : (
            <div className="space-y-2">
              {overview.map(row => {
                const plan = getPlan(row.id);
                return (
                  <div key={row.id} className="rounded-2xl border border-gray-100 bg-white p-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-sky-50 flex items-center justify-center text-2xl">{row.avatar || '🙂'}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-gray-800">{row.name}</div>
                        <div className="text-xs text-gray-500">
                          {row.order ? `已选 ${row.order.title}` : '还未组合早餐'}
                        </div>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => openPlanSheet(selectedDate, row.id)}>计划</Button>
                    </div>

                    <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3">
                      <div className="text-[11px] font-black text-amber-600">家长推荐</div>
                      <div className="mt-1 font-black text-gray-800">
                        {plan?.defaultItem ? `${plan.defaultItem.icon || '🥪'} ${plan.defaultItem.title}` : '不预设默认项'}
                      </div>
                      {plan?.optionItems?.length ? (
                        <div className="mt-1 text-xs text-gray-500">
                          当天可选：{plan.optionItems.map(item => `${item.icon || '🥪'} ${item.title}`).join(' / ')}
                        </div>
                      ) : null}
                      {!plan && <div className="mt-1 text-xs text-gray-500">还没有设置今天的可选早餐。</div>}
                      {plan?.note ? <div className="mt-2 text-xs text-amber-700">{plan.note}</div> : null}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-orange-600 truncate">
                        {row.order ? `${row.order.icon || '🍽️'} ${row.order.title} · ${row.order.status === 'served' ? '已吃完' : '孩子已保存'}` : '孩子还未保存组合'}
                      </div>
                      <div className="flex gap-2">
                        {plan && <button onClick={() => deletePlan(plan)} className="p-2 text-red-500"><Trash2 size={16} /></button>}
                        {row.order && row.order.status === 'ordered' && (
                          <>
                            <Button size="sm" onClick={() => updateOrderStatus(row.order.id, 'served')} className="bg-emerald-500 border-none"><Check size={14} /> 已吃</Button>
                            <Button size="sm" variant="danger" onClick={() => updateOrderStatus(row.order.id, 'cancelled')}>取消</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <CreateActionCard
          icon={<Utensils size={24} className="text-orange-500" />}
          title="早餐库"
          description="维护主食、饮品、蛋白、水果、套餐等早餐内容。孩子端会按同样分类组合。"
          primaryLabel="新建早餐内容"
          onPrimary={() => {
            setEditingBreakfastId('');
            setBreakfastForm(emptyBreakfast());
            setShowBreakfastSheet(true);
          }}
          primaryClassName="bg-orange-500 border-none"
          tone="from-orange-50 to-amber-50 border-orange-100"
        />

        <Card className="space-y-2">
          {activeItems.map(item => (
            <div key={item.id} className={`rounded-2xl border p-3 flex items-center gap-3 ${item.isActive ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
              <div className="w-11 h-11 rounded-2xl bg-orange-50 flex items-center justify-center text-2xl">{item.icon || '🥪'}</div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{item.title}</div>
                <div className="text-xs text-gray-500">{item.category} · {item.costCoins > 0 ? `${item.costCoins} 金币` : '免费'}{item.isDefault ? ' · 默认' : ''}</div>
              </div>
              <button onClick={() => editBreakfast(item)} className="p-2 text-blue-500"><Edit2 size={17} /></button>
              <button onClick={() => stopBreakfast(item)} className="p-2 text-red-500"><Trash2 size={17} /></button>
            </div>
          ))}
          {activeItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-bold text-gray-400">
              还没有可选早餐，先新建一个基础早餐。
            </div>
          )}
        </Card>

      </div>

      <BottomSheet
        isOpen={showPlanSheet}
        onClose={() => setShowPlanSheet(false)}
        title="设置早餐计划"
        footer={
          <div className="flex gap-3">
            <Button onClick={savePlan} loading={saving} className="flex-1 py-3 bg-blue-500 border-none">保存计划</Button>
            <Button variant="ghost" onClick={() => setShowPlanSheet(false)} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="日期">
            <input type="date" value={planForm.planDate} onChange={e => setPlanForm({ ...planForm, planDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
          </Field>
          <Field label="孩子">
            <select value={planForm.childId} onChange={e => setPlanForm({ ...planForm, childId: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50">
              <option value="">请选择孩子</option>
              {overview.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
            </select>
          </Field>
          <Field label="家长推荐">
            <select value={planForm.defaultItemId} onChange={e => setPlanForm({ ...planForm, defaultItemId: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50">
              <option value="">不预设默认项</option>
              {activeItems.map(item => <option key={item.id} value={item.id}>{item.icon || '🥪'} {item.title} · {item.costCoins > 0 ? `${item.costCoins} 金币` : '免费'}</option>)}
            </select>
          </Field>
          <div>
            <div className="text-[11px] font-black text-gray-500 mb-2">当天可选内容</div>
            <div className="space-y-3">
              {groupedActiveItems.map(([category, categoryItems]) => (
                <div key={category} className="rounded-2xl border border-gray-100 bg-gray-50 p-2">
                  <div className="text-[11px] font-black text-gray-500 mb-2">{category}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {categoryItems.filter(item => item.id !== planForm.defaultItemId).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleOption(item.id)}
                        className={`rounded-2xl border p-3 text-left ${planForm.optionItemIds.includes(item.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-100'}`}
                      >
                        <div className="text-xl">{item.icon || '🥪'}</div>
                        <div className="mt-1 text-xs font-black text-gray-800">{item.title}</div>
                        <div className="text-[10px] text-gray-500">{item.costCoins > 0 ? `${item.costCoins} 金币` : '免费'}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Field label="给孩子的说明">
            <textarea value={planForm.note} onChange={e => setPlanForm({ ...planForm, note: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50 min-h-[80px]" placeholder="例如：今天有体育课，推荐蛋白质多一点。" />
          </Field>
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={showBreakfastSheet}
        onClose={() => setShowBreakfastSheet(false)}
        title={editingBreakfastId ? '编辑早餐' : '新建早餐'}
        footer={
          <div className="flex gap-3">
            <Button onClick={saveBreakfast} loading={saving} className="flex-1 py-3 bg-orange-500 border-none">
              {editingBreakfastId ? '保存早餐' : '新增早餐'}
            </Button>
            <Button variant="ghost" onClick={() => setShowBreakfastSheet(false)} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="图标">
              <input value={breakfastForm.icon} onChange={e => setBreakfastForm({ ...breakfastForm, icon: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
            </Field>
            <Field label="分类">
              <select value={breakfastForm.category} onChange={e => setBreakfastForm({ ...breakfastForm, category: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50">
                {BREAKFAST_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </Field>
          </div>
          <Field label="名称">
            <input value={breakfastForm.title} onChange={e => setBreakfastForm({ ...breakfastForm, title: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50" placeholder="例如：鸡蛋三明治" />
          </Field>
          <Field label="说明">
            <input value={breakfastForm.description} onChange={e => setBreakfastForm({ ...breakfastForm, description: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-gray-50" placeholder="告诉孩子为什么值得选" />
          </Field>
          <Field label="金币消耗">
            <input type="number" min={0} value={breakfastForm.costCoins} onChange={e => setBreakfastForm({ ...breakfastForm, costCoins: Number(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-xl border bg-gray-50" />
          </Field>
          {editingBreakfastId && (
            <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
              <input type="checkbox" checked={Boolean(breakfastForm.isActive)} onChange={e => setBreakfastForm({ ...breakfastForm, isActive: e.target.checked })} />
              启用这个早餐项
            </label>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog />
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
