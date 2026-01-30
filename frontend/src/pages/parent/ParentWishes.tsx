import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Check, CheckCircle2, Circle, Settings2, Edit2, X, Sparkles } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';
import { IconPicker, ICON_LIBRARY } from '../../components/IconPicker';

// 商品模板（带分类）
const SHOP_TEMPLATES = [
  // 零食类
  { title: '小零食', icon: '🍬', cost: 5, stock: 10, category: '零食' },
  { title: '冰淇淋', icon: '🍦', cost: 15, stock: 20, category: '零食' },
  { title: '棒棒糖', icon: '🍭', cost: 3, stock: 30, category: '零食' },
  { title: '饼干', icon: '🍪', cost: 8, stock: 20, category: '零食' },
  { title: '蛋糕', icon: '🎂', cost: 40, stock: 5, category: '零食' },
  // 玩乐类
  { title: '去公园玩', icon: '🏞️', cost: 30, stock: 10, category: '玩乐' },
  { title: '买小玩具', icon: '🧸', cost: 50, stock: 5, category: '玩乐' },
  { title: '新书一本', icon: '📚', cost: 80, stock: 10, category: '玩乐' },
  { title: '画画工具', icon: '🎨', cost: 40, stock: 5, category: '玩乐' },
  { title: '贴纸一套', icon: '🏷️', cost: 10, stock: 20, category: '玩乐' },
  // 特权类
  { title: '看电视30分钟', icon: '📺', cost: 30, stock: 99, category: '特权' },
  { title: '看电视1小时', icon: '📺', cost: 50, stock: 99, category: '特权' },
  { title: '玩手机30分钟', icon: '📱', cost: 25, stock: 99, category: '特权' },
  { title: '玩游戏1小时', icon: '🎮', cost: 60, stock: 99, category: '特权' },
  { title: '选择晚餐', icon: '🍕', cost: 20, stock: 99, category: '特权' },
];

// 稀有度配置
const RARITY_CONFIG = {
  legendary: { label: '传说', emoji: '🏆', color: 'from-yellow-400 to-amber-500', textColor: 'text-amber-600', bgColor: 'bg-amber-50', weight: 5, maxCount: 1, desc: '极其珍贵，建议只设1个' },
  rare: { label: '稀有', emoji: '💎', color: 'from-purple-400 to-indigo-500', textColor: 'text-purple-600', bgColor: 'bg-purple-50', weight: 12, maxCount: 2, desc: '比较珍贵，建议最多2个' },
  uncommon: { label: '优秀', emoji: '🌟', color: 'from-blue-400 to-cyan-500', textColor: 'text-blue-600', bgColor: 'bg-blue-50', weight: 25, maxCount: 2, desc: '还不错，建议2个左右' },
  common: { label: '普通', emoji: '⭐', color: 'from-green-400 to-emerald-500', textColor: 'text-green-600', bgColor: 'bg-green-50', weight: 40, maxCount: 3, desc: '基础奖品，建议3个左右' },
} as const;

type RarityType = keyof typeof RARITY_CONFIG;

// 抽奖奖池模板（带稀有度）
const LOTTERY_TEMPLATES = [
  { title: '100金币', icon: '💰', weight: 5, rarity: 'legendary' as RarityType },
  { title: '1元零花钱', icon: '💵', weight: 8, rarity: 'legendary' as RarityType },
  { title: '免做家务卡', icon: '🎫', weight: 12, rarity: 'rare' as RarityType },
  { title: '神秘礼物', icon: '🎁', weight: 10, rarity: 'rare' as RarityType },
  { title: '看电视30分钟', icon: '📺', weight: 20, rarity: 'uncommon' as RarityType },
  { title: '玩手机30分钟', icon: '📱', weight: 18, rarity: 'uncommon' as RarityType },
  { title: '神秘糖果', icon: '🍬', weight: 25, rarity: 'uncommon' as RarityType },
  { title: '10金币', icon: '🪙', weight: 30, rarity: 'common' as RarityType },
  { title: '贴纸一张', icon: '🏷️', weight: 28, rarity: 'common' as RarityType },
  { title: '小零食', icon: '🍭', weight: 35, rarity: 'common' as RarityType },
  { title: '5金币', icon: '🪙', weight: 40, rarity: 'common' as RarityType },
  { title: '惊喜糖果', icon: '🍪', weight: 32, rarity: 'common' as RarityType },
  { title: '谢谢参与', icon: '😎', weight: 50, rarity: 'common' as RarityType },
  // 注意："再抽一次"是默认奖项，不在模板中，系统会自动创建
];

// 根据类型获取图标分类
const ICON_CATEGORIES_BY_TYPE: Record<'shop' | 'savings' | 'lottery', ('food' | 'entertainment' | 'daily' | 'reward' | 'hobby' | 'sports' | 'emoji')[]> = {
  shop: ['food', 'entertainment', 'daily', 'reward'],
  savings: ['entertainment', 'reward', 'hobby', 'sports'],
  lottery: ['reward', 'food', 'emoji', 'entertainment'],
};

export default function ParentWishes() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [wishes, setWishes] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);
  
  // Tabs: shop | savings | lottery
  const [viewType, setViewType] = useState<'shop'|'savings'|'lottery'>('shop');
  
  // 商品分类常量
  const SHOP_CATEGORIES = ['全部', '零食', '玩乐', '特权', '其他'];
  
  // 商品分类筛选
  const [filterShopCategory, setFilterShopCategory] = useState('全部');
  
  // Form
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('');
  const [target, setTarget] = useState('');
  const [stock, setStock] = useState('99');
  const [icon, setIcon] = useState('🎁');
  const [rarity, setRarity] = useState<RarityType>('common');
  const [effectType, setEffectType] = useState<'normal' | 'draw_again'>('normal');
  const [shopCategory, setShopCategory] = useState('其他');

  // 抽奖奖池上架模式
  const [lotteryEditMode, setLotteryEditMode] = useState(false);
  const [selectedLotteryIds, setSelectedLotteryIds] = useState<Set<string>>(new Set());
  // 实时权重调整（在管理上架时使用）
  const [tempWeights, setTempWeights] = useState<Record<string, number>>({});
  const [adjustingPrizeId, setAdjustingPrizeId] = useState<string | null>(null);
  
  // 编辑商品/奖品 - 完整编辑
  const [editingWish, setEditingWish] = useState<any>(null);
  const [editWeight, setEditWeight] = useState(10);
  const [editTitle, setEditTitle] = useState('');
  const [editIcon, setEditIcon] = useState('🎁');
  const [editCost, setEditCost] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editStock, setEditStock] = useState('99');
  const [editRarity, setEditRarity] = useState<RarityType>('common');
  const [editEffectType, setEditEffectType] = useState<'normal' | 'draw_again'>('normal');
  const [editCategory, setEditCategory] = useState('其他');

  useEffect(() => { fetchWishes(); }, []);
  
  const fetchWishes = async () => { 
    const res = await api.get('/parent/wishes'); 
    setWishes(res.data);
    // 初始化已上架的奖品选择
    const activeLotteryIds = res.data
      .filter((w: any) => w.type === 'lottery' && w.isActive)
      .map((w: any) => w.id);
    setSelectedLotteryIds(new Set(activeLotteryIds));
  };

  // 获取当前类型的图标分类
  const getIconCategories = () => ICON_CATEGORIES_BY_TYPE[viewType];

  const resetForm = () => {
      setTitle('');
      setCost('');
      setTarget('');
      setStock('99');
      setIcon('🎁');
      setRarity('common');
      setEffectType('normal');
      setShopCategory('其他');
  };
  
  // 计算当前各稀有度的数量
  const getRarityCounts = () => {
    const lotteryItems = wishes.filter((w: any) => w.type === 'lottery');
    return {
      legendary: lotteryItems.filter((w: any) => w.rarity === 'legendary').length,
      rare: lotteryItems.filter((w: any) => w.rarity === 'rare').length,
      uncommon: lotteryItems.filter((w: any) => w.rarity === 'uncommon').length,
      common: lotteryItems.filter((w: any) => !w.rarity || w.rarity === 'common').length,
    };
  };

  const handleAdd = async () => {
    if (!title) return toast.warning('请输入标题');
    
    // 检查是否已存在同名项目
    const existingItem = wishes.find((w: any) => w.type === viewType && w.title === title.trim());
    if (existingItem) {
      return toast.warning(`已存在同名${viewType === 'shop' ? '商品' : viewType === 'lottery' ? '奖品' : '心愿'}："${title}"`);
    }
    
    // 抽奖奖池限制
    if (viewType === 'lottery') {
      const currentLotteryCount = wishes.filter((w: any) => w.type === 'lottery').length;
      if (currentLotteryCount >= 8) {
        return toast.warning('抽奖奖池只能有8个奖品！请先删除一些奖品再添加。');
      }
      
      // 检查稀有度数量限制
      const rarityCounts = getRarityCounts();
      const config = RARITY_CONFIG[rarity];
      if (rarityCounts[rarity] >= config.maxCount) {
        return toast.warning(`${config.emoji} ${config.label}级奖品已达到上限（${config.maxCount}个）！建议：${config.desc}`);
      }
    }
    
    const weight = viewType === 'lottery' ? RARITY_CONFIG[rarity].weight : 10;
    
    // 手动添加的奖品永远是普通奖品，"再抽一次"只能通过模板添加
    await api.post('/parent/wishes', {
      type: viewType, 
      title, 
      cost: +cost, 
      targetAmount: +target, 
      icon, 
      stock: viewType === 'shop' ? (+stock || 99) : -1,
      weight,
      rarity: viewType === 'lottery' ? rarity : null,
      effectType: null,  // 手动添加的永远是普通奖品
      category: viewType === 'shop' ? shopCategory : null
    });
    
    // 检查抽奖奖池是否达到8个
    if (viewType === 'lottery') {
      const newCount = wishes.filter((w: any) => w.type === 'lottery').length + 1;
      if (newCount === 8) {
        toast.success('🎉 奖池已有8个奖品！可以点击"管理上架"选择上架了。');
      } else if (newCount < 8) {
        toast.success(`添加成功！奖池当前${newCount}个，还需${8 - newCount}个。`);
      }
    }
    
    setShowAdd(false); 
    resetForm();
    fetchWishes();
  };

  // 切换模板选择
  const toggleTemplate = (index: number) => {
    setSelectedTemplates(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  // 批量添加选中的模板
  const handleAddTemplates = async () => {
    if (selectedTemplates.length === 0) return toast.warning('请至少选择一个模板');
    
    const templates = viewType === 'shop' ? SHOP_TEMPLATES : LOTTERY_TEMPLATES;
    
    // 检查是否有重复的模板
    const existingTitles = wishes.filter((w: any) => w.type === viewType).map((w: any) => w.title);
    const duplicates = selectedTemplates
      .map(index => templates[index].title)
      .filter(title => existingTitles.includes(title));
    
    if (duplicates.length > 0) {
      return toast.warning(`以下${viewType === 'shop' ? '商品' : '奖品'}已存在：${duplicates.join('、')}`);
    }
    
    // 抽奖奖池必须正好8个
    if (viewType === 'lottery') {
      const currentLotteryCount = wishes.filter((w: any) => w.type === 'lottery').length;
      const totalAfterAdd = currentLotteryCount + selectedTemplates.length;
      if (totalAfterAdd < 8) {
        return toast.warning(`奖池需要8个奖品！当前${currentLotteryCount}个，选择后共${totalAfterAdd}个，还差${8 - totalAfterAdd}个。`);
      }
      if (totalAfterAdd > 8) {
        return toast.warning(`奖池只能有8个奖品！当前${currentLotteryCount}个，最多再添加${8 - currentLotteryCount}个。`);
      }
    }
    
    try {
      for (const index of selectedTemplates) {
        const template = templates[index];
        if (viewType === 'shop') {
          const shopTemplate = template as typeof SHOP_TEMPLATES[0];
          await api.post('/parent/wishes', {
            type: viewType,
            title: shopTemplate.title,
            icon: shopTemplate.icon,
            cost: shopTemplate.cost,
            stock: shopTemplate.stock,
            weight: 10,
            category: shopTemplate.category || '其他'
          });
        } else {
          const lotteryTemplate = template as typeof LOTTERY_TEMPLATES[0];
          await api.post('/parent/wishes', {
            type: viewType,
            title: lotteryTemplate.title,
            icon: lotteryTemplate.icon,
            cost: 0,
            stock: -1,
            weight: lotteryTemplate.weight,
            rarity: lotteryTemplate.rarity || null,
            effectType: null  // 模板中的都是普通奖品，"再抽一次"由系统自动创建
          });
        }
      }
      toast.success(`成功添加 ${selectedTemplates.length} 个${viewType === 'shop' ? '商品' : '奖品'}！`);
      setShowTemplates(false);
      setSelectedTemplates([]);
      fetchWishes();
    } catch (e) {
      toast.error('添加失败');
    }
  };
  
  // 打开完整编辑弹窗
  const openEditor = (wish: any) => {
    setEditingWish(wish);
    setEditTitle(wish.title);
    setEditIcon(wish.icon);
    setEditWeight(wish.weight || 10);
    setEditCost(String(wish.cost || 0));
    setEditTarget(String(wish.targetAmount || 0));
    setEditStock(String(wish.stock ?? 99));
    setEditRarity(wish.rarity || 'common');
    setEditEffectType(wish.effectType === 'draw_again' ? 'draw_again' : 'normal');
    setEditCategory(wish.category || '其他');
  };
  
  // 保存编辑（effectType 保持原值不变，不允许修改）
  const saveEdit = async () => {
    if (!editingWish) return;
    try {
      await api.put(`/parent/wishes/${editingWish.id}`, {
        title: editTitle,
        icon: editIcon,
        cost: +editCost,
        targetAmount: +editTarget,
        stock: editingWish.type === 'shop' ? (+editStock || 99) : editingWish.stock,
        weight: editWeight,
        rarity: editingWish.type === 'lottery' ? editRarity : null,
        // effectType 保持原值，不允许用户修改
        effectType: editingWish.effectType || null,
        category: editingWish.type === 'shop' ? editCategory : null
      });
      toast.success('修改成功！');
      setEditingWish(null);
      fetchWishes();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    }
  };
  
  // 计算概率
  const calculateProbability = (weight: number, items: any[]) => {
    const totalWeight = items.reduce((sum, w) => sum + (w.weight || 10), 0);
    if (totalWeight === 0) return 0;
    return ((weight / totalWeight) * 100).toFixed(1);
  };

  const handleDelete = async (id: string) => {
      const confirmed = await confirm({
        title: '删除确认',
        message: '确定删除吗？此操作无法撤销。',
        type: 'danger',
        confirmText: '删除',
      });
      if (!confirmed) return;
      try {
        await api.delete(`/parent/wishes/${id}`);
        toast.success('删除成功');
        fetchWishes();
      } catch {
        toast.error('删除失败');
      }
  };

  // 切换奖品选择
  const toggleLotterySelection = (id: string) => {
    const newSet = new Set(selectedLotteryIds);
    if (newSet.has(id)) {
      newSet.delete(id);
      // 移除临时权重
      const newWeights = { ...tempWeights };
      delete newWeights[id];
      setTempWeights(newWeights);
    } else {
      if (newSet.size >= 8) {
        toast.warning('最多只能选择8个奖品上架到转盘！');
        return;
      }
      newSet.add(id);
      // 初始化临时权重
      const prize = wishes.find(w => w.id === id);
      if (prize) {
        setTempWeights(prev => ({ ...prev, [id]: prize.weight || 10 }));
      }
    }
    setSelectedLotteryIds(newSet);
  };
  
  // 获取选中奖品的实时权重（优先使用临时权重）
  const getEffectiveWeight = (prizeId: string) => {
    if (tempWeights[prizeId] !== undefined) {
      return tempWeights[prizeId];
    }
    const prize = wishes.find(w => w.id === prizeId);
    return prize?.weight || 10;
  };
  
  // 计算选中奖品的总权重
  const getSelectedTotalWeight = () => {
    let total = 0;
    selectedLotteryIds.forEach(id => {
      total += getEffectiveWeight(id);
    });
    return total;
  };
  
  // 计算选中奖品的概率
  const getSelectedProbability = (prizeId: string) => {
    const totalWeight = getSelectedTotalWeight();
    if (totalWeight === 0) return '0.0';
    const weight = getEffectiveWeight(prizeId);
    return ((weight / totalWeight) * 100).toFixed(1);
  };
  
  // 更新临时权重
  const updateTempWeight = (prizeId: string, newWeight: number) => {
    setTempWeights(prev => ({ ...prev, [prizeId]: Math.max(1, Math.min(100, newWeight)) }));
  };
  
  // 通过稀有度快速设置权重
  const setWeightByRarity = (prizeId: string, rarityKey: RarityType) => {
    setTempWeights(prev => ({ ...prev, [prizeId]: RARITY_CONFIG[rarityKey].weight }));
  };

  // 保存奖池上架设置（包括权重更新）
  const saveLotterySelection = async () => {
    if (selectedLotteryIds.size < 8) {
      toast.warning(`必须选择8个奖品！当前已选${selectedLotteryIds.size}个，还差${8 - selectedLotteryIds.size}个。`);
      return;
    }
    if (selectedLotteryIds.size > 8) {
      toast.warning(`只能选择8个奖品！当前已选${selectedLotteryIds.size}个，请取消${selectedLotteryIds.size - 8}个。`);
      return;
    }
    try {
      // 先保存所有权重变更
      const weightUpdates = Object.entries(tempWeights);
      for (const [prizeId, weight] of weightUpdates) {
        const prize = wishes.find(w => w.id === prizeId);
        if (prize && prize.weight !== weight) {
          await api.put(`/parent/wishes/${prizeId}`, {
            title: prize.title,
            icon: prize.icon,
            cost: prize.cost,
            targetAmount: prize.targetAmount,
            stock: prize.stock,
            weight: weight,
            rarity: prize.rarity,
            effectType: prize.effectType || null
          });
        }
      }
      
      // 再保存上架选择
      await api.post('/parent/wishes/lottery/activate', {
        activeIds: Array.from(selectedLotteryIds)
      });
      toast.success('奖池设置成功！孩子可以开始抽奖了！');
      setLotteryEditMode(false);
      setTempWeights({});
      setAdjustingPrizeId(null);
      fetchWishes();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '设置失败');
    }
  };
  
  // 进入管理上架模式时初始化
  const enterLotteryEditMode = () => {
    setLotteryEditMode(true);
    // 初始化临时权重为当前已选奖品的权重
    const initialWeights: Record<string, number> = {};
    selectedLotteryIds.forEach(id => {
      const prize = wishes.find(w => w.id === id);
      if (prize) {
        initialWeights[id] = prize.weight || 10;
      }
    });
    setTempWeights(initialWeights);
  };
  
  // 退出管理上架模式
  const exitLotteryEditMode = () => {
    setLotteryEditMode(false);
    setTempWeights({});
    setAdjustingPrizeId(null);
    fetchWishes();
  };

  // Filter list - 商品支持分类筛选
  const filteredList = wishes.filter(w => {
    if (w.type !== viewType) return false;
    // 商品按分类筛选
    if (viewType === 'shop' && filterShopCategory !== '全部') {
      return (w.category || '其他') === filterShopCategory;
    }
    return true;
  });
  
  // 统计抽奖奖池
  const lotteryItems = wishes.filter(w => w.type === 'lottery');
  const activeLotteryCount = lotteryItems.filter(w => w.isActive).length;

  return (
    <Layout>
      <Header title="心愿管理" showBack onBack={() => navigate('/parent/dashboard')} rightElem={<button onClick={() => setShowAdd(true)}><Plus className="text-blue-600"/></button>} />
      
      {/* Tabs */}
      <div className="flex border-b bg-white">
          {[
              {id: 'shop', label: '🛒 商品兑换'},
              {id: 'savings', label: '🎯 储蓄目标'},
              {id: 'lottery', label: '🎰 抽奖奖池'}
          ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => { 
                  setViewType(tab.id as any); 
                  setShowAdd(false); 
                  setShowTemplates(false);
                  setSelectedTemplates([]);
                  resetForm(); 
                }}
                className={`flex-1 py-3 text-sm font-bold transition-colors ${viewType === tab.id ? 'text-pink-600 border-b-2 border-pink-600 bg-pink-50/50' : 'text-gray-500'}`}
              >
                  {tab.label}
              </button>
          ))}
      </div>

      {/* 新建商品/奖品/储蓄 - 底部抽屉 */}
      <BottomSheet 
        isOpen={showAdd} 
        onClose={() => { setShowAdd(false); resetForm(); }} 
        title={viewType === 'shop' ? '🛒 新建商品' : viewType === 'lottery' ? '🎰 新建奖品' : '🎯 新建储蓄目标'}
        footer={
          <div className="flex gap-3">
            <Button onClick={handleAdd} className={`flex-1 py-3 border-none ${
              viewType === 'shop' ? 'bg-gradient-to-r from-pink-500 to-rose-500' :
              viewType === 'lottery' ? 'bg-gradient-to-r from-purple-500 to-indigo-500' :
              'bg-gradient-to-r from-blue-500 to-cyan-500'
            }`}>保存</Button>
            <Button variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }} className="flex-1 py-3">取消</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
              <IconPicker value={icon} onChange={setIcon} categories={getIconCategories()} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 font-bold block mb-1">名称</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-pink-500 outline-none transition-all" placeholder="例如：乐高玩具" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
          </div>
          
          {viewType === 'shop' && (
            <>
              <div>
                <label className="text-xs text-gray-500 font-bold block mb-1">💰 兑换价格 (金币)</label>
                <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-pink-500 outline-none" type="number" placeholder="30" value={cost} onChange={e => setCost(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-bold block mb-1">📦 库存数量</label>
                <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-pink-500 outline-none" type="number" placeholder="99" value={stock} onChange={e => setStock(e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-1">💡 输入 -1 表示无限库存</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-bold block mb-1">🏷️ 商品分类</label>
                <div className="flex gap-2 flex-wrap">
                  {['零食', '玩乐', '特权', '其他'].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setShopCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                        shopCategory === cat
                          ? 'bg-pink-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          
          {viewType === 'savings' && (
            <div>
              <label className="text-xs text-gray-500 font-bold block mb-1">🎯 目标金额 (金币)</label>
              <input className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" type="number" placeholder="1000" value={target} onChange={e => setTarget(e.target.value)} />
              <p className="text-[11px] text-gray-400 mt-2">💡 孩子可以看到储蓄进度，激励存钱</p>
            </div>
          )}

          {viewType === 'lottery' && (
            <>
              {/* 稀有度选择 */}
              <div>
                <label className="text-xs text-gray-500 font-bold mb-2 block">奖品稀有度</label>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.entries(RARITY_CONFIG) as [RarityType, typeof RARITY_CONFIG[RarityType]][]).map(([key, config]) => {
                    const counts = getRarityCounts();
                    const isAtLimit = counts[key] >= config.maxCount;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => !isAtLimit && setRarity(key)}
                        disabled={isAtLimit}
                        className={`p-2 rounded-xl border-2 text-center transition-all ${
                          rarity === key 
                            ? `bg-gradient-to-r ${config.color} text-white border-transparent shadow-lg scale-105` 
                            : isAtLimit
                              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                              : `${config.bgColor} border-gray-200 hover:border-gray-300`
                        }`}
                      >
                        <div className="text-lg">{config.emoji}</div>
                        <div className={`text-xs font-bold ${rarity === key ? 'text-white' : config.textColor}`}>
                          {config.label}
                        </div>
                        <div className={`text-[10px] ${rarity === key ? 'text-white/80' : 'text-gray-400'}`}>
                          {counts[key]}/{config.maxCount}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* 稀有度说明 */}
                <div className={`mt-2 p-2.5 rounded-xl text-xs ${RARITY_CONFIG[rarity].bgColor}`}>
                  <span className={`font-bold ${RARITY_CONFIG[rarity].textColor}`}>
                    {RARITY_CONFIG[rarity].emoji} {RARITY_CONFIG[rarity].label}级：
                  </span>
                  <span className="text-gray-600 ml-1">{RARITY_CONFIG[rarity].desc}</span>
                </div>
              </div>
              {/* 提示：再抽一次由系统自动创建 */}
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-xs text-amber-700">
                  💡「再抽一次」奖项由系统自动创建，可在管理上架中选择是否上架
                </p>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      <div className="p-4 pb-20 space-y-3 overflow-y-auto flex-1">
        {/* 商品分类筛选标签 */}
        {viewType === 'shop' && wishes.filter(w => w.type === 'shop').length > 0 && !showTemplates && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            {SHOP_CATEGORIES.map(cat => {
              const count = cat === '全部' 
                ? wishes.filter(w => w.type === 'shop').length
                : wishes.filter(w => w.type === 'shop' && (w.category || '其他') === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilterShopCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    filterShopCategory === cat
                      ? 'bg-pink-500 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        )}
        
        {/* 快捷模板入口 - 商品和抽奖 */}
        {(viewType === 'shop' || viewType === 'lottery') && filteredList.length > 0 && !showTemplates && (
          <button 
            onClick={() => setShowTemplates(true)}
            className={`w-full p-3 border rounded-xl flex items-center justify-center gap-2 font-medium text-sm hover:opacity-90 transition-all mb-2 ${
              viewType === 'shop' 
                ? 'bg-gradient-to-r from-pink-50 to-rose-50 border-pink-100 text-pink-600 hover:from-pink-100 hover:to-rose-100'
                : 'bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-100 text-purple-600 hover:from-purple-100 hover:to-indigo-100'
            }`}
          >
            <Sparkles size={16}/> 从模板快速添加更多{viewType === 'shop' ? '商品' : '奖品'}
          </button>
        )}

        {/* 抽奖奖池特殊操作栏 */}
        {viewType === 'lottery' && !showTemplates && (
          <div className={`p-3 rounded-xl ${lotteryEditMode ? 'bg-purple-100 border-2 border-purple-400' : 'bg-purple-50'}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-bold text-purple-700">转盘状态：</span>
                {lotteryItems.length === 0 ? (
                  <span className="text-gray-500 font-bold ml-1">暂无奖品，需要添加 8 个</span>
                ) : lotteryItems.length < 8 ? (
                  <span className="text-orange-600 font-bold ml-1">⚠️ 当前有 {lotteryItems.length} 个奖品，还需要 {8 - lotteryItems.length} 个才能上架</span>
                ) : lotteryItems.length === 8 ? (
                  activeLotteryCount === 8 ? (
                    <span className="text-green-600 font-bold ml-1">✅ 已上架 8 个奖品</span>
                  ) : (
                    <span className="text-orange-600 font-bold ml-1">⚠️ 已有 8 个奖品，但只上架了 {activeLotteryCount} 个，请点击"管理上架"选择 8 个上架</span>
                  )
                ) : (
                  <span className="text-red-600 font-bold ml-1">❌ 奖品数量为 {lotteryItems.length}，超过 8 个！请删除多余奖品，只保留 8 个</span>
                )}
              </div>
              {!lotteryEditMode ? (
                <button 
                  onClick={enterLotteryEditMode}
                  className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600 transition-colors"
                >
                  <Settings2 size={14}/> 管理上架
                </button>
              ) : (
                <div className="flex gap-2">
                  <button 
                    onClick={exitLotteryEditMode}
                    className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-300"
                  >
                    取消
                  </button>
                  <button 
                    onClick={saveLotterySelection}
                    disabled={selectedLotteryIds.size !== 8}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                      selectedLotteryIds.size === 8 
                        ? 'bg-green-500 text-white hover:bg-green-600' 
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Check size={14}/> 确认上架 ({selectedLotteryIds.size}/8)
                  </button>
                </div>
              )}
            </div>
            {lotteryEditMode && (
              <div className="mt-2 text-xs text-purple-600">
                💡 点击奖品进行勾选，选满8个后点击"确认上架"。点击已选奖品的权重可以调整概率。
              </div>
            )}
            
            {/* 实时概率预览面板 */}
            {lotteryEditMode && selectedLotteryIds.size > 0 && (
              <div className="mt-3 p-3 bg-white rounded-xl border-2 border-purple-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-purple-700 text-sm">📊 实时概率预览</span>
                  <span className="text-xs text-gray-500">总权重: {getSelectedTotalWeight()}</span>
                </div>
                <div className="space-y-2">
                  {Array.from(selectedLotteryIds).map(id => {
                    const prize = wishes.find(w => w.id === id);
                    if (!prize) return null;
                    const weight = getEffectiveWeight(id);
                    const probability = getSelectedProbability(id);
                    const rarityConfig = prize.rarity ? RARITY_CONFIG[prize.rarity as RarityType] : null;
                    const isAdjusting = adjustingPrizeId === id;
                    
                    return (
                      <div key={id} className={`p-2 rounded-lg transition-all ${isAdjusting ? 'bg-purple-50 ring-2 ring-purple-400' : 'bg-gray-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-lg">{prize.icon}</span>
                            <span className="font-medium text-sm truncate">{prize.title}</span>
                            {rarityConfig && (
                              <span className={`text-[10px] px-1 py-0.5 rounded ${rarityConfig.bgColor} ${rarityConfig.textColor}`}>
                                {rarityConfig.emoji}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {/* 权重调整按钮 */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setAdjustingPrizeId(isAdjusting ? null : id); }}
                              className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                                isAdjusting 
                                  ? 'bg-purple-500 text-white' 
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              }`}
                            >
                              权重: {weight}
                            </button>
                            {/* 概率显示 */}
                            <div className={`w-16 text-right font-bold text-sm ${
                              parseFloat(probability) <= 5 ? 'text-amber-600' :
                              parseFloat(probability) <= 15 ? 'text-blue-600' :
                              'text-green-600'
                            }`}>
                              {probability}%
                            </div>
                          </div>
                        </div>
                        
                        {/* 权重调整面板 */}
                        {isAdjusting && (
                          <div className="mt-2 pt-2 border-t border-purple-200 space-y-2" onClick={e => e.stopPropagation()}>
                            {/* 稀有度快捷按钮 */}
                            <div className="flex gap-1">
                              {(Object.entries(RARITY_CONFIG) as [RarityType, typeof RARITY_CONFIG[RarityType]][]).map(([key, config]) => (
                                <button
                                  key={key}
                                  onClick={() => setWeightByRarity(id, key)}
                                  className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                                    weight === config.weight 
                                      ? `bg-gradient-to-r ${config.color} text-white` 
                                      : `${config.bgColor} ${config.textColor} hover:opacity-80`
                                  }`}
                                >
                                  {config.emoji} {config.weight}
                                </button>
                              ))}
                            </div>
                            {/* 滑块调整 */}
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min="1"
                                max="100"
                                value={weight}
                                onChange={(e) => updateTempWeight(id, +e.target.value)}
                                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
                              />
                              <input
                                type="number"
                                min="1"
                                max="100"
                                value={weight}
                                onChange={(e) => updateTempWeight(id, +e.target.value)}
                                className="w-14 p-1 border rounded text-center text-sm font-bold"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* 概率分布提示 */}
                {selectedLotteryIds.size === 8 && (
                  <div className="mt-3 pt-2 border-t text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <span className="text-amber-600">●</span> ≤5% 传说/稀有
                      <span className="text-blue-600 ml-2">●</span> 6-15% 优秀
                      <span className="text-green-600 ml-2">●</span> &gt;15% 普通
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 模板选择界面 */}
        {showTemplates && (viewType === 'shop' || viewType === 'lottery') && (
          <div className="animate-in fade-in pb-20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className={viewType === 'shop' ? 'text-pink-500' : 'text-purple-500'} size={20}/>
                选择{viewType === 'shop' ? '商品' : '奖品'}模板
              </h3>
              <span className="text-sm text-gray-500">已选 {selectedTemplates.length} 个</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {(viewType === 'shop' ? SHOP_TEMPLATES : LOTTERY_TEMPLATES).map((template, index) => {
                const isSelected = selectedTemplates.includes(index);
                const lotteryTemplate = template as typeof LOTTERY_TEMPLATES[0];
                const rarityConfig = viewType === 'lottery' && lotteryTemplate.rarity ? RARITY_CONFIG[lotteryTemplate.rarity] : null;
                return (
                  <button
                    key={index}
                    onClick={() => toggleTemplate(index)}
                    className={`p-3 rounded-xl text-left transition-all border-2 ${
                      isSelected 
                        ? (viewType === 'shop' ? 'border-pink-500 bg-pink-50' : 'border-purple-500 bg-purple-50')
                        : 'border-gray-100 bg-white hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xl">{template.icon}</span>
                      <div className="flex items-center gap-1">
                        {rarityConfig && (
                          <span className={`text-[10px] px-1 py-0.5 rounded ${rarityConfig.bgColor} ${rarityConfig.textColor}`}>
                            {rarityConfig.emoji}
                          </span>
                        )}
                        {isSelected && <Check size={16} className={viewType === 'shop' ? 'text-pink-500' : 'text-purple-500'}/>}
                      </div>
                    </div>
                    <div className="font-bold text-sm mt-1 text-gray-800">{template.title}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {viewType === 'shop' ? (
                        <>💰 {(template as typeof SHOP_TEMPLATES[0]).cost} 金币 · 库存 {(template as typeof SHOP_TEMPLATES[0]).stock}</>
                      ) : (
                        <>权重: {(template as typeof LOTTERY_TEMPLATES[0]).weight}</>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        
        {/* 模板选择底部操作栏 - 绝对定位 + 安全区域 */}
        {showTemplates && (viewType === 'shop' || viewType === 'lottery') && (
          <div className="absolute bottom-0 left-0 right-0 bg-white py-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t shadow-[0_-4px_12px_rgba(0,0,0,0.1)] z-20 flex gap-2">
            <Button onClick={() => { setShowTemplates(false); setSelectedTemplates([]); }} variant="ghost" className="flex-1">
              取消
            </Button>
            <Button 
              onClick={handleAddTemplates} 
              className={`flex-1 border-none ${
                viewType === 'shop' 
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500' 
                  : 'bg-gradient-to-r from-purple-500 to-indigo-500'
              }`}
              disabled={selectedTemplates.length === 0}
            >
              添加 {selectedTemplates.length} 个{viewType === 'shop' ? '商品' : '奖品'}
            </Button>
          </div>
        )}

        {/* 空状态 - 显示模板入口 */}
        {filteredList.length === 0 && !showAdd && !showTemplates && (
            <div className="text-center py-8">
                <div className="text-5xl mb-3">
                    {viewType === 'shop' && '🛒'}
                    {viewType === 'savings' && '🎯'}
                    {viewType === 'lottery' && '🎰'}
                </div>
                <div className="text-gray-500 mb-4">还没有{viewType === 'shop' ? '商品' : viewType === 'lottery' ? '奖品' : '储蓄目标'}哦</div>
                {(viewType === 'shop' || viewType === 'lottery') && (
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => setShowTemplates(true)}
                      className="bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all"
                    >
                      <Sparkles size={18}/> 从模板快速添加
                    </button>
                    <button 
                      onClick={() => setShowAdd(true)}
                      className="text-pink-600 font-medium text-sm"
                    >
                      或手动创建
                    </button>
                  </div>
                )}
                {viewType === 'savings' && (
                  <button 
                    onClick={() => setShowAdd(true)}
                    className="text-blue-600 font-medium text-sm"
                  >
                    点击创建储蓄目标
                  </button>
                )}
            </div>
        )}
        {filteredList.map(w => (
          <Card 
            key={w.id} 
            onClick={viewType === 'lottery' && lotteryEditMode ? () => toggleLotterySelection(w.id) : undefined}
            className={`flex justify-between items-center hover:shadow-md transition-all ${
              viewType === 'lottery' && lotteryEditMode ? 'cursor-pointer' : ''
            } ${
              viewType === 'lottery' && selectedLotteryIds.has(w.id) ? 'ring-2 ring-purple-500 bg-purple-50' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              {/* 抽奖编辑模式下显示勾选框 */}
              {viewType === 'lottery' && lotteryEditMode && (
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  selectedLotteryIds.has(w.id) ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-400'
                }`}>
                  {selectedLotteryIds.has(w.id) ? <CheckCircle2 size={18}/> : <Circle size={18}/>}
                </div>
              )}
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-sm ${
                  w.type === 'shop' ? 'bg-gradient-to-br from-pink-100 to-rose-100' :
                  w.type === 'lottery' ? 'bg-gradient-to-br from-purple-100 to-indigo-100' :
                  'bg-gradient-to-br from-blue-100 to-cyan-100'
              }`}>
                  {w.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-gray-800 truncate flex items-center gap-1.5">
                  {w.title}
                  {/* 系统默认奖项标签 */}
                  {w.isSystemDefault === 1 && (
                    <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-bold">默认</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  {/* 稀有度标签 */}
                  {w.type === 'lottery' && w.rarity && RARITY_CONFIG[w.rarity as RarityType] && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${RARITY_CONFIG[w.rarity as RarityType].bgColor} ${RARITY_CONFIG[w.rarity as RarityType].textColor}`}>
                      {RARITY_CONFIG[w.rarity as RarityType].emoji} {RARITY_CONFIG[w.rarity as RarityType].label}
                    </span>
                  )}
                  {/* 显示上架状态标记 */}
                  {w.type === 'lottery' && w.isActive && !lotteryEditMode && (
                    <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                      已上架
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  {w.type === 'shop' && (
                    <>
                      <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full">💰 {w.cost} 金币</span>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">📦 {w.stock === -1 || w.stock === null ? '无限' : w.stock}</span>
                      <span className="bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">🏷️ {w.category || '其他'}</span>
                    </>
                  )}
                  {w.type === 'savings' && <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">🎯 目标 {w.targetAmount} 金币</span>}
                  {w.type === 'lottery' && (
                    <>
                      <span className="bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                        权重: {w.weight || 10}
                      </span>
                      {w.isActive && (
                        <span className="bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                          概率: {calculateProbability(w.weight || 10, lotteryItems.filter(l => l.isActive))}%
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* 非编辑模式下显示操作按钮 */}
            {!(viewType === 'lottery' && lotteryEditMode) && (
              <div className="flex items-center gap-1">
                {/* 编辑按钮 - 所有类型都有 */}
                <button 
                  onClick={(e) => { e.stopPropagation(); openEditor(w); }} 
                  className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${
                    w.type === 'shop' ? 'text-pink-400 hover:text-pink-600' :
                    w.type === 'lottery' ? 'text-purple-400 hover:text-purple-600' :
                    'text-blue-400 hover:text-blue-600'
                  }`}
                  title="编辑"
                >
                  <Edit2 size={16}/>
                </button>
                {/* 系统默认奖项不能删除 */}
                {w.isSystemDefault !== 1 && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(w.id); }} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
                      <Trash2 size={18}/>
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      
      {/* 完整编辑弹窗 - 支持安全区域 */}
      {editingWish && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col animate-in zoom-in-95" style={{ maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px)' }}>
            <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
              <h3 className="font-bold text-lg">
                编辑{editingWish.type === 'shop' ? '商品' : editingWish.type === 'lottery' ? '奖品' : '储蓄目标'}
              </h3>
              <button onClick={() => setEditingWish(null)} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 系统默认奖项特殊提示 */}
              {editingWish.isSystemDefault === 1 && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <p className="text-sm text-amber-700 font-bold">🔄 这是「再抽一次」默认奖项</p>
                  <p className="text-xs text-amber-600 mt-1">只能调整稀有度和中奖权重，不能修改名称和图标</p>
                </div>
              )}
              
              {/* 图标和名称 - 系统默认奖项时只读显示 */}
              {editingWish.isSystemDefault === 1 ? (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="text-4xl">{editIcon}</div>
                  <div className="font-bold text-lg text-gray-700">{editTitle}</div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div>
                    <label className="text-xs text-gray-500 font-bold block mb-1">图标</label>
                    <IconPicker 
                      value={editIcon} 
                      onChange={setEditIcon} 
                      categories={editingWish.type === 'shop' ? ['food', 'entertainment', 'daily', 'reward'] : 
                                 editingWish.type === 'lottery' ? ['reward', 'food', 'emoji', 'entertainment'] : 
                                 ['entertainment', 'reward', 'hobby', 'sports']} 
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold block mb-1">名称</label>
                    <input 
                      className="w-full p-2.5 rounded-xl border bg-gray-50 focus:bg-white focus:ring-2 focus:ring-pink-500 outline-none" 
                      value={editTitle} 
                      onChange={e => setEditTitle(e.target.value)} 
                    />
                  </div>
                </div>
              )}
              
              {/* 商品价格和库存 */}
              {editingWish.type === 'shop' && (
                <>
                  <div>
                    <label className="text-xs text-gray-500 font-bold">兑换价格 (金币)</label>
                    <input 
                      className="w-full p-2 rounded-lg border mt-1" 
                      type="number" 
                      value={editCost} 
                      onChange={e => setEditCost(e.target.value)} 
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-bold">库存数量</label>
                    <input 
                      className="w-full p-2 rounded-lg border mt-1" 
                      type="number" 
                      value={editStock} 
                      onChange={e => setEditStock(e.target.value)} 
                    />
                    <p className="text-[10px] text-gray-400 mt-1">输入 -1 表示无限库存</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-bold">商品分类</label>
                    <div className="flex gap-2 flex-wrap mt-1">
                      {['零食', '玩乐', '特权', '其他'].map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setEditCategory(cat)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                            editCategory === cat
                              ? 'bg-pink-500 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {/* 储蓄目标 */}
              {editingWish.type === 'savings' && (
                <div>
                  <label className="text-xs text-gray-500 font-bold">目标金额 (金币)</label>
                  <input 
                    className="w-full p-2 rounded-lg border mt-1" 
                    type="number" 
                    value={editTarget} 
                    onChange={e => setEditTarget(e.target.value)} 
                  />
                </div>
              )}
              
              {/* 抽奖稀有度 */}
              {editingWish.type === 'lottery' && (
                <>
                  <div>
                    <label className="text-xs text-gray-500 font-bold mb-2 block">奖品稀有度</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(Object.entries(RARITY_CONFIG) as [RarityType, typeof RARITY_CONFIG[RarityType]][]).map(([key, config]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setEditRarity(key);
                            setEditWeight(config.weight);
                          }}
                          className={`p-2 rounded-lg border-2 text-center transition-all ${
                            editRarity === key 
                              ? `bg-gradient-to-r ${config.color} text-white border-transparent shadow-md` 
                              : `${config.bgColor} border-gray-200 hover:border-gray-300`
                          }`}
                        >
                          <div className="text-base">{config.emoji}</div>
                          <div className={`text-[10px] font-bold ${editRarity === key ? 'text-white' : config.textColor}`}>
                            {config.label}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs text-gray-500 font-bold">中奖权重 (1-100)</label>
                    <div className="flex items-center gap-3 mt-1">
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        value={editWeight}
                        onChange={(e) => setEditWeight(+e.target.value)}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                      <input 
                        type="number" 
                        min="1" 
                        max="100"
                        value={editWeight}
                        onChange={(e) => setEditWeight(Math.min(100, Math.max(1, +e.target.value)))}
                        className="w-16 p-2 border rounded-lg text-center font-bold"
                      />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      💡 选择稀有度会自动推荐权重，也可手动调整
                    </div>
                  </div>
                </>
              )}
              
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setEditingWish(null)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200"
                >
                  取消
                </button>
                <button 
                  onClick={saveEdit}
                  className={`flex-1 py-2.5 text-white rounded-xl font-bold ${
                    editingWish.type === 'shop' ? 'bg-pink-500 hover:bg-pink-600' :
                    editingWish.type === 'lottery' ? 'bg-purple-500 hover:bg-purple-600' :
                    'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog />
    </Layout>
  );
}
