import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [mockServerCode, setMockServerCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

  // 应用介绍弹窗
  const IntroModal = () => (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowIntro(false)}>
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🌟</div>
          <h2 className="text-xl font-bold text-gray-800">星辰早晨</h2>
          <p className="text-sm text-gray-500">家庭成长激励系统</p>
        </div>
        
        <div className="space-y-4 text-sm text-gray-600">
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="font-bold text-blue-700 mb-2">💡 这是什么？</div>
            <p>一个帮助孩子养成好习惯的家庭任务管理应用。家长设置任务和奖励，孩子完成任务获得金币和成就！</p>
          </div>
          
          <div className="bg-green-50 rounded-xl p-4">
            <div className="font-bold text-green-700 mb-2">✨ 主要功能</div>
            <ul className="space-y-1 ml-4 list-disc">
              <li>任务管理：设置每日/每周任务</li>
              <li>金币奖励：完成任务获得金币</li>
              <li>心愿商店：用金币兑换奖励</li>
              <li>成就系统：解锁各种成就勋章</li>
              <li>抽奖玩法：金币参与趣味抽奖</li>
            </ul>
          </div>
          
          <div className="bg-orange-50 rounded-xl p-4">
            <div className="font-bold text-orange-700 mb-2">👨‍👩‍👧 如何使用？</div>
            <ol className="space-y-1 ml-4 list-decimal">
              <li>家长注册账号并创建家庭</li>
              <li>添加孩子信息</li>
              <li>设置任务、奖励、商品</li>
              <li>孩子完成任务后提交审核</li>
              <li>家长审核通过后发放奖励</li>
            </ol>
          </div>
        </div>
        
        <button 
          onClick={() => setShowIntro(false)}
          className="w-full mt-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-bold"
        >
          知道了
        </button>
      </div>
    </div>
  );

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) return alert('请输入正确的11位手机号码');
    setCountdown(60);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setMockServerCode(code);
    setTimeout(() => alert(`【星辰系统】您的验证码是：${code}，请在5分钟内完成注册。`), 1000);
  };

  const handleRegister = async () => {
    if (!phone) return alert('请输入手机号');
    if (!password) return alert('请设置密码');
    if (!verifyCode) return alert('请输入验证码');
    if (!/^1[3-9]\d{9}$/.test(phone)) return alert('手机号格式不正确');
    if (password.length < 6) return alert('密码至少需要6位');
    if (verifyCode !== mockServerCode) return alert('验证码错误，请重新获取');

    try {
      setLoading(true);
      const res = await api.post('/auth/register', { email: phone, password });
      // 保存手机号以便下次登录时自动填充
      localStorage.setItem('last_phone', phone);
      login(res.data.token);
      navigate('/create-family');
    } catch (err: any) {
      alert(err.response?.data?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      {showIntro && <IntroModal />}
      <Header title="首次使用" showBack />
      <div className="p-6 flex flex-col h-full">
        <h2 className="text-2xl font-bold mb-6 text-center">创建您的家庭账户</h2>
        <p className="text-gray-500 text-sm text-center mb-4 -mt-4">注册成为家长，管理孩子的任务和奖励</p>
        <div className="space-y-4 flex-1">
          <div>
            <input className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" placeholder="家长手机号" value={phone} maxLength={11} type="tel" onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div className="flex gap-2">
            <input className="flex-1 p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" placeholder="短信验证码" value={verifyCode} maxLength={6} type="tel" onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))} />
            <button onClick={handleSendCode} disabled={countdown > 0 || !phone} className={`px-4 rounded-xl font-bold text-sm w-32 transition-all ${countdown > 0 || !phone ? 'bg-gray-200 text-gray-400' : 'bg-blue-100 text-blue-600'}`}>{countdown > 0 ? `${countdown}s` : '获取验证码'}</button>
          </div>
          <div>
            <input className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" type="password" placeholder="设置登录密码 (至少6位)" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleRegister} size="lg" disabled={loading}>{loading ? '处理中...' : '立即注册'}</Button>
        <div className="text-center mt-4">
            <span className="text-gray-400 text-sm">已有账号？ </span>
            <button onClick={() => navigate('/login')} className="text-blue-600 font-bold text-sm">去登录</button>
        </div>
        <div className="text-center mt-2">
            <button onClick={() => setShowIntro(true)} className="text-gray-400 text-xs hover:text-gray-600">
              了解这个应用
            </button>
        </div>
      </div>
    </Layout>
  );
}
