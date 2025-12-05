import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// 家长角色选项
const PARENT_ROLES = [
  { value: 'dad', label: '爸爸', avatar: '👨' },
  { value: 'mom', label: '妈妈', avatar: '👩' },
  { value: 'grandpa', label: '爷爷', avatar: '👴' },
  { value: 'grandma', label: '奶奶', avatar: '👵' },
];

// 孩子性别选项
const CHILD_GENDERS = [
  { value: 'boy', label: '男孩', avatar: '👦' },
  { value: 'girl', label: '女孩', avatar: '👧' },
];

export default function CreateFamily() {
  const navigate = useNavigate();
  const { login } = useAuth();
  
  const [familyName, setFamilyName] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentRole, setParentRole] = useState('dad'); // 默认爸爸
  
  // 孩子信息（可选）
  const [childName, setChildName] = useState('');
  const [childGender, setChildGender] = useState('boy');
  const [childBirthdate, setChildBirthdate] = useState('');
  
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!familyName.trim()) return alert('请给家庭取个名字');
    if (!parentName.trim()) return alert('请告诉孩子怎么称呼您');

    try {
      setLoading(true);
      const res = await api.post('/auth/create-family', { 
        familyName, 
        parentName,
        parentRole,
        // 孩子信息可选
        childName: childName.trim() || null,
        childGender: childName.trim() ? childGender : null,
        childBirthdate: childName.trim() ? childBirthdate : null,
      });
      login(res.data.token);
      // 创建家庭后直接进入家长首页，那里有首次使用引导
      navigate('/parent');
    } catch (err: any) {
      alert(err.response?.data?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const selectedParentRole = PARENT_ROLES.find(r => r.value === parentRole);

  return (
    <Layout>
      <Header title="步骤 2/2" showBack />
      <div className="p-6 flex flex-col h-full overflow-y-auto">
        <h2 className="text-2xl font-bold mb-6 text-center">设置您的家庭</h2>
        <div className="space-y-5 flex-1">
          {/* 家庭名称 */}
          <div>
            <label className="font-bold text-gray-700 ml-1">给家庭取个名字</label>
            <input 
              className="w-full p-4 mt-2 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500 transition-all" 
              placeholder="例如：快乐星球的家"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
            />
          </div>

          {/* 家长信息 */}
          <div>
            <label className="font-bold text-gray-700 ml-1">您的身份</label>
            <div className="flex gap-2 mt-2">
              {PARENT_ROLES.map(role => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => setParentRole(role.value)}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${
                    parentRole === role.value 
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-200' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span className="text-lg mr-1">{role.avatar}</span>
                  {role.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-bold text-gray-700 ml-1">您的昵称</label>
            <input 
              className="w-full p-4 mt-2 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-blue-500 transition-all" 
              placeholder={`例如：${selectedParentRole?.label || '爸爸'}`}
              value={parentName}
              onChange={e => setParentName(e.target.value)}
            />
          </div>

          {/* 分隔线 */}
          <div className="border-t border-dashed border-gray-300 pt-4">
            <label className="font-bold text-gray-700 ml-1">添加孩子 <span className="text-gray-400 font-normal text-sm">(可选，稍后也可添加)</span></label>
          </div>

          {/* 孩子性别选择 */}
          <div className="flex gap-3">
            {CHILD_GENDERS.map(g => (
              <button
                key={g.value}
                type="button"
                onClick={() => setChildGender(g.value)}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                  childGender === g.value 
                    ? 'bg-green-500 text-white shadow-lg shadow-green-200' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className="text-xl mr-1">{g.avatar}</span>
                {g.label}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <input 
              className="flex-1 p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-green-500 transition-all" 
              placeholder="孩子昵称"
              value={childName}
              onChange={e => setChildName(e.target.value)}
            />
            <input 
              type="date"
              className="w-36 p-4 bg-gray-100 rounded-xl outline-none focus:ring-2 ring-green-500 transition-all text-gray-600"
              value={childBirthdate}
              onChange={e => setChildBirthdate(e.target.value)}
              placeholder="出生日期"
            />
          </div>

          <div className="bg-blue-50 p-4 rounded-xl text-blue-600 text-sm">
              💡 您稍后可以在"家庭管理"中添加更多孩子或邀请其他家长。
          </div>
        </div>
        <Button 
          onClick={handleCreate} 
          size="lg" 
          disabled={loading || !familyName.trim() || !parentName.trim()}
          className={(!familyName.trim() || !parentName.trim()) ? "bg-gray-300" : ""}
        >
          {loading ? '处理中...' : '完成并进入系统'}
        </Button>
      </div>
    </Layout>
  );
}
