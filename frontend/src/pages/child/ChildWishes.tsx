import React, { useEffect, useState, useRef } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { ShoppingBag, RotateCcw, Gift, Dna, X, Coins } from 'lucide-react';

// 友情提示弹窗组件
const TipModal = ({ isOpen, onClose, title, message, icon }: { isOpen: boolean, onClose: () => void, title: string, message: string, icon: string }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="text-center">
          <div className="text-5xl mb-3">{icon}</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
          <p className="text-gray-600 mb-4">{message}</p>
          <button onClick={onClose} className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95">
            知道啦！
          </button>
        </div>
      </div>
    </div>
  );
};

export default function ChildWishes() {
  const context = useOutletContext<any>();
  const childData = context?.childData || { coins: 0, privilegePoints: 0 };
  const refresh = context?.refresh || (() => {});
  
  const [view, setView] = useState<'shop'|'bag'|'savings'|'lottery'|'privileges'>('shop');
  
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [bagItems, setBagItems] = useState<any[]>([]);
  const [bagFilter, setBagFilter] = useState<'all'|'pending'|'redeemed'|'cancelled'>('all');
  const [savingsGoal, setSavingsGoal] = useState<any>(null);
  const [lotteryPrizes, setLotteryPrizes] = useState<any[]>([]);
  const [privileges, setPrivileges] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeGridIndex, setActiveGridIndex] = useState<number | null>(null);
  
  // 过滤背包物品
  const filteredBagItems = bagFilter === 'all' 
    ? bagItems 
    : bagItems.filter(item => {
        // 兼容旧数据
        if (bagFilter === 'pending' && (item.status === 'pending' || item.status === 'unused')) return true;
        if (bagFilter === 'redeemed' && (item.status === 'redeemed' || item.status === 'used')) return true;
        if (bagFilter === 'cancelled' && (item.status === 'cancelled' || item.status === 'returned')) return true;
        return item.status === bagFilter;
      });
  
  // 友情提示弹窗状态
  const [tipModal, setTipModal] = useState<{isOpen: boolean, title: string, message: string, icon: string}>({
    isOpen: false, title: '', message: '', icon: ''
  });
  
  const showTip = (title: string, message: string, icon: string) => {
    setTipModal({ isOpen: true, title, message, icon });
  };

  useEffect(() => { 
    fetchAll(); 
  }, [view]);
  
  // 当切换到特权或背包视图时，确保数据已加载
  useEffect(() => {
    if (view === 'privileges' && privileges.length === 0) {
      api.get('/child/privileges').then(res => setPrivileges(res.data || [])).catch(() => {});
    }
    if (view === 'bag' && bagItems.length === 0) {
      api.get('/child/inventory').then(res => setBagItems(res.data || [])).catch(() => {});
    }
  }, [view]);

  const fetchAll = async () => {
      const res = await api.get('/child/wishes');
      setShopItems(res.data.shop || []);
      setSavingsGoal(res.data.savings);
      setLotteryPrizes(res.data.lottery || []);
      if (view === 'bag') {
          const inv = await api.get('/child/inventory');
          setBagItems(inv.data || []);
      }
      if (view === 'privileges') {
          const priv = await api.get('/child/privileges');
          setPrivileges(priv.data || []);
      }
  };
  
  // 兑换特权
  const handleRedeemPrivilege = async (priv: any) => {
      if ((childData.privilegePoints || 0) < priv.cost) {
          showTip('特权点不足', `你只有 ${childData.privilegePoints || 0} 特权点，无法兑换 ${priv.title}（需要 ${priv.cost} 特权点）。快去完成任务赚取特权点吧！`, '⭐');
          return;
      }
      if (!window.confirm(`确定消耗 ${priv.cost} 特权点兑换 ${priv.title} 吗？`)) return;
      try {
          await api.post(`/child/privileges/${priv.id}/redeem`);
          showTip('兑换成功', `${priv.title} 已放入背包，快去"背包"查看并兑现吧！`, '🎉');
          refresh();
          fetchAll();
      } catch (e: any) {
          alert(e.response?.data?.message || '兑换失败');
      }
  };
  
  // 储蓄存入
  const handleDeposit = async (amount: number) => {
      if (childData.coins < amount) {
          showTip('金币不足', `你只有 ${childData.coins} 金币，无法存入 ${amount} 金币`, '💰');
          return;
      }
      try {
          const res = await api.post(`/child/savings/deposit`, { amount });
          refresh();
          fetchAll();
          if (res.data.goalAchieved) {
              showTip('🎉 目标达成！', `储蓄目标已达成！${savingsGoal?.title} 已放入背包，快去"背包"查看吧！`, '🎊');
          } else {
              showTip('存入成功', `成功存入 ${amount} 金币！继续加油~`, '💪');
          }
      } catch (e: any) {
          alert(e.response?.data?.message || '存入失败');
      }
  };

  const handleRedeem = async (item: any) => {
      if (childData.coins < item.cost) {
          showTip('金币不足', `你只有 ${childData.coins} 金币，无法兑换 ${item.title}（需要 ${item.cost} 金币）。快去完成任务赚取更多金币吧！`, '💰');
          return;
      }
      if (item.stock === 0) {
          showTip('库存不足', `${item.title} 已经卖完啦，请联系家长补货~`, '📦');
          return;
      }
      if (!window.confirm(`确定消耗 ${item.cost} 金币兑换 ${item.title} 吗？`)) return;
      try {
          setLoading(true);
          const res = await api.post(`/child/wishes/${item.id}/redeem`);
          showTip('兑换成功', `${item.title} 已放入背包，快去"背包"查看吧！`, '🎉');
          refresh(); 
          fetchAll(); 
      } catch (e: any) {
          alert(e.response?.data?.message || '兑换失败');
      } finally {
          setLoading(false);
      }
  };

  // 撤销兑换
  const handleCancel = async (item: any) => {
      if (!window.confirm(`确定撤销兑换 ${item.title} 吗？金币将退回。`)) return;
      try {
          await api.post(`/child/inventory/${item.id}/cancel`);
          showTip('已撤销', `${item.title} 已撤销，金币已退回！`, '↩️');
          refresh();
          fetchAll();
      } catch (e: any) {
          alert(e.response?.data?.message || '撤销失败');
      }
  };
  
  // 兑现物品/服务
  const handleRedeemItem = async (item: any) => {
      if (!window.confirm(`确定兑现 ${item.title} 吗？兑现后无法撤销。`)) return;
      try {
          await api.post(`/child/inventory/${item.id}/redeem`);
          showTip('兑现成功', `${item.title} 已兑现！快去享受吧~`, '🎉');
          refresh();
          fetchAll();
      } catch (e: any) {
          alert(e.response?.data?.message || '兑现失败');
      }
  };

  // --- LOTTERY LOGIC ---
  const GRID_PATH = [0, 1, 2, 3, 4, 5, 6, 7];
  const getGridPrizes = () => {
      const slots = new Array(8).fill(null);
      if (lotteryPrizes.length === 0) return slots;
      for (let i = 0; i < 8; i++) {
          slots[i] = lotteryPrizes[i % lotteryPrizes.length];
      }
      return slots;
  };
  const gridPrizes = getGridPrizes();

  const handleLottery = async () => {
      if (loading) return;
      if (childData.coins < 10) {
        showTip('金币不足', `抽奖需要 10 金币，你目前只有 ${childData.coins} 金币。\n快去完成任务赚取更多金币吧！`, '💰');
        return;
      }
      if (lotteryPrizes.length === 0) {
        showTip('奖池为空', '家长还没有设置抽奖奖品哦，请联系家长添加奖品~', '🎁');
        return;
      }
      
      try {
          setLoading(true);
          // Start fake spin
          let currentStep = 0;
          const spinInterval = setInterval(() => {
              setActiveGridIndex(GRID_PATH[currentStep % 8]);
              currentStep++;
          }, 80); // Faster spin

          // Call Backend
          const res = await api.post('/child/lottery/play');
          const winner = res.data.winner;
          
          const winnerIndexInGrid = gridPrizes.findIndex(p => p?.id === winner.id);
          
          setTimeout(() => {
              clearInterval(spinInterval);
              // Land on winner
              setActiveGridIndex(winnerIndexInGrid !== -1 ? winnerIndexInGrid : 0);
              
              setTimeout(() => {
                showTip('🎉 恭喜中奖！', `你抽中了：${winner.title}！已放入背包，快去"背包"查看并兑现吧！`, '🎊');
                setLoading(false);
                setActiveGridIndex(null);
                refresh();
                fetchAll();
              }, 800);
          }, 2500); 

      } catch (e: any) {
          setLoading(false);
          alert(e.response?.data?.message || '失败');
      }
  };

  return (
    <div className={`p-4 space-y-4 min-h-full ${view === 'lottery' ? 'bg-gradient-to-b from-purple-800 to-indigo-900' : ''}`}>
      {/* 顶部金币和特权点显示 */}
      <div className="flex gap-2">
        <div className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 rounded-xl p-3 text-white">
          <div className="text-xs opacity-80">我的金币</div>
          <div className="text-2xl font-black">{childData.coins} 💰</div>
        </div>
        <div className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-3 text-white">
          <div className="text-xs opacity-80">特权点</div>
          <div className="text-2xl font-black">{childData.privilegePoints || 0} ⭐</div>
        </div>
      </div>
      
      <div className="flex bg-white rounded-xl p-1 shadow-sm">
          <button onClick={()=>setView('shop')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${view==='shop'?'bg-pink-100 text-pink-600 shadow-sm':'text-gray-500'}`}>商店</button>
          <button onClick={()=>setView('bag')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${view==='bag'?'bg-blue-100 text-blue-600 shadow-sm':'text-gray-500'}`}>背包</button>
          <button onClick={()=>setView('savings')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${view==='savings'?'bg-green-100 text-green-600 shadow-sm':'text-gray-500'}`}>储蓄</button>
          <button onClick={()=>setView('lottery')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${view==='lottery'?'bg-purple-100 text-purple-600 shadow-sm':'text-gray-500'}`}>抽奖</button>
          <button onClick={()=>setView('privileges')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${view==='privileges'?'bg-yellow-100 text-yellow-600 shadow-sm':'text-gray-500'}`}>特权</button>
      </div>

      {/* SHOP VIEW */}
      {view === 'shop' && (
          <div className="grid grid-cols-2 gap-3">
              {shopItems.map(item => (
                  <Card key={item.id} className="flex flex-col items-center text-center p-4 hover:scale-105 transition-transform">
                      <div className="text-4xl mb-2 drop-shadow-md">{item.icon}</div>
                      <div className="font-bold line-clamp-1 text-gray-800">{item.title}</div>
                      <div className="text-xs text-gray-500 mb-3">库存: {item.stock === -1 ? '无限' : item.stock}</div>
                      <Button size="sm" className="w-full bg-gradient-to-r from-pink-500 to-rose-500 border-none" disabled={childData.coins < item.cost || item.stock === 0 || loading} onClick={() => handleRedeem(item)}>
                          {item.stock === 0 ? '缺货' : `${item.cost} 💰 兑换`}
                      </Button>
                  </Card>
              ))}
              {shopItems.length === 0 && <div className="col-span-2 text-center text-gray-400 py-10">暂无商品</div>}
          </div>
      )}

      {/* BAG VIEW */}
      {view === 'bag' && (
          <div className="space-y-3">
              {/* 状态筛选 */}
              <div className="flex gap-2 bg-white p-2 rounded-xl">
                  <button 
                      onClick={() => setBagFilter('all')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      全部
                  </button>
                  <button 
                      onClick={() => setBagFilter('pending')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'pending' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      待兑现
                  </button>
                  <button 
                      onClick={() => setBagFilter('redeemed')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'redeemed' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      已兑现
                  </button>
                  <button 
                      onClick={() => setBagFilter('cancelled')}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${bagFilter === 'cancelled' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                      已撤销
                  </button>
              </div>
              
              {filteredBagItems.map(item => {
                  const statusMap: Record<string, {label: string, color: string, borderColor: string}> = {
                      'pending': { label: '待兑现', color: 'text-orange-600', borderColor: 'border-orange-400' },
                      'redeemed': { label: '已兑现', color: 'text-green-600', borderColor: 'border-green-400' },
                      'cancelled': { label: '已撤销', color: 'text-red-600', borderColor: 'border-red-400' },
                      // 兼容旧数据
                      'unused': { label: '待兑现', color: 'text-orange-600', borderColor: 'border-orange-400' },
                      'used': { label: '已兑现', color: 'text-green-600', borderColor: 'border-green-400' },
                      'returned': { label: '已撤销', color: 'text-red-600', borderColor: 'border-red-400' },
                  };
                  const statusInfo = statusMap[item.status] || statusMap['pending'];
                  
                  return (
                      <Card key={item.id} className={`flex justify-between items-center border-l-4 ${statusInfo.borderColor}`}>
                          <div className="flex items-center gap-3">
                              <div className="text-3xl bg-blue-50 w-12 h-12 rounded-full flex items-center justify-center">{item.icon}</div>
                              <div>
                                  <div className="font-bold text-gray-800">{item.title}</div>
                                  <div className="text-xs text-gray-500 mt-1">
                                      {new Date(item.acquiredAt).toLocaleDateString()} 获得
                                  </div>
                                  <div className={`text-xs font-bold mt-1 ${statusInfo.color}`}>
                                      {statusInfo.label}
                                  </div>
                              </div>
                          </div>
                          <div className="flex items-center gap-2">
                              {item.status === 'pending' || item.status === 'unused' ? (
                                  <>
                                      <button 
                                          onClick={() => handleRedeemItem(item)} 
                                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors"
                                      >
                                          兑现
                                      </button>
                                      <button 
                                          onClick={() => handleCancel(item)} 
                                          className="px-3 py-1.5 bg-red-100 text-red-600 text-xs font-bold rounded-lg hover:bg-red-200 transition-colors flex items-center gap-1"
                                      >
                                          <RotateCcw size={12}/> 撤销
                                      </button>
                                  </>
                              ) : (
                                  <span className={`text-xs font-bold px-2 py-1 rounded ${statusInfo.color} bg-gray-100`}>
                                      {statusInfo.label}
                                  </span>
                              )}
                          </div>
                      </Card>
                  );
              })}
              {filteredBagItems.length === 0 && (
                  <div className="text-center text-gray-400 py-10">
                      {bagFilter === 'all' ? '背包空空如也' : `暂无${bagFilter === 'pending' ? '待兑现' : bagFilter === 'redeemed' ? '已兑现' : '已撤销'}的物品`}
                  </div>
              )}
          </div>
      )}

      {/* SAVINGS VIEW - 储蓄目标 */}
      {view === 'savings' && (
          <div className="space-y-4">
              {savingsGoal ? (
                  <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                      <div className="text-center mb-4">
                          <div className="text-5xl mb-2">{savingsGoal.icon || '🎯'}</div>
                          <h3 className="font-bold text-xl text-gray-800">{savingsGoal.title}</h3>
                          <p className="text-gray-500 text-sm">储蓄目标</p>
                      </div>
                      
                      {/* 进度条 */}
                      <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                              <span className="text-green-600 font-bold">已存 {savingsGoal.currentAmount || 0}</span>
                              <span className="text-gray-500">目标 {savingsGoal.targetAmount}</span>
                          </div>
                          <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                  className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                                  style={{ width: `${Math.min(((savingsGoal.currentAmount || 0) / savingsGoal.targetAmount) * 100, 100)}%` }}
                              />
                          </div>
                          <div className="text-center mt-2">
                              <span className="text-2xl font-black text-green-600">
                                  {Math.round(((savingsGoal.currentAmount || 0) / savingsGoal.targetAmount) * 100)}%
                              </span>
                          </div>
                      </div>
                      
                      {/* 快捷存入按钮 */}
                      <div className="grid grid-cols-3 gap-2">
                          {[10, 50, 100].map(amount => (
                              <button 
                                  key={amount}
                                  onClick={() => handleDeposit(amount)}
                                  disabled={childData.coins < amount}
                                  className={`py-3 rounded-xl font-bold text-sm transition-all ${
                                      childData.coins >= amount 
                                          ? 'bg-green-500 text-white hover:bg-green-600 active:scale-95' 
                                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  }`}
                              >
                                  存入 {amount}
                              </button>
                          ))}
                      </div>
                      
                      {/* 达成提示 */}
                      {(savingsGoal.currentAmount || 0) >= savingsGoal.targetAmount && (
                          <div className="mt-4 p-3 bg-yellow-100 rounded-xl text-center">
                              <span className="text-2xl">🎉</span>
                              <p className="font-bold text-yellow-800">恭喜！目标已达成！</p>
                              <p className="text-sm text-yellow-600">快去找爸爸妈妈兑换奖励吧~</p>
                          </div>
                      )}
                  </Card>
              ) : (
                  <div className="text-center py-10">
                      <div className="text-5xl mb-4">🎯</div>
                      <p className="text-gray-500">暂无储蓄目标</p>
                      <p className="text-gray-400 text-sm mt-1">让爸爸妈妈帮你设置一个吧~</p>
                  </div>
              )}
          </div>
      )}

      {/* LOTTERY VIEW (Dopamine Style) */}
      {view === 'lottery' && (
          <div className="flex flex-col items-center py-6">
              {/* Title & Decor */}
              <div className="mb-6 text-center animate-bounce-slow">
                  <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-300 to-cyan-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
                      幸运大转盘
                  </h2>
                  <p className="text-purple-200 text-xs mt-1">100% 中奖 · 惊喜不断</p>
              </div>

              <div className="bg-gradient-to-b from-orange-400 to-red-500 p-4 rounded-[2rem] shadow-[0_10px_30px_rgba(0,0,0,0.5)] border-4 border-yellow-400 relative w-full max-w-[320px] aspect-square mx-auto">
                  {/* Lights */}
                  <div className="absolute inset-0 rounded-[1.8rem] border-2 border-dashed border-yellow-200/50 pointer-events-none"></div>
                  <div className="absolute top-2 left-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping"/>
                  <div className="absolute top-2 right-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-75"/>
                  <div className="absolute bottom-2 left-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-150"/>
                  <div className="absolute bottom-2 right-2 w-3 h-3 bg-yellow-200 rounded-full shadow-[0_0_10px_#fef08a] animate-ping delay-300"/>
                  
                  <div className="grid grid-cols-3 gap-2 h-full mt-1">
                      {/* Top Row: 0, 1, 2 */}
                      {[0, 1, 2].map(i => <GridItem key={i} item={gridPrizes[i]} active={activeGridIndex === i} />)}
                      
                      {/* Middle Row: 7, Button, 3 */}
                      <GridItem item={gridPrizes[7]} active={activeGridIndex === 7} />
                      
                      {/* CENTER BUTTON */}
                      <button 
                          onClick={handleLottery}
                          disabled={loading || childData.coins < 10}
                          className="bg-gradient-to-b from-purple-500 to-purple-700 hover:from-purple-400 hover:to-purple-600 active:scale-95 transition-all rounded-xl flex flex-col items-center justify-center shadow-[0_4px_0_#4c1d95] text-white disabled:opacity-80 disabled:grayscale z-20"
                      >
                          <div className="font-black text-xl drop-shadow-md">抽奖</div>
                          <div className="text-[10px] font-bold bg-black/20 px-2 rounded-full mt-1">10💰</div>
                      </button>
                      
                      <GridItem item={gridPrizes[3]} active={activeGridIndex === 3} />
                      
                      {/* Bottom Row: 6, 5, 4 */}
                      {[6, 5, 4].map(i => <GridItem key={i} item={gridPrizes[i]} active={activeGridIndex === i} />)}
                  </div>
              </div>
              
              <div className="mt-8 text-center text-white/60 text-xs bg-black/20 px-4 py-2 rounded-full backdrop-blur-sm">
                  每次抽奖消耗 10 金币 · 奖品放入背包
              </div>
          </div>
      )}

      {/* PRIVILEGES VIEW - 特权兑换 */}
      {view === 'privileges' && (
          <div className="space-y-3">
              {privileges.length > 0 ? (
                  privileges.map(priv => (
                      <Card key={priv.id} className="bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-200">
                          <div className="flex justify-between items-center">
                              <div className="flex items-center gap-3">
                                  <div className="text-4xl bg-yellow-100 w-16 h-16 rounded-xl flex items-center justify-center shadow-sm">
                                      👑
                                  </div>
                                  <div>
                                      <div className="font-bold text-gray-800 text-lg">{priv.title}</div>
                                      {priv.description && (
                                          <div className="text-xs text-gray-600 mt-1">{priv.description}</div>
                                      )}
                                      <div className="text-xs text-yellow-600 font-bold mt-1">
                                          {priv.cost} 特权点
                                      </div>
                                  </div>
                              </div>
                              <button
                                  onClick={() => handleRedeemPrivilege(priv)}
                                  disabled={(childData.privilegePoints || 0) < priv.cost}
                                  className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                                      (childData.privilegePoints || 0) >= priv.cost
                                          ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white hover:opacity-90 shadow-lg'
                                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  }`}
                              >
                                  兑换
                              </button>
                          </div>
                      </Card>
                  ))
              ) : (
                  <div className="text-center py-10">
                      <div className="text-5xl mb-4">👑</div>
                      <p className="text-gray-500">暂无特权</p>
                      <p className="text-gray-400 text-sm mt-1">让爸爸妈妈帮你设置特权吧~</p>
                  </div>
              )}
          </div>
      )}
      
      {/* 友情提示弹窗 */}
      <TipModal 
        isOpen={tipModal.isOpen}
        onClose={() => setTipModal(prev => ({...prev, isOpen: false}))}
        title={tipModal.title}
        message={tipModal.message}
        icon={tipModal.icon}
      />
    </div>
  );
}

const GridItem = ({ item, active }: { item: any, active: boolean }) => (
    <div className={`bg-white rounded-xl flex flex-col items-center justify-center p-1 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] transition-all duration-100 relative overflow-hidden ${active ? 'ring-4 ring-yellow-300 ring-offset-2 ring-offset-orange-500 bg-yellow-50 scale-105 z-10' : ''}`}>
        {active && <div className="absolute inset-0 bg-yellow-200/30 animate-pulse"/>}
        <div className="text-3xl mb-1 filter drop-shadow-sm">{item?.icon || '❓'}</div>
        <div className="text-[10px] font-bold text-gray-600 truncate w-full text-center leading-tight">{item?.title || '???'}</div>
    </div>
);
