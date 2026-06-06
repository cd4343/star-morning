import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Check, Edit2, Trash2, Utensils } from 'lucide-react';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { BottomSheet } from '../../components/BottomSheet';
import { CreateActionCard } from '../../components/CreateActionCard';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { IconPicker } from '../../components/IconPicker';
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

const BREAKFAST_CATEGORIES = ['套餐', '主食', '蛋白', '水果', '饮品', '小食', '其他'];

const emptyBreakfast = () => ({
  title: '',
  description: '',
  icon: '🥪',
  category: '主食',
  costCoins: 0,
  isActive: true,
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
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [breakfastForm, setBreakfastForm] = useState<any>(emptyBreakfast());
  const [editingBreakfastId, setEditingBreakfastId] = useState('');
  const [showBreakfastSheet, setShowBreakfastSheet] = useState(false);

  const activeCount = useMemo(() => items.filter(item => Number(item.isActive) !== 0).length, [items]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const groupedItems = useMemo(() => {
    const groups = new Map<string, BreakfastItem[]>();
    items.forEach(item => {
      const key = item.category || '其他';
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [
      ...BREAKFAST_CATEGORIES.filter(category => groups.has(category)).map(category => [category, groups.get(category)!] as const),
      ...Array.from(groups.entries()).filter(([category]) => !BREAKFAST_CATEGORIES.includes(category)),
    ];
  }, [items]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [itemsRes, overviewRes] = await Promise.all([
        api.get('/parent/breakfast-items'),
        api.get('/parent/morning-overview', { params: { date: selectedDate } }),
      ]);
      setItems(itemsRes.data || []);
      setOverview(overviewRes.data?.rows || []);
    } catch (e) {
      toast.error('早餐数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [selectedDate]);

  const saveBreakfast = async () => {
    if (!breakfastForm.title.trim()) return toast.warning('请输入早餐名称');
    const payload = {
      ...breakfastForm,
      title: breakfastForm.title.trim(),
      description: String(breakfastForm.description || '').trim(),
      icon: String(breakfastForm.icon || '').trim() || '🥣',
      category: breakfastForm.category || '主食',
      costCoins: Math.max(0, Number(breakfastForm.costCoins || 0)),
      isActive: breakfastForm.isActive ? 1 : 0,
    };
    setSaving(true);
    try {
      if (editingBreakfastId) {
        await api.put(`/parent/breakfast-items/${editingBreakfastId}`, payload);
        toast.success('早餐内容已更新');
      } else {
        await api.post('/parent/breakfast-items', payload);
        toast.success('早餐内容已新增');
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
      isActive: Number(item.isActive) !== 0,
    });
    setShowBreakfastSheet(true);
  };

  const deleteBreakfast = async (item: BreakfastItem) => {
    const confirmed = await confirm({
      title: '删除早餐内容',
      message: `确认从早餐库删除「${item.title}」？历史选择记录会保留名称和金币。`,
      confirmText: '删除',
      cancelText: '取消',
      type: 'danger',
    });
    if (!confirmed) return;
    await api.delete(`/parent/breakfast-items/${item.id}`);
    toast.success('早餐内容已删除');
    fetchData();
  };

  const updateOrderStatus = async (orderId: string, status: 'served' | 'cancelled') => {
    await api.post(`/parent/breakfast-orders/${orderId}/status`, { status });
    toast.success(status === 'served' ? '已标记吃完' : '已取消并退回金币');
    fetchData();
  };

  return (
    <Layout>
      <Header title="早餐管理" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 pb-20 space-y-4 overflow-y-auto flex-1">
        <Card className="bg-gradient-to-br from-amber-50 to-sky-50 border-amber-100">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white text-amber-500 flex items-center justify-center shadow-sm">
              <Utensils size={26} />
            </div>
            <div>
              <div className="font-black text-gray-800">早餐库和孩子选择</div>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                家长只维护可选早餐、分类和金币价格。孩子端每天自由组合，免费项不扣金币，升级项自动结算。
              </p>
            </div>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-black text-gray-800 flex items-center gap-2">
              <CalendarDays size={20} className="text-orange-500" /> 孩子早餐选择
            </div>
            <div className="text-[10px] font-black text-gray-400">按日期查看</div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weekDates.map(day => (
              <button
                key={day.date}
                onClick={() => setSelectedDate(day.date)}
                className={`rounded-2xl px-1 py-2 text-center border transition-all ${
                  selectedDate === day.date ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-gray-50 text-gray-500 border-gray-100'
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
              {overview.map(row => (
                <div key={row.id} className="rounded-2xl border border-gray-100 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-sky-50 flex items-center justify-center text-2xl">{row.avatar || '🙂'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-gray-800">{row.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {row.order ? `${row.order.icon || '🍽️'} ${row.order.title}` : '孩子还没有保存早餐组合'}
                      </div>
                      {row.order && (
                        <div className="text-[10px] font-bold text-orange-600 mt-0.5">
                          {row.order.costCoins > 0 ? `${row.order.costCoins} 金币` : '免费'} · {row.order.status === 'served' ? '已吃完' : '已保存'}
                        </div>
                      )}
                    </div>
                    {row.order && row.order.status === 'ordered' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateOrderStatus(row.order.id, 'served')} className="bg-emerald-500 border-none"><Check size={14} /> 已吃</Button>
                        <Button size="sm" variant="danger" onClick={() => updateOrderStatus(row.order.id, 'cancelled')}>取消</Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <CreateActionCard
          icon={<Utensils size={24} className="text-orange-500" />}
          title="早餐库"
          description={`当前 ${activeCount} 个早餐内容已上架。维护分类、价格和说明后，孩子端会自动显示。`}
          primaryLabel="新建早餐内容"
          onPrimary={() => {
            setEditingBreakfastId('');
            setBreakfastForm(emptyBreakfast());
            setShowBreakfastSheet(true);
          }}
          primaryClassName="bg-orange-500 border-none"
          tone="from-orange-50 to-amber-50 border-orange-100"
        />

        {groupedItems.length === 0 ? (
          <Card className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-bold text-gray-400">
            还没有早餐内容，先新建一个基础早餐。
          </Card>
        ) : (
          <div className="space-y-3">
            {groupedItems.map(([category, categoryItems]) => (
              <Card key={category} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-black text-gray-800">{category}</div>
                  <div className="text-[10px] font-black text-gray-400">{categoryItems.length} 项</div>
                </div>
                {categoryItems.map(item => {
                  const active = Number(item.isActive) !== 0;
                  return (
                    <div key={item.id} className={`rounded-2xl border p-3 flex items-center gap-3 ${active ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-70'}`}>
                      <div className="w-11 h-11 rounded-2xl bg-orange-50 flex items-center justify-center text-2xl">{item.icon || '🥪'}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-gray-800 truncate">{item.title}</div>
                        <div className="text-xs text-gray-500">
                          {item.costCoins > 0 ? `${item.costCoins} 金币` : '免费'}
                          {item.isDefault ? ' · 默认' : ''}
                          {!active ? ' · 已下架' : ''}
                        </div>
                      </div>
                      <button onClick={() => editBreakfast(item)} className="p-2 text-blue-500"><Edit2 size={17} /></button>
                      <button onClick={() => deleteBreakfast(item)} className="p-2 text-red-500"><Trash2 size={17} /></button>
                    </div>
                  );
                })}
              </Card>
            ))}
          </div>
        )}
      </div>

      <BottomSheet
        isOpen={showBreakfastSheet}
        onClose={() => setShowBreakfastSheet(false)}
        title={editingBreakfastId ? '编辑早餐内容' : '新建早餐内容'}
        footer={
          <div className="flex gap-3">
            <Button onClick={saveBreakfast} loading={saving} className="flex-1 py-3 bg-orange-500 border-none">
              {editingBreakfastId ? '保存' : '新增'}
            </Button>
            <Button variant="ghost" onClick={() => setShowBreakfastSheet(false)} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="图标">
              <div className="flex items-center gap-2">
                <IconPicker
                  value={breakfastForm.icon}
                  onChange={icon => setBreakfastForm({ ...breakfastForm, icon })}
                  categories={['food', 'morning', 'daily', 'emoji']}
                />
                <input
                  value={breakfastForm.icon}
                  onChange={e => setBreakfastForm({ ...breakfastForm, icon: e.target.value.slice(0, 8) })}
                  className="min-w-0 flex-1 px-3 py-2 rounded-xl border bg-gray-50"
                />
              </div>
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
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
            <input type="checkbox" checked={Boolean(breakfastForm.isActive)} onChange={e => setBreakfastForm({ ...breakfastForm, isActive: e.target.checked })} />
            在孩子端上架
          </label>
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
