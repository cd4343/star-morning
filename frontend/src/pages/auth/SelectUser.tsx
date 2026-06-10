import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Settings } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { InputModal, ConfirmModal, AddEditChildModal } from '../../components/Modal';

import type { Member } from '../../types/member';

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

export default function SelectUser() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [manageMode, setManageMode] = useState(false);

  // Modals State
  const [showPinModal, setShowPinModal] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  
  const [showAddChildModal, setShowAddChildModal] = useState(false);
  
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);

  // 当前用户是否是家长
  const isParentRole = user?.role === 'parent';

  useEffect(() => { fetchMembers(); }, []);

  const fetchMembers = async () => {
    try {
      const res = await api.get('/auth/members');
      setMembers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCardClick = (member: Member) => {
      if (manageMode) return; // 管理模式下点击卡片无操作，除非点击删除按钮
      
      if (member.role === 'parent' && member.hasPin) {
          setSelectedParentId(member.id);
          setShowPinModal(true);
      } else {
          performLogin(member.id, member.role, null);
      }
  };

  const performLogin = async (memberId: string, _role: string, pin: string | null) => {
    try {
      const res = await api.post('/auth/switch-user', { targetUserId: memberId, pin });
      login(res.data.token, res.data.user);
      
      if (res.data.user.role === 'parent') {
        navigate('/parent/dashboard');
      } else {
        navigate('/child/challenge');
      }
    } catch (err: any) {
      alert(err.response?.data?.message || '切换失败');
    }
  };

  const handleAddChild = async (data: { name: string, birthdate: string, gender: string }) => {
      try {
          await api.post('/parent/family/members', { name: data.name, role: 'child', birthdate: data.birthdate, gender: data.gender });
          fetchMembers();
      } catch (e: any) {
          alert(e.response?.data?.message || '添加失败');
      }
  };

  const handleDeleteChild = async () => {
      if (!deleteTarget) return;
      try {
          await api.delete(`/parent/family/members/${deleteTarget.id}`);
          setDeleteTarget(null);
          fetchMembers();
      } catch (e: any) {
          alert(e.response?.data?.message || '删除失败');
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

  return (
    <Layout>
      <div className="p-8 flex flex-col items-center h-full justify-center relative">
        {/* 管理按钮 - 仅家长可见 */}
        {isParentRole && (
            <div className="absolute top-4 right-4">
                <button onClick={() => setManageMode(!manageMode)} className={`flex items-center gap-1 text-sm font-bold px-3 py-1.5 rounded-full transition-all ${manageMode ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                    <Settings size={16} /> {manageMode ? '完成管理' : '管理家庭'}
                </button>
            </div>
        )}

        <h1 className="text-2xl font-bold mb-8">请选择使用者</h1>
        
        {loading ? (
          <div>Loading...</div>
        ) : (
          <div className="w-full space-y-4">
            {members.map(member => (
              <div key={member.id} className="relative group">
                  <Card 
                    onClick={() => handleCardClick(member)} 
                    className={`flex items-center gap-4 p-6 border-2 transition-all cursor-pointer active:scale-95 ${member.role === 'parent' ? 'hover:border-blue-500' : 'hover:border-green-500'} ${manageMode ? 'opacity-90' : ''}`}
                  >
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl ${getAvatarBgColor(member)}`}>
                      {getAvatarEmoji(member)}
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-lg">{member.name}</div>
                      <div className="text-gray-500 text-sm flex items-center gap-2">
                        {member.role === 'parent' ? (
                            <span className="flex items-center gap-1">
                                家长端 <span className="text-red-500 font-bold text-xs border border-red-200 bg-red-50 px-1 rounded">(管理)</span>
                            </span>
                        ) : (
                            <span className="flex items-center gap-1">
                                孩子端
                                {member.birthdate && (
                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full ml-1">
                                        {getAge(member.birthdate)}岁
                                    </span>
                                )}
                            </span>
                        )}
                        {member.role === 'parent' && member.hasPin && <span className="text-[10px] bg-gray-200 px-1 rounded text-gray-600">🔒 PIN</span>}
                      </div>
                      {member.role === 'parent' && (member.pendingReviewCount || 0) > 0 && (
                        <div className="mt-1.5">
                          <span className="inline-block text-xs bg-red-100 px-2 py-0.5 rounded-full text-red-600 font-bold">
                            📋 {member.pendingReviewCount} 个任务等你审核
                          </span>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* 删除按钮 (仅管理模式且仅针对孩子) */}
                  {manageMode && member.role === 'child' && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(member); }}
                        className="absolute -top-2 -right-2 bg-red-500 text-white p-2 rounded-full shadow-lg animate-in zoom-in duration-200 hover:bg-red-600"
                      >
                          <Trash2 size={16} />
                      </button>
                  )}
              </div>
            ))}
            
            {/* 添加孩子按钮 - 仅家长可见 */}
            {isParentRole && (
                <button onClick={() => setShowAddChildModal(true)} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-2xl text-gray-400 font-bold flex items-center justify-center gap-2 hover:border-gray-400 hover:text-gray-500 hover:bg-gray-50 transition-all active:scale-95">
                  <Plus size={24}/> 添加孩子
                </button>
            )}
          </div>
        )}
        
        <button onClick={() => { 
            // 只清除认证相关的数据，保留用户偏好（如 last_phone）
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            navigate('/login'); 
        }} className="absolute bottom-8 text-red-400 text-sm hover:text-red-600 underline">
            退出登录
        </button>

        {/* Modals */}
        <InputModal 
            isOpen={showPinModal} 
            onClose={() => { setShowPinModal(false); setSelectedParentId(null); }}
            onConfirm={(pin) => performLogin(selectedParentId!, 'parent', pin)}
            title="请输入家长 PIN 码"
            type="password"
            placeholder="****"
        />

        <AddEditChildModal 
            isOpen={showAddChildModal} 
            onClose={() => setShowAddChildModal(false)}
            onConfirm={handleAddChild}
            title="添加新孩子"
        />

        <ConfirmModal 
            isOpen={!!deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={handleDeleteChild}
            title="确认删除"
            content={`确定要删除 "${deleteTarget?.name}" 吗？删除后所有任务、金币和数据都将无法恢复。`}
            isDanger
            confirmText="确认删除"
        />
      </div>
    </Layout>
  );
}
