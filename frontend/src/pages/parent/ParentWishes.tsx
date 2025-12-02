import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Check, CheckCircle2, Circle, Settings2, Edit2, X } from 'lucide-react';
import api from '../../services/api';

// 预设图标库
const SHOP_ICONS = [
    { icon: '📺', name: '电视' },
    { icon: '🎮', name: '游戏' },
    { icon: '🍦', name: '冰淇淋' },
    { icon: '🍬', name: '糖果' },
    { icon: '🍪', name: '饼干' },
    { icon: '🎂', name: '蛋糕' },
    { icon: '🧸', name: '玩具熊' },
    { icon: '📚', name: '书籍' },
    { icon: '🎨', name: '画画' },
    { icon: '⚽', name: '足球' },
    { icon: '🎁', name: '礼物' },
    { icon: '🎪', name: '游乐园' },
    { icon: '🎬', name: '电影' },
    { icon: '🍕', name: '披萨' },
    { icon: '🌟', name: '星星' },
];

const LOTTERY_ICONS = [
    { icon: '💰', name: '金币' },
    { icon: '💵', name: '现金' },
    { icon: '🪙', name: '硬币' },
    { icon: '💎', name: '钻石' },
    { icon: '🍬', name: '糖果' },
    { icon: '🍭', name: '棒棒糖' },
    { icon: '🍪', name: '饼干' },
    { icon: '🎂', name: '蛋糕' },
    { icon: '🍦', name: '冰淇淋' },
    { icon: '🎫', name: '免做卡' },
    { icon: '🎟️', name: '券' },
    { icon: '🏷️', name: '贴纸' },
    { icon: '🔄', name: '再来一次' },
    { icon: '😎', name: '谢谢参与' },
    { icon: '🎁', name: '神秘礼物' },
    { icon: '✨', name: '惊喜' },
    { icon: '🌟', name: '星星' },
    { icon: '🎀', name: '蝴蝶结' },
    { icon: '🧸', name: '玩具' },
    { icon: '📱', name: '手机时间' },
];

const SAVINGS_ICONS = [
    { icon: '🎮', name: '游戏机' },
    { icon: '📱', name: '手机' },
    { icon: '💻', name: '电脑' },
    { icon: '🚲', name: '自行车' },
    { icon: '⌚', name: '手表' },
    { icon: '🎸', name: '吉他' },
    { icon: '📷', name: '相机' },
    { icon: '🎧', name: '耳机' },
    { icon: '👟', name: '球鞋' },
    { icon: '🏀', name: '篮球' },
    { icon: '🎁', name: '大礼物' },
    { icon: '✈️', name: '旅行' },
];

export default function ParentWishes() {
  const navigate = useNavigate();
  const [wishes, setWishes] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  
  // Tabs: shop | savings | lottery
  const [viewType, setViewType] = useState<'shop'|'savings'|'lottery'>('shop');
  
  // Form
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('');
  const [target, setTarget] = useState('');
  const [icon, setIcon] = useState('🎁');

  // 抽奖奖池上架模式
  const [lotteryEditMode, setLotteryEditMode] = useState(false);
  const [selectedLotteryIds, setSelectedLotteryIds] = useState<Set<string>>(new Set());
  
  // 编辑奖品权重
  const [editingWish, setEditingWish] = useState<any>(null);
  const [editWeight, setEditWeight] = useState(10);

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

  const getIconsForType = () => {
      switch (viewType) {
          case 'shop': return SHOP_ICONS;
          case 'lottery': return LOTTERY_ICONS;
          case 'savings': return SAVINGS_ICONS;
          default: return SHOP_ICONS;
      }
  };

  const resetForm = () => {
      setTitle('');
      setCost('');
      setTarget('');
      setIcon('🎁');
  };

  const handleAdd = async () => {
    if (!title) return alert('请输入标题');
    await api.post('/parent/wishes', {
      type: viewType, 
      title, 
      cost: +cost, 
      targetAmount: +target, 
      icon, 
      stock: viewType === 'shop' ? 99 : (viewType === 'lottery' ? -1 : -1), // 抽奖默认无限库存
      weight: 10 // 默认权重
    });
    setShowAdd(false); 
    resetForm();
    fetchWishes();
  };
  
  // 打开编辑权重弹窗
  const openWeightEditor = (wish: any) => {
    setEditingWish(wish);
    setEditWeight(wish.weight || 10);
  };
  
  // 保存权重
  const saveWeight = async () => {
    if (!editingWish) return;
    try {
      await api.put(`/parent/wishes/${editingWish.id}`, {
        title: editingWish.title,
        cost: editingWish.cost,
        icon: editingWish.icon,
        stock: editingWish.stock,
        weight: editWeight
      });
      setEditingWish(null);
      fetchWishes();
    } catch (e: any) {
      alert('保存失败');
    }
  };
  
  // 计算概率
  const calculateProbability = (weight: number, items: any[]) => {
    const totalWeight = items.reduce((sum, w) => sum + (w.weight || 10), 0);
    if (totalWeight === 0) return 0;
    return ((weight / totalWeight) * 100).toFixed(1);
  };

  const handleDelete = async (id: string) => {
      if (!window.confirm('确定删除吗？')) return;
      await api.delete(`/parent/wishes/${id}`);
      fetchWishes();
  };

  // 切换奖品选择
  const toggleLotterySelection = (id: string) => {
    const newSet = new Set(selectedLotteryIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      if (newSet.size >= 8) {
        alert('最多只能选择8个奖品上架到转盘！');
        return;
      }
      newSet.add(id);
    }
    setSelectedLotteryIds(newSet);
  };

  // 保存奖池上架设置
  const saveLotterySelection = async () => {
    if (selectedLotteryIds.size !== 8) {
      alert(`请选择恰好8个奖品上架！当前已选 ${selectedLotteryIds.size} 个`);
      return;
    }
    try {
      await api.post('/parent/wishes/lottery/activate', {
        activeIds: Array.from(selectedLotteryIds)
      });
      alert('奖池设置成功！');
      setLotteryEditMode(false);
      fetchWishes();
    } catch (e: any) {
      alert(e.response?.data?.message || '设置失败');
    }
  };

  // Filter list
  const filteredList = wishes.filter(w => w.type === viewType);
  
  // 统计抽奖奖池
  const lotteryItems = wishes.filter(w => w.type === 'lottery');
  const activeLotteryCount = lotteryItems.filter(w => w.isActive).length;

  const currentIcons = getIconsForType();

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
                onClick={() => { setViewType(tab.id as any); setShowAdd(false); resetForm(); }}
                className={`flex-1 py-3 text-sm font-bold transition-colors ${viewType === tab.id ? 'text-pink-600 border-b-2 border-pink-600 bg-pink-50/50' : 'text-gray-500'}`}
              >
                  {tab.label}
              </button>
          ))}
      </div>

      {showAdd && (
        <div className={`p-4 border-b animate-in slide-in-from-top ${
            viewType === 'shop' ? 'bg-gradient-to-b from-pink-50 to-rose-50' :
            viewType === 'lottery' ? 'bg-gradient-to-b from-purple-50 to-indigo-50' :
            'bg-gradient-to-b from-blue-50 to-cyan-50'
        }`}>
          <h3 className="font-bold mb-3">
              {viewType === 'shop' && '🛒 新建商品'}
              {viewType === 'savings' && '🎯 新建储蓄目标'}
              {viewType === 'lottery' && '🎰 新建奖品'}
          </h3>
          
          <div className="space-y-3">
              <div className="flex gap-2">
                 <div className="relative">
                     <label className="text-xs text-gray-500 font-bold">图标</label>
                     <button 
                         onClick={() => setShowIconPicker(!showIconPicker)}
                         className="w-14 h-10 rounded-lg border bg-white text-2xl flex items-center justify-center hover:bg-gray-50 shadow-sm"
                     >
                         {icon}
                     </button>
                     
                     {/* 图标选择器 */}
                     {showIconPicker && (
                         <div className="absolute top-full left-0 mt-1 p-3 bg-white rounded-xl shadow-xl border z-50 w-72">
                             <div className="text-xs text-gray-400 mb-2 font-medium">选择图标</div>
                             <div className="grid grid-cols-5 gap-2">
                                 {currentIcons.map((item, i) => (
                                     <button 
                                         key={i}
                                         onClick={() => setIcon(item.icon)}
                                         className={`w-11 h-11 rounded-lg text-xl hover:bg-pink-100 transition-all flex items-center justify-center ${icon === item.icon ? 'bg-pink-200 ring-2 ring-pink-400 scale-110' : 'bg-gray-50'}`}
                                         title={item.name}
                                     >
                                         {item.icon}
                                     </button>
                                 ))}
                             </div>
                             <button 
                                 onClick={() => setShowIconPicker(false)}
                                 className="w-full mt-3 py-2 bg-blue-500 text-white rounded-lg font-bold text-sm hover:bg-blue-600 transition-colors"
                             >
                                 确定
                             </button>
                         </div>
                     )}
                 </div>
                 <div className="flex-1">
                     <label className="text-xs text-gray-500 font-bold">名称</label>
                     <input className="w-full p-2 rounded-lg border" placeholder="例如：乐高玩具" value={title} onChange={e => setTitle(e.target.value)} />
                 </div>
              </div>
              
              {viewType === 'shop' && (
                  <div>
                      <label className="text-xs text-gray-500 font-bold">兑换价格 (金币)</label>
                      <input className="w-full p-2 rounded-lg border" type="number" placeholder="30" value={cost} onChange={e => setCost(e.target.value)} />
                  </div>
              )}
              
              {viewType === 'savings' && (
                  <div>
                      <label className="text-xs text-gray-500 font-bold">目标金额 (金币)</label>
                      <input className="w-full p-2 rounded-lg border" type="number" placeholder="1000" value={target} onChange={e => setTarget(e.target.value)} />
                      <p className="text-[10px] text-gray-400 mt-1">💡 孩子可以看到储蓄进度，激励存钱</p>
                  </div>
              )}

              {viewType === 'lottery' && (
                  <div className="text-xs text-gray-600 bg-white p-3 rounded-lg border border-dashed">
                      <div className="font-bold text-purple-600 mb-1">💡 抽奖说明</div>
                      <ul className="space-y-1 text-gray-500">
                          <li>• 先添加奖品到奖池，然后点击"管理上架"选择8个奖品</li>
                          <li>• 每次抽奖消耗 10 金币</li>
                          <li>• 必须选择恰好 8 个奖品才能上架转盘</li>
                      </ul>
                  </div>
              )}
              
              <div className="flex gap-2 pt-2">
                 <Button size="sm" onClick={handleAdd} className={`flex-1 border-none ${
                     viewType === 'shop' ? 'bg-gradient-to-r from-pink-500 to-rose-500' :
                     viewType === 'lottery' ? 'bg-gradient-to-r from-purple-500 to-indigo-500' :
                     'bg-gradient-to-r from-blue-500 to-cyan-500'
                 }`}>保存</Button>
                 <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }}>取消</Button>
              </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        {/* 抽奖奖池特殊操作栏 */}
        {viewType === 'lottery' && lotteryItems.length > 0 && (
          <div className={`p-3 rounded-xl ${lotteryEditMode ? 'bg-purple-100 border-2 border-purple-400' : 'bg-purple-50'}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-bold text-purple-700">转盘状态：</span>
                {activeLotteryCount === 8 ? (
                  <span className="text-green-600 font-bold ml-1">✅ 已上架 8 个奖品</span>
                ) : (
                  <span className="text-orange-600 font-bold ml-1">⚠️ 已上架 {activeLotteryCount}/8 个</span>
                )}
              </div>
              {!lotteryEditMode ? (
                <button 
                  onClick={() => setLotteryEditMode(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600 transition-colors"
                >
                  <Settings2 size={14}/> 管理上架
                </button>
              ) : (
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setLotteryEditMode(false); fetchWishes(); }}
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
                💡 点击奖品进行勾选，选满8个后点击"确认上架"
              </div>
            )}
          </div>
        )}

        {filteredList.length === 0 && !showAdd && (
            <div className="text-center py-8">
                <div className="text-5xl mb-3">
                    {viewType === 'shop' && '🛒'}
                    {viewType === 'savings' && '🎯'}
                    {viewType === 'lottery' && '🎰'}
                </div>
                <div className="text-gray-400">暂无数据，点击右上角 + 添加</div>
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
              <div>
                <div className="font-bold text-gray-800 flex items-center gap-2">
                  {w.title}
                  {/* 显示上架状态标记 */}
                  {w.type === 'lottery' && w.isActive && !lotteryEditMode && (
                    <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-bold">
                      已上架
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                  {w.type === 'shop' && <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full">💰 {w.cost} 金币</span>}
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
                {/* 抽奖奖品显示编辑权重按钮 */}
                {w.type === 'lottery' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); openWeightEditor(w); }} 
                    className="p-2 text-purple-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                    title="编辑权重"
                  >
                    <Edit2 size={16}/>
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleDelete(w.id); }} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={18}/>
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>
      
      {/* 权重编辑弹窗 */}
      {editingWish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">设置中奖权重</h3>
              <button onClick={() => setEditingWish(null)} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>
            
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">{editingWish.icon}</div>
              <div className="font-bold text-gray-800">{editingWish.title}</div>
            </div>
            
            <div className="mb-4">
              <label className="text-sm font-bold text-gray-600 block mb-2">中奖权重 (1-100)</label>
              <div className="flex items-center gap-3">
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
            </div>
            
            <div className="bg-purple-50 p-3 rounded-xl mb-4">
              <div className="text-xs text-purple-600 space-y-1">
                <div className="font-bold">💡 权重说明</div>
                <div>• 数值越高，中奖概率越大</div>
                <div>• 概率 = 该奖品权重 ÷ 所有上架奖品权重之和</div>
                <div className="mt-2 font-bold">推荐设置：</div>
                <div>• 高价值奖品：5-15（稀有）</div>
                <div>• 中等奖品：20-35（较常见）</div>
                <div>• 安慰奖：40-60（常见）</div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => setEditingWish(null)}
                className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200"
              >
                取消
              </button>
              <button 
                onClick={saveWeight}
                className="flex-1 py-2.5 bg-purple-500 text-white rounded-xl font-bold hover:bg-purple-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
