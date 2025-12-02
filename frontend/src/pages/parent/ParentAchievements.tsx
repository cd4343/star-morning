import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';

// 预设成就图标
const ACHIEVEMENT_ICONS = [
    { icon: '🌱', name: '新芽' },
    { icon: '🐝', name: '蜜蜂' },
    { icon: '🏆', name: '奖杯' },
    { icon: '👑', name: '皇冠' },
    { icon: '🔥', name: '火焰' },
    { icon: '💪', name: '力量' },
    { icon: '🐷', name: '小猪' },
    { icon: '💰', name: '金币' },
    { icon: '🏦', name: '银行' },
    { icon: '⭐', name: '星星' },
    { icon: '🧹', name: '扫帚' },
    { icon: '🏃', name: '跑步' },
    { icon: '⏰', name: '时钟' },
    { icon: '🎯', name: '靶心' },
    { icon: '🍀', name: '幸运草' },
    { icon: '🦁', name: '狮子' },
    { icon: '🦋', name: '蝴蝶' },
    { icon: '🌈', name: '彩虹' },
    { icon: '🎖️', name: '勋章' },
    { icon: '🥇', name: '金牌' },
];

// 预设成就模板
const ACHIEVEMENT_TEMPLATES = [
    { title: '初来乍到', desc: '完成第1个任务', icon: '🌱', type: 'task_count', value: 1 },
    { title: '小小勤劳者', desc: '完成10个任务', icon: '🐝', type: 'task_count', value: 10 },
    { title: '任务达人', desc: '完成50个任务', icon: '🏆', type: 'task_count', value: 50 },
    { title: '任务大师', desc: '完成100个任务', icon: '👑', type: 'task_count', value: 100 },
    { title: '小小存钱罐', desc: '累计获得100金币', icon: '🐷', type: 'coin_count', value: 100 },
    { title: '财富小能手', desc: '累计获得500金币', icon: '💰', type: 'coin_count', value: 500 },
    { title: '金币大亨', desc: '累计获得1000金币', icon: '🏦', type: 'coin_count', value: 1000 },
    { title: '学习之星', desc: '在学习上表现出色', icon: '⭐', type: 'manual', value: 0 },
    { title: '劳动小蜜蜂', desc: '热爱劳动的好孩子', icon: '🧹', type: 'manual', value: 0 },
    { title: '运动健将', desc: '坚持运动锻炼身体', icon: '🏃', type: 'manual', value: 0 },
];

export default function ParentAchievements() {
  const navigate = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [icon, setIcon] = useState('🏆');
  const [conditionType, setConditionType] = useState('task_count');
  const [conditionValue, setConditionValue] = useState('');

  useEffect(() => { fetchList(); }, []);
  const fetchList = async () => { const res = await api.get('/parent/achievements'); setList(res.data); };

  const handleAdd = async () => {
    if (!title) return alert('请输入标题');
    await api.post('/parent/achievements', { 
        title, 
        description: desc, 
        icon, 
        conditionType, 
        conditionValue: +conditionValue 
    });
    setShowAdd(false); 
    resetForm();
    fetchList();
  };

  const resetForm = () => {
    setTitle('');
    setDesc('');
    setIcon('🏆');
    setConditionType('task_count');
    setConditionValue('');
  };

  const handleDelete = async (id: string) => {
      if (!window.confirm('确定删除吗？')) return;
      await api.delete(`/parent/achievements/${id}`);
      fetchList();
  };

  const applyTemplate = (tpl: typeof ACHIEVEMENT_TEMPLATES[0]) => {
      setTitle(tpl.title);
      setDesc(tpl.desc);
      setIcon(tpl.icon);
      setConditionType(tpl.type);
      setConditionValue(tpl.value.toString());
      setShowTemplates(false);
  };

  return (
    <Layout>
      <Header title="成就管理" showBack onBack={() => navigate('/parent/dashboard')} rightElem={<button onClick={() => setShowAdd(true)}><Plus className="text-blue-600"/></button>} />
      
      {showAdd && (
        <div className="p-4 bg-gradient-to-b from-yellow-50 to-orange-50 border-b animate-in slide-in-from-top">
          <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold">新建成就</h3>
              <button 
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold"
              >
                  {showTemplates ? '关闭模板' : '📋 使用模板'}
              </button>
          </div>

          {/* 模板选择 */}
          {showTemplates && (
              <div className="mb-4 p-3 bg-white rounded-xl border max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2">
                      {ACHIEVEMENT_TEMPLATES.map((tpl, i) => (
                          <button 
                              key={i}
                              onClick={() => applyTemplate(tpl)}
                              className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-blue-50 text-left transition-colors"
                          >
                              <span className="text-xl">{tpl.icon}</span>
                              <div className="flex-1 min-w-0">
                                  <div className="text-xs font-bold truncate">{tpl.title}</div>
                                  <div className="text-[10px] text-gray-400 truncate">{tpl.desc}</div>
                              </div>
                          </button>
                      ))}
                  </div>
              </div>
          )}

          <div className="space-y-3">
              <div className="flex gap-2">
                 <div className="relative">
                     <label className="text-xs text-gray-500 font-bold">图标</label>
                     <button 
                         onClick={() => setShowIconPicker(!showIconPicker)}
                         className="w-14 h-10 rounded border bg-white text-2xl flex items-center justify-center hover:bg-gray-50"
                     >
                         {icon}
                     </button>
                     
                     {/* 图标选择器 */}
                     {showIconPicker && (
                         <div className="absolute top-full left-0 mt-1 p-2 bg-white rounded-xl shadow-xl border z-50 w-64">
                             <div className="grid grid-cols-5 gap-1">
                                 {ACHIEVEMENT_ICONS.map((item, i) => (
                                     <button 
                                         key={i}
                                         onClick={() => { setIcon(item.icon); setShowIconPicker(false); }}
                                         className={`w-10 h-10 rounded-lg text-xl hover:bg-yellow-100 transition-colors ${icon === item.icon ? 'bg-yellow-200 ring-2 ring-yellow-400' : ''}`}
                                         title={item.name}
                                     >
                                         {item.icon}
                                     </button>
                                 ))}
                             </div>
                         </div>
                     )}
                 </div>
                 <div className="flex-1">
                     <label className="text-xs text-gray-500 font-bold">成就名称</label>
                     <input className="w-full p-2 rounded-lg border" placeholder="例如：运动健将" value={title} onChange={e => setTitle(e.target.value)} />
                 </div>
              </div>
              
              <div>
                  <label className="text-xs text-gray-500 font-bold">描述 (孩子看到的鼓励语)</label>
                  <input className="w-full p-2 rounded-lg border" placeholder="例如：坚持运动锻炼身体" value={desc} onChange={e => setDesc(e.target.value)} />
              </div>
              
              <div className="flex gap-2">
                  <div className="flex-1">
                      <label className="text-xs text-gray-500 font-bold">解锁条件</label>
                      <select className="w-full p-2 rounded-lg border bg-white" value={conditionType} onChange={e => setConditionType(e.target.value)}>
                          <option value="task_count">累计完成任务数</option>
                          <option value="coin_count">累计获得金币数</option>
                          <option value="manual">仅手动颁发</option>
                      </select>
                  </div>
                  {conditionType !== 'manual' && (
                      <div className="w-24">
                          <label className="text-xs text-gray-500 font-bold">目标值</label>
                          <input className="w-full p-2 rounded-lg border" type="number" placeholder="10" value={conditionValue} onChange={e => setConditionValue(e.target.value)} />
                      </div>
                  )}
              </div>

              <div className="flex gap-2 pt-2">
                 <Button size="sm" onClick={handleAdd} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 border-none">保存成就</Button>
                 <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }}>取消</Button>
              </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        {list.length === 0 && !showAdd && (
            <div className="text-center py-8">
                <div className="text-5xl mb-3">🏆</div>
                <div className="text-gray-400 mb-4">暂无成就，点击右上角 + 添加</div>
                <Button size="sm" onClick={() => { setShowAdd(true); setShowTemplates(true); }}>
                    使用模板快速创建
                </Button>
            </div>
        )}
        {list.map(item => (
          <Card key={item.id} className="flex justify-between items-center hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-xl flex items-center justify-center text-2xl shadow-sm">
                  {item.icon}
              </div>
              <div>
                <div className="font-bold text-gray-800">{item.title}</div>
                <div className="text-xs text-gray-500">{item.description}</div>
                <div className="text-[10px] text-blue-600 mt-1 bg-blue-50 inline-block px-2 py-0.5 rounded-full font-medium">
                    {item.conditionType === 'manual' ? '🎁 手动颁发' : 
                     item.conditionType === 'task_count' ? `📋 完成 ${item.conditionValue} 个任务` :
                     `💰 获得 ${item.conditionValue} 金币`
                    }
                </div>
              </div>
            </div>
            <button onClick={() => handleDelete(item.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={18}/>
            </button>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
