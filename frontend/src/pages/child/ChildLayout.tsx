import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { CheckSquare, Gift, User, RefreshCw, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { InputModal } from '../../components/Modal';

export default function ChildLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, login } = useAuth();
  const [childData, setChildData] = useState<any>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showDefaultPinHint, setShowDefaultPinHint] = useState(false);
  const [showPinChangeReminder, setShowPinChangeReminder] = useState(false);

  useEffect(() => {
    fetchData();
  }, [location.pathname]); 

  const fetchData = async () => {
    try {
      const res = await api.get('/child/dashboard');
      setChildData(res.data.child);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSwitchUser = () => {
      // 先显示默认PIN码提示
      setShowDefaultPinHint(true);
  };
  
  const handleContinueToPin = () => {
      setShowDefaultPinHint(false);
      setShowPinModal(true);
  };

  const handlePinConfirm = async (pin: string) => {
      try {
          const res = await api.post('/child/switch-to-parent', { pin });
          login(res.data.token, res.data.user);
          
          // 如果使用的是默认PIN，提醒修改
          if (res.data.isDefaultPin) {
              setShowPinChangeReminder(true);
          } else {
              navigate('/parent/dashboard');
          }
      } catch (e: any) {
          alert(e.response?.data?.message || 'PIN 码错误');
      }
  };
  
  const handlePinChangeReminderClose = () => {
      setShowPinChangeReminder(false);
      navigate('/parent/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-200 md:flex md:items-center md:justify-center md:p-6">
      {/* PC Device Frame Container */}
      <div className="w-full h-screen md:h-[850px] md:max-w-md bg-gray-50 flex flex-col md:rounded-[2.5rem] md:shadow-2xl md:border-[8px] md:border-gray-900 overflow-hidden relative">
          
          {/* Top Bar */}
          <div className="bg-white p-3 shadow-sm z-10 sticky top-0">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl border-2 border-white shadow-sm ${childData?.gender === 'girl' ? 'bg-pink-100' : 'bg-green-100'}`}>
                   {childData?.avatar || (childData?.gender === 'girl' ? '👧' : '👦')}
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-sm flex items-center gap-2">
                    {childData?.name || 'Loading...'}
                    <span className="text-[10px] bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                      Lv.{childData?.level || 1}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 flex gap-2 font-mono">
                     <span className="flex items-center gap-1"><span className="text-yellow-500">🪙</span> {childData?.coins || 0}</span>
                     <span className="flex items-center gap-1"><span className="text-purple-500">⭐</span> {childData?.xp || 0}</span>
                  </div>
                </div>
              </div>
              <button onClick={handleSwitchUser} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors flex items-center gap-1 text-xs font-medium">
                  <RefreshCw size={16}/> 切换
              </button>
            </div>
            
            {/* 经验进度条 */}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-400 to-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(((childData?.xp || 0) % (childData?.maxXp || 100)) / (childData?.maxXp || 100) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                {(childData?.xp || 0) % (childData?.maxXp || 100)}/{childData?.maxXp || 100}
              </span>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto pb-20 scrollbar-hide">
            <Outlet context={{ childData, refresh: fetchData }} />
          </div>

          {/* Bottom Nav */}
          <div className="bg-white/90 backdrop-blur-md border-t absolute bottom-0 w-full flex justify-around py-3 text-xs text-gray-400 font-medium z-20 pb-5 md:pb-3">
            <NavLink to="/child/tasks" icon={<CheckSquare size={22}/>} label="任务" active={location.pathname.includes('tasks')} />
            <NavLink to="/child/wishes" icon={<Gift size={22}/>} label="心愿" active={location.pathname.includes('wishes')} />
            <NavLink to="/child/me" icon={<User size={22}/>} label="我的" active={location.pathname.includes('me')} />
          </div>
      </div>

      {/* 默认PIN码提示弹窗 */}
      {showDefaultPinHint && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">切换到家长模式</h3>
              <p className="text-gray-600 mb-2">需要输入家长 PIN 码才能切换</p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
                <p className="text-yellow-800 text-sm font-medium">💡 默认 PIN 码是：<span className="font-bold text-lg">1234</span></p>
                <p className="text-yellow-600 text-xs mt-1">如果家长已修改，请输入修改后的 PIN 码</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDefaultPinHint(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-all">
                  取消
                </button>
                <button onClick={handleContinueToPin} className="flex-1 py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all">
                  继续
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIN 输入弹窗 */}
      <InputModal 
          isOpen={showPinModal}
          onClose={() => setShowPinModal(false)}
          onConfirm={handlePinConfirm}
          title="切换到家长模式"
          placeholder="请输入家长 PIN 码"
          type="password"
      />
      
      {/* 修改PIN码提醒弹窗 */}
      {showPinChangeReminder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="text-center">
              <div className="text-5xl mb-3">🔐</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">安全提醒</h3>
              <p className="text-gray-600 mb-4">
                您正在使用默认 PIN 码 (1234)，<br/>
                建议尽快到「家庭管理」中修改为个人专属 PIN 码，<br/>
                以防止孩子随意切换到家长模式。
              </p>
              <button onClick={handlePinChangeReminderClose} className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95">
                知道了，进入家长模式
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const NavLink = ({ to, icon, label, active }: any) => (
  <div onClick={() => window.location.href = to} className={`flex flex-col items-center gap-1 cursor-pointer transition-all duration-200 ${active ? 'text-blue-600 scale-110 font-bold' : 'hover:text-gray-600'}`}>
    {icon}
    <span>{label}</span>
  </div>
);
