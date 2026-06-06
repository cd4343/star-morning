import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { IntroModal } from '../../components/IntroModal';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';

export default function Register() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();
  
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [devSmsCode, setDevSmsCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast.warning('请输入正确的11位手机号码');
    if (countdown > 0) return;

    try {
      setLoading(true);
      const res = await api.post('/auth/sms/send', { phone, purpose: 'register' });
      setCountdown(60);
      setDevSmsCode(res.data.devCode || '');
      if (res.data.devCode) {
        toast.info(`测试验证码：${res.data.devCode}`);
      } else {
        toast.success('验证码已发送');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || '验证码发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!phone) return toast.warning('请输入手机号');
    if (!password) return toast.warning('请设置密码');
    if (!verifyCode) return toast.warning('请输入验证码');
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast.warning('手机号格式不正确');
    if (password.length < 6) return toast.warning('密码至少需要6位');
    if (!/^\d{6}$/.test(verifyCode)) return toast.warning('请输入 6 位短信验证码');

    try {
      setLoading(true);
      const res = await api.post('/auth/register', { email: phone, password, smsCode: verifyCode });
      localStorage.setItem('last_phone', phone);
      login(res.data.token, res.data.user);
      toast.success('注册成功！');
      navigate('/create-family');
    } catch (err: any) {
      toast.error(err.response?.data?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      {showIntro && <IntroModal onClose={() => setShowIntro(false)} />}
      <Header title="首次使用" showBack />
      <div className="p-6 flex flex-col h-full">
        <h2 className="text-2xl font-bold mb-6 text-center">创建您的家庭账户</h2>
        <p className="text-gray-500 text-sm text-center mb-4 -mt-4">注册成为家长，管理孩子的任务和奖励</p>
        <div className="space-y-4 flex-1">
          <input 
            className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" 
            placeholder="家长手机号" 
            value={phone} 
            maxLength={11} 
            type="tel" 
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} 
          />
          <div className="flex gap-2">
            <input 
              className="flex-1 p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" 
              placeholder="短信验证码" 
              value={verifyCode} 
              maxLength={6} 
              type="tel" 
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))} 
            />
            <button 
              onClick={handleSendCode} 
              disabled={countdown > 0 || !phone} 
              className={`px-4 rounded-xl font-bold text-sm w-32 transition-all ${countdown > 0 || !phone ? 'bg-gray-200 text-gray-400' : 'bg-blue-100 text-blue-600'}`}
            >
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </button>
          </div>
          {devSmsCode && (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              开发测试验证码：{devSmsCode}
            </div>
          )}
          <input 
            className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500" 
            type="password" 
            placeholder="设置登录密码 (至少6位)" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
          />
        </div>
        <Button onClick={handleRegister} size="lg" disabled={loading}>
          {loading ? '处理中...' : '立即注册'}
        </Button>
        <div className="text-center mt-4">
          <span className="text-gray-400 text-sm">已有账号？ </span>
          <button onClick={() => navigate('/login')} className="text-blue-600 font-bold text-sm">去登录</button>
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
    </Layout>
  );
}
