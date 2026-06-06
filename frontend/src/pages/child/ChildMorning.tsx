import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CalendarDays, Check, Coins, Sparkles, Utensils } from 'lucide-react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import api, { isAuthError } from '../../services/api';

type BreakfastItem = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  category: string;
  costCoins: number;
};

type BreakfastOrder = {
  id: string;
  itemId?: string;
  itemIds?: string[];
  items?: BreakfastItem[];
  title: string;
  icon?: string;
  costCoins: number;
  status: 'ordered' | 'served' | 'cancelled';
  changeCount?: number;
};

type BreakfastData = {
  date: string;
  items: BreakfastItem[];
  allItems?: BreakfastItem[];
  order?: BreakfastOrder | null;
};

const BREAKFAST_CATEGORIES = ['套餐', '主食', '蛋白', '水果', '饮品', '小食', '其他'];

const categoryStyle: Record<string, string> = {
  套餐: 'border-purple-100 bg-purple-50 text-purple-700',
  主食: 'border-amber-100 bg-amber-50 text-amber-700',
  蛋白: 'border-blue-100 bg-blue-50 text-blue-700',
  水果: 'border-rose-100 bg-rose-50 text-rose-700',
  饮品: 'border-cyan-100 bg-cyan-50 text-cyan-700',
  小食: 'border-orange-100 bg-orange-50 text-orange-700',
  其他: 'border-gray-100 bg-gray-50 text-gray-600',
};

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

const getOrderItemIds = (order?: BreakfastOrder | null) => {
  if (!order) return [];
  if (Array.isArray(order.itemIds) && order.itemIds.length) return order.itemIds;
  if (Array.isArray(order.items) && order.items.length) return order.items.map(item => item.id).filter(Boolean);
  return order.itemId ? [order.itemId] : [];
};

export default function ChildMorning() {
  const { childData, refresh } = useOutletContext<any>();
  const toast = useToast();
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [data, setData] = useState<BreakfastData | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async (date = selectedDate) => {
    try {
      setLoading(true);
      const res = await api.get('/child/morning', { params: { date } });
      const nextData = res.data as BreakfastData;
      setData(nextData);
      const orderIds = getOrderItemIds(nextData.order);
      if (orderIds.length) {
        setSelectedIds(orderIds);
      } else {
        setSelectedIds([]);
      }
    } catch (e) {
      if (!isAuthError(e)) toast.error('早餐小厨房加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(selectedDate); }, [selectedDate]);

  const order = data?.order;
  const served = order?.status === 'served';
  const visibleItems = data?.items?.length ? data.items : data?.allItems || [];
  const itemMap = useMemo(() => new Map(visibleItems.map(item => [item.id, item])), [visibleItems]);
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const selectedItems = selectedIds.map(id => itemMap.get(id)).filter(Boolean) as BreakfastItem[];
  const currentCost = selectedItems.reduce((sum, item) => sum + Math.max(0, Number(item.costCoins || 0)), 0);
  const oldCost = Math.max(0, Number(order?.costCoins || 0));
  const costDelta = currentCost - oldCost;
  const coins = Number(childData?.coins || 0);
  const canAfford = costDelta <= 0 || coins >= costDelta;

  const groupedItems = useMemo(() => {
    const groups = new Map<string, BreakfastItem[]>();
    visibleItems.forEach(item => {
      const key = item.category || '其他';
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [
      ...BREAKFAST_CATEGORIES.filter(category => groups.has(category)).map(category => [category, groups.get(category)!] as const),
      ...Array.from(groups.entries()).filter(([category]) => !BREAKFAST_CATEGORIES.includes(category)),
    ];
  }, [visibleItems]);

  const toggleItem = (item: BreakfastItem) => {
    if (served) return;
    setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]);
  };

  const saveBreakfast = async () => {
    if (selectedIds.length === 0) return toast.warning('至少选择一样早餐内容');
    if (!canAfford) return toast.warning('金币不够，可以先减少升级项');
    setSaving(true);
    try {
      const res = await api.post('/child/breakfast-orders', { itemIds: selectedIds, date: data?.date || selectedDate });
      toast.success(res.data?.message || '早餐组合已保存');
      await fetchData(selectedDate);
      refresh?.();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const costText = () => {
    if (!order) return currentCost > 0 ? `消耗 ${currentCost} 金币` : '免费';
    if (costDelta > 0) return `补扣 ${costDelta} 金币`;
    if (costDelta < 0) return `退回 ${Math.abs(costDelta)} 金币`;
    return '无需差价';
  };

  if (loading && !data) {
    return <div className="p-4 text-center text-gray-400">早餐小厨房加载中...</div>;
  }

  return (
    <div className="p-4 pb-24 min-h-full bg-gradient-to-b from-amber-50 via-white to-sky-50 space-y-4">
      <div className="rounded-3xl bg-gradient-to-br from-orange-400 via-amber-400 to-sky-400 text-white p-5 shadow-lg shadow-amber-100 overflow-hidden relative">
        <div className="absolute -right-5 -top-5 w-28 h-28 rounded-full bg-white/20" />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm font-bold opacity-90">
            <Utensils size={18} /> 早餐小厨房
          </div>
          <div className="text-2xl font-black mt-2">今天早餐怎么搭？</div>
          <div className="mt-1 text-sm text-white/85 font-bold">按日期选择，主食、饮品、套餐都可以自由组合。</div>
        </div>
      </div>

      <Card className="space-y-3 border-orange-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-gray-800">
            <CalendarDays size={18} className="text-orange-500" /> 选择日期
          </div>
          <div className="flex items-center gap-1 text-xs font-black text-yellow-600">
            <Coins size={14} /> {coins}
          </div>
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
      </Card>

      <Card className="space-y-4 border-orange-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black text-orange-500">{served ? '今天已锁定' : order ? '今天已保存' : '正在搭配'}</div>
            <div className="font-black text-gray-800 text-lg">我的早餐组合</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-black text-gray-400">结算</div>
            <div className={`font-black ${costDelta > 0 ? 'text-orange-600' : costDelta < 0 ? 'text-emerald-600' : 'text-gray-700'}`}>{costText()}</div>
          </div>
        </div>

        {selectedItems.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedItems.map(item => (
              <span key={item.id} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black ${categoryStyle[item.category] || categoryStyle.其他}`}>
                <span>{item.icon || '🍽️'}</span>
                {item.title}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-gray-50 border border-dashed border-gray-200 p-4 text-center text-sm font-bold text-gray-400">
            还没有选择内容，可以只选一项，也可以组成一份完整早餐。
          </div>
        )}

        <Button
          onClick={saveBreakfast}
          loading={saving}
          disabled={served || selectedIds.length === 0 || !canAfford}
          className="w-full py-3 bg-orange-500 border-none"
        >
          {served ? '家长已确认吃完' : order ? '保存修改' : '保存今天早餐'}
        </Button>
      </Card>

      <div className="space-y-3">
        {groupedItems.map(([category, items]) => (
          <Card key={category} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-black text-gray-800">{category}</div>
              <span className={`text-[10px] font-black rounded-full border px-2 py-1 ${categoryStyle[category] || categoryStyle.其他}`}>
                可选 {items.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {items.map(item => {
                const selected = selectedIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item)}
                    disabled={served}
                    className={`rounded-3xl border p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60 ${
                      selected ? 'border-orange-300 bg-orange-50 shadow-sm' : 'border-gray-100 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center text-3xl">
                        {item.icon || '🍽️'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-gray-800 truncate">{item.title}</div>
                        <div className="text-[11px] text-gray-500 mt-1 line-clamp-2">{item.description || '今天可以选择这个早餐内容。'}</div>
                        <div className="mt-2 text-xs font-black text-orange-600">
                          {Number(item.costCoins || 0) > 0 ? `${item.costCoins} 金币` : '免费'}
                        </div>
                      </div>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${selected ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-300'}`}>
                        {selected ? <Check size={16} /> : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Card className="bg-white/80 border-sky-100">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-sky-500 mt-0.5" />
          <div>
            <div className="font-black text-gray-800 text-sm">早餐规则</div>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              每个分类都不是必选。免费项不扣金币，升级项按总价结算；家长确认吃完后，当天早餐就会锁定。
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
