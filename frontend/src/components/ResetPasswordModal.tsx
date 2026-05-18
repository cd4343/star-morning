import React, { useState } from 'react';
import { Button } from './Button';
import api from '../services/api';
import { useToast } from './Toast';

interface ResetPasswordModalProps {
  onClose: () => void;
  initialPhone?: string;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ onClose, initialPhone = '' }) => {
  const [phone, setPhone] = useState(initialPhone);
  const [pin, setPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !pin || !newPassword) return toast.warning('请填写所有信息');
    
    try {
      setLoading(true);
      await api.post('/auth/reset-password', { phone, pin, newPassword });
      toast.success('密码重置成功，请使用新密码登录');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || '重置失败，请检查手机号和PIN码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl max-w-sm w-full p-8 shadow-2xl flex flex-col relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4">
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 transition-colors">✕</button>
        </div>

        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🔐</div>
          <h2 className="text-2xl font-black text-gray-800">重置密码</h2>
          <p className="text-xs text-gray-400 mt-2">请验证您的手机号和安全 PIN 码</p>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-gray-400 ml-1 mb-1 block uppercase">手机号</label>
            <input 
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 ring-blue-500"
              placeholder="请输入账号手机号"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 ml-1 mb-1 block uppercase">安全 PIN 码</label>
            <input 
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 ring-blue-500 text-center text-2xl tracking-[1em]"
              placeholder="••••"
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value)}
              type="password"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-400 ml-1 mb-1 block uppercase">新登录密码</label>
            <input 
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-2 ring-blue-500"
              placeholder="请输入 6 位以上新密码"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              type="password"
            />
          </div>

          <Button type="submit" size="lg" className="w-full h-14 mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 border-none shadow-lg" disabled={loading}>
            {loading ? '处理中...' : '确认重置'}
          </Button>
        </form>

        <p className="text-center text-[10px] text-gray-400 mt-6">
          如果您忘记了 PIN 码，请联系系统管理员手动重置
        </p>
      </div>
    </div>
  );
};
