import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Sparkles, Check } from 'lucide-react';
import api from '../../services/api';

// 预设任务模板
const TASK_TEMPLATES = [
  // 日常生活
  { title: '整理床铺', category: '劳动', coinReward: 10, xpReward: 10, duration: 5, icon: '🛏️' },
  { title: '刷牙洗脸', category: '劳动', coinReward: 5, xpReward: 5, duration: 5, icon: '🪥' },
  { title: '收拾玩具', category: '劳动', coinReward: 10, xpReward: 10, duration: 10, icon: '🧸' },
  { title: '整理书包', category: '劳动', coinReward: 10, xpReward: 10, duration: 5, icon: '🎒' },
  { title: '穿衣服', category: '劳动', coinReward: 5, xpReward: 5, duration: 5, icon: '👕' },
  
  // 学习任务
  { title: '完成作业', category: '学习', coinReward: 50, xpReward: 50, duration: 60, icon: '📚' },
  { title: '阅读30分钟', category: '学习', coinReward: 30, xpReward: 30, duration: 30, icon: '📖' },
  { title: '练习写字', category: '学习', coinReward: 20, xpReward: 20, duration: 20, icon: '✍️' },
  { title: '背诵古诗', category: '学习', coinReward: 25, xpReward: 25, duration: 15, icon: '📜' },
  { title: '英语单词', category: '学习', coinReward: 20, xpReward: 20, duration: 15, icon: '🔤' },
  
  // 家务劳动
  { title: '扫地拖地', category: '劳动', coinReward: 30, xpReward: 30, duration: 20, icon: '🧹' },
  { title: '洗碗', category: '劳动', coinReward: 25, xpReward: 25, duration: 15, icon: '🍽️' },
  { title: '倒垃圾', category: '劳动', coinReward: 10, xpReward: 10, duration: 5, icon: '🗑️' },
  { title: '浇花', category: '劳动', coinReward: 10, xpReward: 10, duration: 5, icon: '🌱' },
  { title: '喂宠物', category: '劳动', coinReward: 15, xpReward: 15, duration: 10, icon: '🐕' },
  
  // 运动健康
  { title: '跳绳100个', category: '运动', coinReward: 20, xpReward: 20, duration: 10, icon: '🏃' },
  { title: '户外运动30分钟', category: '运动', coinReward: 30, xpReward: 30, duration: 30, icon: '⚽' },
  { title: '做眼保健操', category: '运动', coinReward: 10, xpReward: 10, duration: 5, icon: '👀' },
  { title: '早起锻炼', category: '运动', coinReward: 25, xpReward: 25, duration: 20, icon: '🌅' },
  
  // 兴趣爱好
  { title: '练习钢琴', category: '兴趣', coinReward: 40, xpReward: 40, duration: 30, icon: '🎹' },
  { title: '画画', category: '兴趣', coinReward: 25, xpReward: 25, duration: 30, icon: '🎨' },
  { title: '练习乐器', category: '兴趣', coinReward: 35, xpReward: 35, duration: 30, icon: '🎸' },
  { title: '下棋', category: '兴趣', coinReward: 20, xpReward: 20, duration: 20, icon: '♟️' },
];

export default function ParentTasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);

  const [title, setTitle] = useState('');
  const [coinReward, setCoinReward] = useState('10');
  const [xpReward, setXpReward] = useState('10');
  const [duration, setDuration] = useState('15');
  const [category, setCategory] = useState('劳动');

  useEffect(() => { fetchTasks(); }, []);
  const fetchTasks = async () => { const res = await api.get('/parent/tasks'); setTasks(res.data); };

  const handleAdd = async () => {
    if (!title) return alert('请输入标题');
    await api.post('/parent/tasks', {
      title, coinReward: +coinReward, xpReward: +xpReward, durationMinutes: +duration, category, frequency: { type: 'daily' }
    });
    setShowAdd(false); setTitle('');
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除吗？')) return;
    await api.delete(`/parent/tasks/${id}`);
    fetchTasks();
  };

  // 切换模板选择
  const toggleTemplate = (index: number) => {
    setSelectedTemplates(prev => 
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  // 批量添加选中的模板
  const handleAddTemplates = async () => {
    if (selectedTemplates.length === 0) return alert('请至少选择一个任务模板');
    
    try {
      for (const index of selectedTemplates) {
        const template = TASK_TEMPLATES[index];
        await api.post('/parent/tasks', {
          title: template.title,
          coinReward: template.coinReward,
          xpReward: template.xpReward,
          durationMinutes: template.duration,
          category: template.category,
          frequency: { type: 'daily' }
        });
      }
      alert(`成功添加 ${selectedTemplates.length} 个任务！`);
      setShowTemplates(false);
      setSelectedTemplates([]);
      fetchTasks();
    } catch (e) {
      alert('添加失败');
    }
  };

  // 按类别分组模板
  const groupedTemplates = TASK_TEMPLATES.reduce((acc, template, index) => {
    if (!acc[template.category]) acc[template.category] = [];
    acc[template.category].push({ ...template, index });
    return acc;
  }, {} as Record<string, (typeof TASK_TEMPLATES[0] & { index: number })[]>);

  return (
    <Layout>
      <Header title="任务管理" showBack onBack={() => navigate('/parent/dashboard')} rightElem={<button onClick={() => setShowAdd(true)}><Plus className="text-blue-600"/></button>} />
      
      {showAdd && (
        <div className="p-4 bg-blue-50 border-b animate-in slide-in-from-top">
          <h3 className="font-bold mb-4">新建任务</h3>
          <div className="space-y-3">
            <div>
                <label className="text-xs text-gray-500 font-bold">任务标题</label>
                <input className="w-full p-2 rounded border" placeholder="例如：整理床铺" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            
            <div className="flex gap-2">
                <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">种类</label>
                    <select className="w-full p-2 rounded border bg-white" value={category} onChange={e => setCategory(e.target.value)}>
                        <option>劳动</option><option>学习</option><option>兴趣</option><option>运动</option>
                    </select>
                </div>
                <div className="w-20">
                    <label className="text-xs text-gray-500 font-bold">时长(分)</label>
                    <input className="w-full p-2 rounded border" type="number" value={duration} onChange={e => setDuration(e.target.value)} />
                </div>
            </div>

            <div className="flex gap-2">
                <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励金币</label>
                    <input className="w-full p-2 rounded border" type="number" value={coinReward} onChange={e => setCoinReward(e.target.value)} />
                </div>
                <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励经验</label>
                    <input className="w-full p-2 rounded border" type="number" value={xpReward} onChange={e => setXpReward(e.target.value)} />
                </div>
            </div>

            <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleAdd} className="flex-1">保存任务</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        {/* 空状态 - 显示模板入口 */}
        {tasks.length === 0 && !showAdd && !showTemplates && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">📋</div>
              <div className="text-gray-500 mb-4">还没有任务哦</div>
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => setShowTemplates(true)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all"
                >
                  <Sparkles size={18}/> 从模板快速添加
                </button>
                <button 
                  onClick={() => setShowAdd(true)}
                  className="text-blue-600 font-medium text-sm"
                >
                  或手动创建任务
                </button>
              </div>
            </div>
        )}

        {/* 模板选择界面 */}
        {showTemplates && (
          <div className="animate-in fade-in">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="text-purple-500" size={20}/> 选择任务模板
              </h3>
              <span className="text-sm text-gray-500">已选 {selectedTemplates.length} 个</span>
            </div>
            
            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-4">
                <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">{cat}</div>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map(template => {
                    const isSelected = selectedTemplates.includes(template.index);
                    return (
                      <button
                        key={template.index}
                        onClick={() => toggleTemplate(template.index)}
                        className={`p-3 rounded-xl text-left transition-all border-2 ${
                          isSelected 
                            ? 'border-purple-500 bg-purple-50' 
                            : 'border-gray-100 bg-white hover:border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-xl">{template.icon}</span>
                          {isSelected && <Check size={16} className="text-purple-500"/>}
                        </div>
                        <div className="font-bold text-sm mt-1 text-gray-800">{template.title}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          💰{template.coinReward} · ⏰{template.duration}分
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            
            <div className="flex gap-2 sticky bottom-0 bg-gray-50 py-3 -mx-4 px-4 border-t">
              <Button onClick={() => { setShowTemplates(false); setSelectedTemplates([]); }} variant="ghost" className="flex-1">
                取消
              </Button>
              <Button onClick={handleAddTemplates} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 border-none" disabled={selectedTemplates.length === 0}>
                添加 {selectedTemplates.length} 个任务
              </Button>
            </div>
          </div>
        )}

        {/* 已有任务列表 */}
        {tasks.length > 0 && !showTemplates && (
          <>
            {/* 快捷入口 */}
            <button 
              onClick={() => setShowTemplates(true)}
              className="w-full p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-center justify-center gap-2 text-purple-600 font-medium text-sm hover:from-purple-100 hover:to-pink-100 transition-all mb-2"
            >
              <Sparkles size={16}/> 从模板快速添加更多任务
            </button>
            
            {tasks.map(task => (
              <Card key={task.id} className="flex justify-between items-center">
                <div>
                  <div className="font-bold">{task.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {task.category} | 💰{task.coinReward} | ⭐{task.xpReward} | ⏰{task.durationMinutes}分
                  </div>
                </div>
                <button onClick={() => handleDelete(task.id)} className="text-red-400 hover:text-red-600"><Trash2 size={18}/></button>
              </Card>
            ))}
          </>
        )}
      </div>
    </Layout>
  );
}
