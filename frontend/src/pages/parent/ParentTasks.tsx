import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Sparkles, Check, Pen, X } from 'lucide-react';
import api from '../../services/api';
import { useTemplateSelector } from '../../hooks/useTemplateSelector';
import { IconPicker } from '../../components/IconPicker';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';

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
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const { showTemplates, selectedIndexes, selectedCount, toggleTemplate, isSelected, openTemplates, closeTemplates } = useTemplateSelector();

  const [title, setTitle] = useState('');
  const [coinReward, setCoinReward] = useState('10');
  const [xpReward, setXpReward] = useState('10');
  const [duration, setDuration] = useState('15');
  const [category, setCategory] = useState('劳动');
  const [icon, setIcon] = useState('📋');
  
  // 编辑状态
  const [editingTask, setEditingTask] = useState<any>(null);

  useEffect(() => { fetchTasks(); }, []);
  const fetchTasks = async () => { const res = await api.get('/parent/tasks'); setTasks(res.data); };
  
  // 打开编辑
  const openEdit = (task: any) => {
    setEditingTask(task);
    setTitle(task.title);
    setCoinReward(String(task.coinReward));
    setXpReward(String(task.xpReward));
    setDuration(String(task.durationMinutes));
    setCategory(task.category);
    setIcon(task.icon || '📋');
  };
  
  // 取消编辑
  const cancelEdit = () => {
    setEditingTask(null);
    setTitle('');
    setCoinReward('10');
    setXpReward('10');
    setDuration('15');
    setCategory('劳动');
  };
  
  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingTask) return;
    try {
      await api.put(`/parent/tasks/${editingTask.id}`, {
        title, coinReward: +coinReward, xpReward: +xpReward, durationMinutes: +duration, category, icon
      });
      cancelEdit();
      fetchTasks();
    } catch {
      toast.error('保存失败');
    }
  };

  const handleAdd = async () => {
    if (!title) return toast.warning('请输入标题');
    await api.post('/parent/tasks', {
      title, coinReward: +coinReward, xpReward: +xpReward, durationMinutes: +duration, category, icon, frequency: { type: 'daily' }
    });
    setShowAdd(false); setTitle(''); setIcon('📋');
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除任务',
      message: '确定删除这个任务吗？已完成的任务记录会被保留，统计数据不受影响。',
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    try {
      const res = await api.delete(`/parent/tasks/${id}`);
      const data = res.data as { message: string; preservedRecords?: number; note?: string };
      if (data.note) toast.info(data.note);
      toast.success('删除成功');
      fetchTasks();
    } catch {
      toast.error('删除失败，请重试');
    }
  };

  const handleAddTemplates = async () => {
    if (selectedCount === 0) return toast.warning('请至少选择一个任务模板');
    
    try {
      for (const index of selectedIndexes) {
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
      toast.success(`成功添加 ${selectedCount} 个任务！`);
      closeTemplates();
      fetchTasks();
    } catch {
      toast.error('添加失败');
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
            <div className="flex gap-2">
              <div>
                <label className="text-xs text-gray-500 font-bold">图标</label>
                <IconPicker value={icon} onChange={setIcon} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-bold">任务标题</label>
                <input className="w-full p-2 rounded border" placeholder="例如：整理床铺" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
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
        {/* 空状态 */}
        {tasks.length === 0 && !showAdd && !showTemplates && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">📋</div>
            <div className="text-gray-500 mb-4">还没有任务哦</div>
            <div className="flex flex-col gap-2">
              <button onClick={openTemplates} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all">
                <Sparkles size={18}/> 从模板快速添加
              </button>
              <button onClick={() => setShowAdd(true)} className="text-blue-600 font-medium text-sm">
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
              <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
            </div>
            
            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-4">
                <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">{cat}</div>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map(template => (
                    <button
                      key={template.index}
                      onClick={() => toggleTemplate(template.index)}
                      className={`p-3 rounded-xl text-left transition-all border-2 ${
                        isSelected(template.index) 
                          ? 'border-purple-500 bg-purple-50' 
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-xl">{template.icon}</span>
                        {isSelected(template.index) && <Check size={16} className="text-purple-500"/>}
                      </div>
                      <div className="font-bold text-sm mt-1 text-gray-800">{template.title}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        💰{template.coinReward} · ⏰{template.duration}分
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            
            <div className="flex gap-2 sticky bottom-0 bg-gray-50 py-3 -mx-4 px-4 border-t">
              <Button onClick={closeTemplates} variant="ghost" className="flex-1">取消</Button>
              <Button onClick={handleAddTemplates} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 border-none" disabled={selectedCount === 0}>
                添加 {selectedCount} 个任务
              </Button>
            </div>
          </div>
        )}

        {/* 已有任务列表 */}
        {tasks.length > 0 && !showTemplates && (
          <>
            <button onClick={openTemplates} className="w-full p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-center justify-center gap-2 text-purple-600 font-medium text-sm hover:from-purple-100 hover:to-pink-100 transition-all mb-2">
              <Sparkles size={16}/> 从模板快速添加更多任务
            </button>
            
            {tasks.map(task => (
              <Card key={task.id} className="flex justify-between items-center">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl">
                    {task.icon || '📋'}
                  </div>
                  <div>
                    <div className="font-bold">{task.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {task.category} | 💰{task.coinReward} | ⭐{task.xpReward} | ⏰{task.durationMinutes}分
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(task)} className="text-blue-400 hover:text-blue-600 p-1"><Pen size={16}/></button>
                  <button onClick={() => handleDelete(task.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
                </div>
              </Card>
            ))}
          </>
        )}
        
        {/* 编辑任务弹窗 */}
        {editingTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
              <div className="flex justify-between items-center p-4 border-b">
                <h3 className="font-bold text-lg">编辑任务</h3>
                <button onClick={cancelEdit} className="p-1 hover:bg-gray-100 rounded-full">
                  <X size={20} className="text-gray-500"/>
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <div>
                    <label className="text-xs text-gray-500 font-bold">图标</label>
                    <IconPicker value={icon} onChange={setIcon} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">任务标题</label>
                    <input className="w-full p-2 rounded border mt-1" value={title} onChange={e => setTitle(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">种类</label>
                    <select className="w-full p-2 rounded border bg-white mt-1" value={category} onChange={e => setCategory(e.target.value)}>
                      <option>劳动</option><option>学习</option><option>兴趣</option><option>运动</option>
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-gray-500 font-bold">时长(分)</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={duration} onChange={e => setDuration(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励金币</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={coinReward} onChange={e => setCoinReward(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-bold">奖励经验</label>
                    <input className="w-full p-2 rounded border mt-1" type="number" value={xpReward} onChange={e => setXpReward(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={handleSaveEdit} className="flex-1">保存修改</Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>取消</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
