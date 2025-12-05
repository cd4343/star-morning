import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Sparkles, Check } from 'lucide-react';
import api from '../../services/api';
import { useTemplateSelector } from '../../hooks/useTemplateSelector';

// 特权模板 - 以服务性商品为主
const PRIVILEGE_TEMPLATES = [
  // 时间类特权
  { title: '晚睡30分钟', desc: '周末可以晚睡30分钟', cost: 3, icon: '🌙', category: '时间' },
  { title: '晚睡1小时', desc: '周末可以晚睡1小时', cost: 5, icon: '🌙', category: '时间' },
  { title: '多玩30分钟', desc: '额外获得30分钟游戏/娱乐时间', cost: 5, icon: '🎮', category: '时间' },
  { title: '免早起一次', desc: '周末可以睡懒觉一次', cost: 8, icon: '😴', category: '时间' },
  // 家务免除类
  { title: '免做家务一次', desc: '可以免除一次家务任务', cost: 5, icon: '🧹', category: '家务' },
  { title: '免洗碗一次', desc: '免除一次洗碗任务', cost: 3, icon: '🍽️', category: '家务' },
  { title: '免整理房间', desc: '免除一次整理房间任务', cost: 4, icon: '🛏️', category: '家务' },
  { title: '免倒垃圾一周', desc: '一周内免除倒垃圾任务', cost: 10, icon: '🗑️', category: '家务' },
  // 娱乐类特权
  { title: '看电视30分钟', desc: '额外看电视30分钟', cost: 3, icon: '📺', category: '娱乐' },
  { title: '看电影一部', desc: '可以看一部喜欢的电影', cost: 8, icon: '🎬', category: '娱乐' },
  { title: '玩手机30分钟', desc: '额外玩手机30分钟', cost: 5, icon: '📱', category: '娱乐' },
  { title: '玩游戏1小时', desc: '额外玩游戏1小时', cost: 10, icon: '🕹️', category: '娱乐' },
  // 外出类特权
  { title: '去公园玩', desc: '周末去公园玩一次', cost: 5, icon: '🏞️', category: '外出' },
  { title: '去游乐场', desc: '去游乐场玩一次', cost: 15, icon: '🎢', category: '外出' },
  { title: '和朋友玩', desc: '可以约朋友来家里或出去玩', cost: 5, icon: '👫', category: '外出' },
  { title: '外出吃饭', desc: '可以选择去哪里吃饭', cost: 10, icon: '🍔', category: '外出' },
  // 特殊奖励
  { title: '选择晚餐', desc: '今天晚餐由你决定吃什么', cost: 3, icon: '🍕', category: '特殊' },
  { title: '买小玩具', desc: '可以买一个小玩具（50元内）', cost: 20, icon: '🧸', category: '特殊' },
  { title: '免作业检查', desc: '作业完成后免检查一次', cost: 8, icon: '📝', category: '特殊' },
  { title: '亲子活动', desc: '和爸妈一起做喜欢的事', cost: 5, icon: '👨‍👩‍👧', category: '特殊' },
];

export default function ParentPrivileges() {
  const navigate = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const { showTemplates, selectedIndexes, selectedCount, toggleTemplate, isSelected, openTemplates, closeTemplates } = useTemplateSelector();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');

  useEffect(() => { fetchList(); }, []);
  const fetchList = async () => { const res = await api.get('/parent/privileges'); setList(res.data); };

  const handleAdd = async () => {
    if (!title) return alert('请输入标题');
    await api.post('/parent/privileges', { title, description: desc, cost: +cost });
    setShowAdd(false); setTitle('');
    fetchList();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除吗？')) return;
    await api.delete(`/parent/privileges/${id}`);
    fetchList();
  };

  const handleAddTemplates = async () => {
    if (selectedCount === 0) return alert('请至少选择一个特权模板');
    
    try {
      for (const index of selectedIndexes) {
        const template = PRIVILEGE_TEMPLATES[index];
        await api.post('/parent/privileges', {
          title: template.title,
          description: template.desc,
          cost: template.cost
        });
      }
      alert(`成功添加 ${selectedCount} 个特权！`);
      closeTemplates();
      fetchList();
    } catch {
      alert('添加失败');
    }
  };

  // 按类别分组模板
  const groupedTemplates = PRIVILEGE_TEMPLATES.reduce((acc, template, index) => {
    if (!acc[template.category]) acc[template.category] = [];
    acc[template.category].push({ ...template, index });
    return acc;
  }, {} as Record<string, (typeof PRIVILEGE_TEMPLATES[0] & { index: number })[]>);

  return (
    <Layout>
      <Header title="特权管理" showBack onBack={() => navigate('/parent/dashboard')} rightElem={<button onClick={() => setShowAdd(true)}><Plus className="text-blue-600"/></button>} />
      
      {showAdd && (
        <div className="p-4 bg-purple-50 border-b animate-in slide-in-from-top">
          <h3 className="font-bold mb-2">新建特权</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 font-bold">特权名称</label>
              <input className="w-full p-2 rounded border" placeholder="例如：周末晚睡一小时" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-bold">描述</label>
              <input className="w-full p-2 rounded border" placeholder="简短描述" value={desc} onChange={e => setDesc(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-bold">兑换消耗 (特权点)</label>
              <input className="w-full p-2 rounded border" type="number" placeholder="1" value={cost} onChange={e => setCost(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleAdd} className="flex-1">保存</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        {/* 空状态 */}
        {list.length === 0 && !showAdd && !showTemplates && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">👑</div>
            <div className="text-gray-500 mb-4">还没有特权哦</div>
            <div className="flex flex-col gap-2">
              <button onClick={openTemplates} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 mx-auto hover:opacity-90 transition-all">
                <Sparkles size={18}/> 从模板快速添加
              </button>
              <button onClick={() => setShowAdd(true)} className="text-purple-600 font-medium text-sm">
                或手动创建特权
              </button>
            </div>
          </div>
        )}

        {/* 模板选择界面 */}
        {showTemplates && (
          <div className="animate-in fade-in">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="text-purple-500" size={20}/> 选择特权模板
              </h3>
              <span className="text-sm text-gray-500">已选 {selectedCount} 个</span>
            </div>
            
            <p className="text-xs text-gray-500 mb-4 bg-purple-50 p-3 rounded-lg">
              💡 特权是孩子用特权点兑换的服务性奖励，完成任务可获得特权点。选择适合您家庭的特权吧！
            </p>
            
            {Object.entries(groupedTemplates).map(([cat, templates]) => (
              <div key={cat} className="mb-4">
                <div className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">{cat}类特权</div>
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
                      <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{template.desc}</div>
                      <div className="text-xs text-purple-600 font-bold mt-1">{template.cost} 特权点</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            
            <div className="flex gap-2 sticky bottom-0 bg-gray-50 py-3 -mx-4 px-4 border-t">
              <Button onClick={closeTemplates} variant="ghost" className="flex-1">取消</Button>
              <Button onClick={handleAddTemplates} className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 border-none" disabled={selectedCount === 0}>
                添加 {selectedCount} 个特权
              </Button>
            </div>
          </div>
        )}

        {/* 已有特权列表 */}
        {list.length > 0 && !showTemplates && (
          <>
            <button onClick={openTemplates} className="w-full p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl flex items-center justify-center gap-2 text-purple-600 font-medium text-sm hover:from-purple-100 hover:to-pink-100 transition-all mb-2">
              <Sparkles size={16}/> 从模板快速添加更多特权
            </button>
            
            {list.map(p => (
              <Card key={p.id} className="flex justify-between items-center">
                <div>
                  <div className="font-bold">{p.title}</div>
                  <div className="text-xs text-gray-500">{p.description}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-bold text-purple-600">{p.cost} 特权点</div>
                  <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600"><Trash2 size={18}/></button>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </Layout>
  );
}
