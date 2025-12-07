import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { IntroModal } from '../../components/IntroModal';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  
  // 检查是否有保存的手机号
  const savedPhone = localStorage.getItem('last_phone') || '';
  const hasQuickLogin = !!savedPhone;
  
  const [phone, setPhone] = useState(savedPhone);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFullForm, setShowFullForm] = useState(!hasQuickLogin);
  const [showIntro, setShowIntro] = useState(false);

  const handleLogin = async () => {
    if (!phone || !password) return toast.warning('请输入手机号和密码');
    try {
      setLoading(true);
      const res = await api.post('/auth/login', { phone, password });
      
      localStorage.setItem('last_phone', phone);
      login(res.data.token, res.data.user);
      
      if (res.data.user.familyId === 'TEMP') {
        navigate('/create-family');
      } else {
        navigate('/select-user');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || '登录失败';
      
      if (msg.includes('账号') || msg.includes('不存在') || msg.includes('错误')) {
        const shouldRegister = await confirm({
          title: '账号不存在',
          message: `${msg}\n\n该账号可能不存在，是否前往注册？`,
          type: 'info',
          confirmText: '去注册',
          cancelText: '取消',
        });
        if (shouldRegister) {
          localStorage.removeItem('last_phone');
          navigate('/register');
          return;
        }
      }
      
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = () => {
    setPhone('');
    setShowFullForm(true);
  };

  // 快速登录界面
  if (hasQuickLogin && !showFullForm) {
    return (
      <Layout>
        {showIntro && <IntroModal onClose={() => setShowIntro(false)} />}
        <div className="p-6 flex flex-col h-full items-center justify-center">
          <div className="text-6xl mb-4">🌟</div>
          <h1 className="text-2xl font-black text-gray-800 mb-2">星辰早晨</h1>
          <p className="text-gray-400 text-sm mb-8">家庭成长激励系统</p>
          
          <div className="w-full max-w-sm bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100 shadow-lg">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">👋</div>
              <div className="text-gray-600 text-sm">欢迎回来</div>
              <div className="font-bold text-xl text-gray-800 mt-1">{savedPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</div>
            </div>
            
            <input 
              className="w-full p-4 bg-white rounded-xl outline-none focus:ring-2 ring-blue-500 mb-4 text-center" 
              type="password" 
              placeholder="请输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
            />
            
            <Button onClick={handleLogin} size="lg" className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 border-none" disabled={loading}>
              {loading ? '登录中...' : '一键登录'}
            </Button>
          </div>
          
          <div className="mt-8 flex flex-col items-center gap-3">
            <button onClick={switchAccount} className="text-gray-500 text-sm hover:text-gray-700">
              使用其他账号登录
            </button>
            <button onClick={() => navigate('/register')} className="text-blue-600 font-bold text-sm">
              注册新账号
            </button>
            <button 
              onClick={() => setShowIntro(true)} 
              className="mt-4 px-4 py-2 bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 text-sm font-bold rounded-full border border-amber-200 hover:from-amber-200 hover:to-orange-200 transition-all animate-pulse hover:animate-none shadow-sm flex items-center gap-1.5"
            >
              <span className="text-base">💡</span> 了解这个应用
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // 完整登录表单
  return (
    <Layout>
      {showIntro && <IntroModal onClose={() => setShowIntro(false)} />}
      <Header title="登录" showBack onBack={() => hasQuickLogin ? setShowFullForm(false) : navigate('/register')} />
      <div className="p-6 flex flex-col h-full">
        <h2 className="text-2xl font-bold mb-6 text-center">欢迎回来</h2>
        
        <div className="space-y-4 flex-1">
          <input 
            className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" 
            placeholder="家长手机号"
            value={phone}
            type="tel"
            onChange={e => setPhone(e.target.value)}
          />
          <input 
            className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" 
            type="password" 
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <Button onClick={handleLogin} size="lg" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </Button>
        
        <div className="text-center mt-4">
          <span className="text-gray-400 text-sm">还没有账号？ </span>
          <button onClick={() => navigate('/register')} className="text-blue-600 font-bold text-sm">立即注册</button>
        </div>
        
        <div className="text-center mt-4">
          <button 
            onClick={() => setShowIntro(true)} 
            className="px-4 py-2 bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 text-sm font-bold rounded-full border border-amber-200 hover:from-amber-200 hover:to-orange-200 transition-all animate-pulse hover:animate-none shadow-sm inline-flex items-center gap-1.5"
          >
            <span className="text-base">💡</span> 了解这个应用
          </button>
        </div>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
