import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { IntroModal } from '../../components/IntroModal';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { ResetPasswordModal } from '../../components/ResetPasswordModal';

type LoginMode = 'password' | 'sms';

const QUICK_LOGIN_TOKEN_KEY = 'quick_login_token';
const QUICK_LOGIN_USER_KEY = 'quick_login_user';
const QUICK_LOGIN_EXPIRES_KEY = 'quick_login_expires_at';
const QUICK_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const clearQuickLogin = () => {
  localStorage.removeItem(QUICK_LOGIN_TOKEN_KEY);
  localStorage.removeItem(QUICK_LOGIN_USER_KEY);
  localStorage.removeItem(QUICK_LOGIN_EXPIRES_KEY);
};

const getQuickLoginSession = () => {
  const token = localStorage.getItem(QUICK_LOGIN_TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(QUICK_LOGIN_EXPIRES_KEY) || 0);
  if (!token || !expiresAt || expiresAt < Date.now()) {
    clearQuickLogin();
    return null;
  }

  try {
    const user = JSON.parse(localStorage.getItem(QUICK_LOGIN_USER_KEY) || 'null');
    return { token, user };
  } catch {
    clearQuickLogin();
    return null;
  }
};

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  // 检查是否有保存的手机号
  const savedPhone = localStorage.getItem('last_phone') || '';
  const initialQuickSession = getQuickLoginSession();
  const hasQuickLogin = !!savedPhone;
  const [phone, setPhone] = useState(savedPhone);
  const [password, setPassword] = useState('');
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [smsCode, setSmsCode] = useState('');
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [devSmsCode, setDevSmsCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFullForm, setShowFullForm] = useState(!hasQuickLogin);
  const [quickLoginAvailable, setQuickLoginAvailable] = useState(Boolean(savedPhone && initialQuickSession));
  const [showPasswordField, setShowPasswordField] = useState(!initialQuickSession);
  const [showIntro, setShowIntro] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    localStorage.removeItem('last_password');
  }, []);

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setSmsCountdown(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  const goAfterLogin = (token: string, user: any, loginPhone: string) => {
    localStorage.setItem('last_phone', loginPhone);
    localStorage.removeItem('last_password');
    localStorage.setItem(QUICK_LOGIN_TOKEN_KEY, token);
    localStorage.setItem(QUICK_LOGIN_USER_KEY, JSON.stringify(user));
    localStorage.setItem(QUICK_LOGIN_EXPIRES_KEY, String(Date.now() + QUICK_LOGIN_TTL_MS));
    login(token, user);

    if (user.familyId === 'TEMP') {
      navigate('/create-family');
    } else {
      navigate('/select-user');
    }
  };

  const handleQuickLogin = async () => {
    const session = getQuickLoginSession();
    if (!session) {
      setQuickLoginAvailable(false);
      setShowPasswordField(true);
      return toast.warning('本机登录状态已过期，请重新输入一次密码');
    }

    try {
      setLoading(true);
      localStorage.setItem('token', session.token);
      if (session.user) localStorage.setItem('user', JSON.stringify(session.user));
      await api.get('/auth/members');
      login(session.token, session.user);

      if (session.user?.familyId === 'TEMP') {
        navigate('/create-family');
      } else {
        navigate('/select-user');
      }
    } catch (err: any) {
      clearQuickLogin();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setQuickLoginAvailable(false);
      setShowPasswordField(true);
      toast.error(err.response?.data?.message || '一键登录已失效，请重新输入密码');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!phone || !password) {
      setShowPasswordField(true);
      return toast.warning('请输入手机号和密码');
    }
    try {
      setLoading(true);
      const res = await api.post('/auth/login', { phone, password });
      goAfterLogin(res.data.token, res.data.user, phone);
    } catch (err: any) {
      const msg = err.response?.data?.message || '登录失败';

      // 登录失败，自动展开密码框，方便用户检查或修改
      setShowPasswordField(true);

      if (msg.includes('账号') || msg.includes('不存在') || msg.includes('错误')) {
        const shouldRegister = await confirm({
          title: '登录失败',
          message: `${msg}\n\n建议检查手机号是否正确，或重新输入密码。如果尚未注册，可以前往注册。`,
          type: 'info',
          confirmText: '去注册',
          cancelText: '重试',
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

  const handleSendSmsCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return toast.warning('请输入正确的手机号');
    }
    if (smsCountdown > 0) return;

    try {
      setLoading(true);
      const res = await api.post('/auth/sms/send', { phone, purpose: 'login' });
      setSmsCountdown(60);
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

  const handleSmsLogin = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return toast.warning('请输入正确的手机号');
    }
    if (!/^\d{6}$/.test(smsCode)) {
      return toast.warning('请输入 6 位验证码');
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/sms/login', { phone, code: smsCode });
      goAfterLogin(res.data.token, res.data.user, phone);
    } catch (err: any) {
      toast.error(err.response?.data?.message || '验证码登录失败');
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = () => {
    setPhone('');
    setPassword('');
    setSmsCode('');
    setDevSmsCode('');
    setLoginMode('password');
    setShowFullForm(true);
    setShowPasswordField(true);
    setQuickLoginAvailable(false);
    clearQuickLogin();
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

          <form
            onSubmit={(e) => { e.preventDefault(); quickLoginAvailable && !showPasswordField ? handleQuickLogin() : handleLogin(); }}
            className="w-full max-w-sm bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-8 border border-blue-100 shadow-xl relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <div className="text-8xl rotate-12">🔑</div>
            </div>

            <div className="text-center mb-6 relative z-10">
              <div className="text-5xl mb-4">👋</div>
              <div className="text-gray-500 text-sm font-medium">欢迎回来</div>
              <div className="font-black text-2xl text-blue-900 mt-1 tracking-wider">{savedPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}</div>
            </div>

            {quickLoginAvailable && !showPasswordField ? (
              <div className="space-y-4 mb-6 relative z-10 text-center animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="rounded-2xl bg-white/80 border border-blue-100 px-4 py-3 text-xs font-bold text-blue-700 leading-relaxed">
                  这台设备已记住登录状态，可直接进入家庭选择页。
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordField(true)}
                  className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors"
                >
                  改用密码或验证码登录
                </button>
              </div>
            ) : showPasswordField ? (
              <div className="space-y-4 mb-6 relative z-10 animate-in fade-in slide-in-from-top-2 duration-300">
                <input
                  name="password"
                  autoComplete="current-password"
                  className="w-full p-4 bg-white rounded-2xl outline-none focus:ring-2 ring-blue-500 text-center shadow-sm border border-blue-50"
                  type="password"
                  placeholder="请输入登录密码"
                  autoFocus
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    className="text-[10px] text-gray-400 hover:text-blue-500 transition-colors"
                  >
                    忘记密码？
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginMode('sms');
                      setShowFullForm(true);
                    }}
                    className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors"
                  >
                    使用验证码登录
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center mb-6 relative z-10">
                 <button
                  type="button"
                  onClick={() => setShowPasswordField(true)}
                  className="text-xs text-blue-500 font-bold hover:text-blue-700 transition-colors bg-blue-100/50 px-3 py-1.5 rounded-full"
                >
                  修改密码或重新输入
                </button>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full h-14 text-lg bg-gradient-to-r from-blue-600 to-indigo-600 border-none shadow-lg shadow-blue-200 hover:scale-[1.02] active:scale-95 transition-all relative z-10" disabled={loading}>
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>登录中...</span>
                </div>
              ) : quickLoginAvailable && !showPasswordField ? '一键进入' : '登录并记住本机'}
            </Button>
          </form>

          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="flex items-center gap-4">
              <button onClick={switchAccount} className="text-gray-500 text-sm font-medium hover:text-blue-600 transition-colors">
                切换其他账号
              </button>
              <div className="w-px h-3 bg-gray-300"></div>
              <button onClick={() => navigate('/register')} className="text-blue-600 font-black text-sm hover:underline">
                注册新账号
              </button>
            </div>

            <button
              onClick={() => setShowIntro(true)}
              className="mt-4 px-5 py-2.5 bg-white text-gray-700 text-sm font-bold rounded-full border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center gap-2 group"
            >
              <span className="group-hover:scale-125 transition-transform">💡</span>
              了解系统功能
            </button>
          </div>
        </div>
        <ConfirmDialog />
        {showResetModal && <ResetPasswordModal onClose={() => setShowResetModal(false)} initialPhone={phone} />}
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

        <form
          onSubmit={(e) => { e.preventDefault(); loginMode === 'sms' ? handleSmsLogin() : handleLogin(); }}
          className="space-y-4 flex-1"
        >
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl">
            <button
              type="button"
              onClick={() => setLoginMode('password')}
              className={`h-10 rounded-xl text-sm font-bold transition-all ${loginMode === 'password' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
            >
              密码登录
            </button>
            <button
              type="button"
              onClick={() => setLoginMode('sms')}
              className={`h-10 rounded-xl text-sm font-bold transition-all ${loginMode === 'sms' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
            >
              验证码登录
            </button>
          </div>
          <input
            name="username"
            autoComplete="username"
            className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500"
            placeholder="家长手机号"
            value={phone}
            type="tel"
            onChange={e => setPhone(e.target.value)}
          />
          {loginMode === 'password' ? (
            <>
              <input
                name="password"
                autoComplete="current-password"
                className="w-full p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500"
                type="password"
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />

              <div className="flex items-center justify-end mb-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="text-xs text-blue-500 font-bold"
                >
                  忘记密码？
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  name="smsCode"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  className="min-w-0 flex-1 p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500"
                  placeholder="6 位验证码"
                  value={smsCode}
                  onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button
                  type="button"
                  onClick={handleSendSmsCode}
                  disabled={loading || smsCountdown > 0}
                  className="w-28 rounded-xl bg-blue-50 text-blue-600 text-xs font-black disabled:text-gray-400 disabled:bg-gray-100"
                >
                  {smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码'}
                </button>
              </div>
              {devSmsCode && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  开发测试验证码：{devSmsCode}
                </div>
              )}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? '登录中...' : loginMode === 'sms' ? '验证码登录' : '登录并开启一键进入'}
          </Button>
        </form>

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
      {showResetModal && <ResetPasswordModal onClose={() => setShowResetModal(false)} initialPhone={phone} />}
    </Layout>
  );
}
