import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Trash2, Lock, Unlock, Edit2 } from 'lucide-react';
import api from '../../services/api';
import { AddEditChildModal, ConfirmModal } from '../../components/Modal';

interface Member {
    id: string;
    name: string;
    role: 'parent' | 'child';
    birthdate?: string;
    pin?: string;
    gender?: string; // boy, girl, dad, mom, grandpa, grandma
}

// 根据角色和性别获取头像 emoji
const getAvatarEmoji = (member: Member): string => {
  if (member.role === 'parent') {
    switch (member.gender) {
      case 'mom': return '👩';
      case 'grandpa': return '👴';
      case 'grandma': return '👵';
      case 'dad':
      default: return '👨';
    }
  } else {
    // child
    return member.gender === 'girl' ? '👧' : '👦';
  }
};

// 根据角色和性别获取背景色
const getAvatarBgColor = (member: Member): string => {
  if (member.role === 'parent') {
    return 'bg-blue-100';
  }
  return member.gender === 'girl' ? 'bg-pink-100' : 'bg-green-100';
};

export default function ParentFamily() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [pinError, setPinError] = useState('');

  // Edit Modal
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
        const res = await api.get('/auth/members');
        if (Array.isArray(res.data)) {
            setMembers(res.data);
            const parent = res.data.find((m: any) => m.role === 'parent');
            if (parent?.pin) setHasPin(true);
        }
    } catch (e) {
        console.error("Failed to fetch members", e);
    }
  };

  const handleSetPin = async () => {
    setPinError('');
    
    // 验证新PIN码格式
    if (!/^\d{4,6}$/.test(newPin)) {
      setPinError('PIN 必须是 4-6 位数字');
      return;
    }
    
    // 验证确认PIN码
    if (newPin !== confirmPin) {
      setPinError('两次输入的 PIN 码不一致');
      return;
    }
    
    try {
      await api.post('/parent/set-pin', { pin: newPin });
      alert('PIN 码设置成功！');
      setNewPin('');
      setConfirmPin('');
      setHasPin(true);
    } catch (e: any) {
      alert(e.response?.data?.message || '设置失败');
    }
  };

  const handleDeleteMember = async () => {
      if (!deleteTarget) return;
      try {
          await api.delete(`/parent/family/members/${deleteTarget.id}`);
          setDeleteTarget(null);
          fetchData();
      } catch (e: any) {
          alert(e.response?.data?.message || '删除失败');
      }
  };

  const handleEditChild = async (data: { name: string, birthdate: string, gender: string }) => {
      if (!editTarget) return;
      try {
          await api.put(`/parent/family/members/${editTarget.id}`, { name: data.name, birthdate: data.birthdate, gender: data.gender });
          setEditTarget(null);
          fetchData();
      } catch (e: any) {
          alert(e.response?.data?.message || '修改失败');
      }
  };

  // 计算孩子年龄
  const getAge = (birthdate?: string) => {
      if (!birthdate) return null;
      const birth = new Date(birthdate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      return age;
  };

  const formatBirthdate = (birthdate?: string) => {
      if (!birthdate) return '未设置';
      return new Date(birthdate).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <Layout>
      <Header title="家庭管理" showBack onBack={() => navigate('/parent/dashboard')} />
      
      <div className="p-4 space-y-6 overflow-y-auto flex-1">
        {/* PIN 设置 */}
        <Card className={hasPin ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}>
          <h3 className="font-bold mb-2 flex items-center gap-2">
              {hasPin ? <Lock className="text-green-600" size={20}/> : <Unlock className="text-orange-600" size={20}/>}
              家长 PIN 码设置
          </h3>
          
          {/* 当前状态提示 */}
          <div className={`p-3 rounded-lg mb-4 ${hasPin ? 'bg-green-100' : 'bg-yellow-100'}`}>
            {hasPin ? (
              <p className="text-sm text-green-800">
                ✅ 已设置自定义 PIN 码，孩子需要输入正确的 PIN 才能切换到家长模式。
              </p>
            ) : (
              <div className="text-sm text-yellow-800">
                <p className="font-bold mb-1">⚠️ 当前使用默认 PIN 码</p>
                <p>默认 PIN 码是 <span className="font-mono font-bold bg-yellow-200 px-2 py-0.5 rounded">1234</span>，孩子可能已经知道。</p>
                <p className="mt-1">建议立即修改为您的专属 PIN 码。</p>
              </div>
            )}
          </div>
          
          {/* PIN 输入表单 */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 font-bold mb-1 block">
                {hasPin ? '输入新 PIN 码' : '设置新 PIN 码'}
              </label>
              <input 
                className="w-full p-3 bg-white rounded-xl outline-none border focus:ring-2 ring-blue-500" 
                placeholder="输入 4-6 位数字"
                type="tel"
                maxLength={6}
                value={newPin}
                onChange={e => { setNewPin(e.target.value); setPinError(''); }}
              />
            </div>
            
            <div>
              <label className="text-xs text-gray-500 font-bold mb-1 block">确认新 PIN 码</label>
              <input 
                className="w-full p-3 bg-white rounded-xl outline-none border focus:ring-2 ring-blue-500" 
                placeholder="再次输入以确认"
                type="tel"
                maxLength={6}
                value={confirmPin}
                onChange={e => { setConfirmPin(e.target.value); setPinError(''); }}
              />
            </div>
            
            {/* 错误提示 */}
            {pinError && (
              <p className="text-red-500 text-sm font-medium">{pinError}</p>
            )}
            
            <Button 
              onClick={handleSetPin} 
              size="md" 
              className="w-full"
              disabled={!newPin || !confirmPin}
            >
              {hasPin ? "修改 PIN 码" : "设置 PIN 码"}
            </Button>
          </div>
        </Card>

        {/* 成员列表 */}
        <div>
            <h3 className="font-bold mb-3">家庭成员</h3>
            <div className="space-y-3">
                {members && members.length > 0 ? members.map(m => (
                    <Card key={m.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${getAvatarBgColor(m)}`}>
                                {getAvatarEmoji(m)}
                            </div>
                            <div>
                                <div className="font-bold flex items-center gap-2">
                                    {m.name}
                                    {m.role === 'child' && m.birthdate && (
                                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                                            {getAge(m.birthdate)}岁
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500">
                                    {m.role==='parent' ? '管理员' : (
                                        <>孩子 · 生日: {formatBirthdate(m.birthdate)}</>
                                    )}
                                </div>
                            </div>
                        </div>
                        {m.role === 'child' && (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setEditTarget(m)} className="p-2 bg-blue-50 text-blue-500 rounded-full hover:bg-blue-100">
                                    <Edit2 size={16}/>
                                </button>
                                <button onClick={() => setDeleteTarget(m)} className="p-2 bg-red-50 text-red-500 rounded-full hover:bg-red-100">
                                    <Trash2 size={16}/>
                                </button>
                            </div>
                        )}
                    </Card>
                )) : (
                    <div className="text-gray-400 text-sm text-center">加载中...</div>
                )}
            </div>
            
            {/* 添加成员入口 */}
            <div className="mt-4 text-center">
                <p className="text-xs text-gray-400">如需添加孩子，请在【选择用户】页面操作</p>
            </div>
        </div>
      </div>

      {/* Edit Child Modal */}
      <AddEditChildModal 
          isOpen={!!editTarget}
          onClose={() => setEditTarget(null)}
          onConfirm={handleEditChild}
          title={`编辑 ${editTarget?.name || ''} 的信息`}
          initialData={editTarget ? { name: editTarget.name, birthdate: editTarget.birthdate || '', gender: editTarget.gender } : undefined}
      />

      {/* Delete Confirm Modal */}
      <ConfirmModal 
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteMember}
          title="确认删除"
          content={`确定要删除 "${deleteTarget?.name}" 吗？删除后所有任务、金币和数据都将无法恢复。`}
          isDanger
          confirmText="确认删除"
      />
    </Layout>
  );
}
