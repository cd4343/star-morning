import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import api from '../../services/api';
import { getDateLocale } from '../../i18n';
import { AddEditChildModal, ConfirmModal } from '../../components/Modal';
import { Lock, Unlock, Edit2, Trash2, Users, ShieldCheck } from 'lucide-react';
import { useToast } from '../../components/Toast';
import CreateActionCard from '../../components/CreateActionCard';

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

export default function ParentFamily() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [pinError, setPinError] = useState('');

  // Edit Modal
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);

  // 清理：删除已废弃的家庭目标 state（全家任务已移至任务管理）
  const toast = useToast();

  const fetchData = async () => {
    setLoadingMembers(true);
    try {
        const membersRes = await api.get('/auth/members');
        if (Array.isArray(membersRes.data)) {
            setMembers(membersRes.data);
            const parent = membersRes.data.find((m: any) => m.role === 'parent');
            setHasPin(Boolean(parent?.hasPin));
        }
    } catch (e) {
        console.error('Failed to fetch members', e);
    } finally {
        setLoadingMembers(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
      toast.success('PIN 码设置成功');
      setNewPin('');
      setConfirmPin('');
      setHasPin(true);
    } catch (e: any) {
      toast.error(e.response?.data?.message || '设置失败');
    }
  };

  const handleDeleteMember = async () => {
      if (!deleteTarget) return;
      try {
          await api.delete(`/parent/family/members/${deleteTarget.id}`);
          setDeleteTarget(null);
          fetchData();
          toast.success('孩子成员已删除');
      } catch (e: any) {
          toast.error(e.response?.data?.message || '删除失败');
      }
  };

  const handleEditChild = async (data: { name: string, birthdate: string, gender: string }) => {
      if (!editTarget) return;
      try {
          await api.put(`/parent/family/members/${editTarget.id}`, { name: data.name, birthdate: data.birthdate, gender: data.gender });
          setEditTarget(null);
          fetchData();
          toast.success('孩子信息已更新');
      } catch (e: any) {
          toast.error(e.response?.data?.message || '修改失败');
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
      return new Date(birthdate).toLocaleDateString(getDateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const parentMembers = members.filter(m => m.role === 'parent');
  const childMembers = members.filter(m => m.role === 'child');

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
                <p className="font-bold mb-1">⚠️ 尚未设置 PIN 码</p>
                <p>设置后，孩子切换到家长模式时需要输入正确的安全 PIN。</p>
                <p className="mt-1">建议立即设置您的专属 PIN 码。</p>
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

        <CreateActionCard
          icon={<Users className="text-blue-600" size={24} />}
          title="家庭成员"
          description="家长负责设置规则与审核，孩子拥有自己的任务、奖励、宝箱和成长记录。"
          primaryLabel="添加或切换孩子"
          onPrimary={() => navigate('/select-user')}
          tone="from-blue-50 to-cyan-50 border-blue-100"
        >
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-2xl bg-white/80 p-3 text-center">
              <div className="text-lg font-black text-blue-700">{parentMembers.length}</div>
              <div className="text-[10px] font-bold text-gray-500">家长</div>
            </div>
            <div className="rounded-2xl bg-white/80 p-3 text-center">
              <div className="text-lg font-black text-emerald-700">{childMembers.length}</div>
              <div className="text-[10px] font-bold text-gray-500">孩子</div>
            </div>
            <div className="rounded-2xl bg-white/80 p-3 text-center">
              <div className="text-lg font-black text-indigo-700">{hasPin ? '已设' : '待设'}</div>
              <div className="text-[10px] font-bold text-gray-500">PIN</div>
            </div>
          </div>
        </CreateActionCard>

        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-gray-900">孩子成员</h3>
                    <p className="text-xs text-gray-500 mt-0.5">管理孩子资料，数据不会和家长账号混在一起。</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate('/select-user')} className="bg-white shadow-sm">
                    添加孩子
                </Button>
            </div>

            <div className="space-y-3">
                {loadingMembers ? (
                    <Card className="text-gray-400 text-sm text-center py-6">正在加载家庭成员...</Card>
                ) : childMembers.length > 0 ? childMembers.map(m => (
                    <Card key={m.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-4 min-w-0">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${getAvatarBgColor(m)}`}>
                                {getAvatarEmoji(m)}
                            </div>
                            <div className="min-w-0">
                                <div className="font-bold flex items-center gap-2 truncate">
                                    {m.name}
                                    {m.birthdate && (
                                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                            {getAge(m.birthdate)}岁
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 truncate">生日：{formatBirthdate(m.birthdate)}</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => setEditTarget(m)} className="p-2 bg-blue-50 text-blue-500 rounded-full hover:bg-blue-100" aria-label="编辑孩子信息">
                                <Edit2 size={16}/>
                            </button>
                            <button onClick={() => setDeleteTarget(m)} className="p-2 bg-red-50 text-red-500 rounded-full hover:bg-red-100" aria-label="删除孩子">
                                <Trash2 size={16}/>
                            </button>
                        </div>
                    </Card>
                )) : (
                    <Card className="text-center py-8 bg-white border-dashed">
                        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                            <Users className="text-blue-500" size={24} />
                        </div>
                        <div className="font-black text-gray-800">还没有添加孩子</div>
                        <div className="text-xs text-gray-500 mt-1 mb-4">添加后才能看到孩子的任务、奖励和成长数据。</div>
                        <Button size="sm" onClick={() => navigate('/select-user')}>去添加孩子</Button>
                    </Card>
                )}
            </div>

            {parentMembers.length > 0 && (
                <details className="rounded-2xl bg-white border border-gray-100 p-3">
                    <summary className="list-none cursor-pointer flex items-center justify-between">
                        <span className="font-bold text-sm text-gray-800 flex items-center gap-2">
                            <ShieldCheck size={16} className="text-blue-500" />
                            家长账号
                        </span>
                        <span className="text-xs text-gray-400">{parentMembers.length} 位</span>
                    </summary>
                    <div className="space-y-2 mt-3">
                        {parentMembers.map(m => (
                            <div key={m.id} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${getAvatarBgColor(m)}`}>
                                    {getAvatarEmoji(m)}
                                </div>
                                <div>
                                    <div className="font-bold text-sm text-gray-800">{m.name}</div>
                                    <div className="text-xs text-gray-500">管理员 · {m.hasPin ? '已设置 PIN' : '未设置 PIN'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>
            )}
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
