import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Plus, Trash2, Pen, X, Check } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';

// 成就图标库 - 按类别分组，统一 emoji 风格
const ACHIEVEMENT_ICON_CATEGORIES = {
  '基础': [
    { icon: '🌱', name: '新芽' },
    { icon: '🐝', name: '蜜蜂' },
    { icon: '🏆', name: '奖杯' },
    { icon: '👑', name: '皇冠' },
    { icon: '🔥', name: '火焰' },
    { icon: '💪', name: '力量' },
    { icon: '⭐', name: '星星' },
    { icon: '🎯', name: '靶心' },
    { icon: '🍀', name: '幸运草' },
    { icon: '🌈', name: '彩虹' },
    { icon: '🎖️', name: '勋章' },
    { icon: '🥇', name: '金牌' },
    { icon: '🥈', name: '银牌' },
    { icon: '🥉', name: '铜牌' },
    { icon: '💎', name: '钻石' },
    { icon: '🏅', name: '徽章' },
  ],
  '运动健康': [
    { icon: '🏃', name: '跑步' },
    { icon: '🏋️', name: '举重' },
    { icon: '🚴', name: '骑车' },
    { icon: '🏊', name: '游泳' },
    { icon: '⚽', name: '足球' },
    { icon: '🏀', name: '篮球' },
    { icon: '🎾', name: '网球' },
    { icon: '🏸', name: '羽毛球' },
    { icon: '⚾', name: '棒球' },
    { icon: '🧘', name: '瑜伽' },
    { icon: '💃', name: '舞蹈' },
    { icon: '🥋', name: '武术' },
    { icon: '🛹', name: '滑板' },
    { icon: '⛷️', name: '滑雪' },
    { icon: '🏂', name: '滑板' },
    { icon: '🤸', name: '体操' },
  ],
  '学习艺术': [
    { icon: '📚', name: '书本' },
    { icon: '✏️', name: '铅笔' },
    { icon: '📝', name: '作业' },
    { icon: '🎹', name: '钢琴' },
    { icon: '🎸', name: '吉他' },
    { icon: '🎻', name: '小提琴' },
    { icon: '🥁', name: '架子鼓' },
    { icon: '🎨', name: '绘画' },
    { icon: '🖌️', name: '画笔' },
    { icon: '🔬', name: '显微镜' },
    { icon: '🧪', name: '实验' },
    { icon: '📐', name: '三角尺' },
    { icon: '🔢', name: '数字' },
    { icon: '🌍', name: '地球' },
    { icon: '📖', name: '阅读' },
    { icon: '🎤', name: '唱歌' },
  ],
  '好习惯': [
    { icon: '🦷', name: '牙齿' },
    { icon: '🪥', name: '牙刷' },
    { icon: '🛁', name: '浴缸' },
    { icon: '😴', name: '睡眠' },
    { icon: '🍎', name: '苹果' },
    { icon: '🥗', name: '蔬菜' },
    { icon: '💧', name: '水滴' },
    { icon: '🧴', name: '洗手' },
    { icon: '👀', name: '护眼' },
    { icon: '🧤', name: '手套' },
    { icon: '📵', name: '少玩手机' },
    { icon: '⏰', name: '准时' },
    { icon: '🛏️', name: '整理床铺' },
    { icon: '🧹', name: '扫帚' },
    { icon: '🧺', name: '洗衣' },
    { icon: '🍽️', name: '餐具' },
  ],
  '品德行为': [
    { icon: '🤝', name: '握手' },
    { icon: '💝', name: '爱心' },
    { icon: '🙏', name: '感恩' },
    { icon: '😊', name: '微笑' },
    { icon: '🗣️', name: '礼貌' },
    { icon: '🤫', name: '安静' },
    { icon: '👂', name: '倾听' },
    { icon: '🦸', name: '勇敢' },
    { icon: '🐢', name: '坚持' },
    { icon: '🦁', name: '狮子' },
    { icon: '🦋', name: '蝴蝶' },
    { icon: '🐉', name: '龙' },
    { icon: '🦅', name: '雄鹰' },
    { icon: '🐬', name: '海豚' },
    { icon: '🦄', name: '独角兽' },
    { icon: '🌟', name: '闪耀' },
  ],
  '财富': [
    { icon: '🐷', name: '小猪' },
    { icon: '💰', name: '金币袋' },
    { icon: '🏦', name: '银行' },
    { icon: '💵', name: '钞票' },
    { icon: '🪙', name: '硬币' },
    { icon: '💳', name: '卡片' },
    { icon: '📈', name: '增长' },
    { icon: '🎁', name: '礼物' },
  ],
  '连续坚持': [
    { icon: '📅', name: '日历' },
    { icon: '🗓️', name: '撕页日历' },
    { icon: '⚡', name: '闪电' },
    { icon: '💯', name: '满分' },
    { icon: '🚀', name: '火箭' },
    { icon: '✨', name: '闪光' },
    { icon: '🎊', name: '庆祝' },
    { icon: '🎉', name: '派对' },
  ],
};

// 条件类型配置
const CONDITION_TYPES = [
  { value: 'task_count', label: '累计完成任务数', needValue: true, needCategory: false },
  { value: 'coin_count', label: '累计获得金币数', needValue: true, needCategory: false },
  { value: 'xp_count', label: '累计获得经验值', needValue: true, needCategory: false },
  { value: 'level_reach', label: '达到等级', needValue: true, needCategory: false },
  { value: 'category_count', label: '特定类别任务完成数', needValue: true, needCategory: true },
  { value: 'streak_days', label: '连续天数完成任务', needValue: true, needCategory: true },
  { value: 'manual', label: '仅手动颁发', needValue: false, needCategory: false },
];

// 任务类别
const TASK_CATEGORIES = ['劳动', '学习', '兴趣', '运动'];

// 预设成就模板 - 大幅扩充
const ACHIEVEMENT_TEMPLATES = [
  // === 任务数量类 ===
  { title: '初来乍到', desc: '完成第1个任务', icon: '🌱', type: 'task_count', value: 1, category: null },
  { title: '小小勤劳者', desc: '完成10个任务', icon: '🐝', type: 'task_count', value: 10, category: null },
  { title: '任务达人', desc: '完成50个任务', icon: '🏆', type: 'task_count', value: 50, category: null },
  { title: '任务大师', desc: '完成100个任务', icon: '👑', type: 'task_count', value: 100, category: null },
  { title: '超级明星', desc: '完成500个任务', icon: '🌟', type: 'task_count', value: 500, category: null },
  
  // === 金币类 ===
  { title: '小小存钱罐', desc: '累计获得100金币', icon: '🐷', type: 'coin_count', value: 100, category: null },
  { title: '财富小能手', desc: '累计获得500金币', icon: '💰', type: 'coin_count', value: 500, category: null },
  { title: '金币大亨', desc: '累计获得1000金币', icon: '🏦', type: 'coin_count', value: 1000, category: null },
  { title: '财富之王', desc: '累计获得5000金币', icon: '💎', type: 'coin_count', value: 5000, category: null },
  
  // === 经验/等级类 ===
  { title: '新手入门', desc: '累计获得100经验', icon: '⭐', type: 'xp_count', value: 100, category: null },
  { title: '成长之路', desc: '达到5级', icon: '📈', type: 'level_reach', value: 5, category: null },
  { title: '进阶高手', desc: '达到10级', icon: '🚀', type: 'level_reach', value: 10, category: null },
  { title: '满级大神', desc: '达到20级', icon: '🦄', type: 'level_reach', value: 20, category: null },
  
  // === 运动坚持类 ===
  { title: '运动新手', desc: '完成第1个运动任务', icon: '🏃', type: 'category_count', value: 1, category: '运动' },
  { title: '运动小将', desc: '完成20个运动任务', icon: '🏋️', type: 'category_count', value: 20, category: '运动' },
  { title: '运动达人', desc: '连续7天完成运动', icon: '🔥', type: 'streak_days', value: 7, category: '运动' },
  { title: '运动之星', desc: '连续30天完成运动', icon: '🏅', type: 'streak_days', value: 30, category: '运动' },
  { title: '运动健将', desc: '连续100天完成运动', icon: '🦸', type: 'streak_days', value: 100, category: '运动' },
  
  // === 学习/练琴/写字类 ===
  { title: '学习新手', desc: '完成第1个学习任务', icon: '📚', type: 'category_count', value: 1, category: '学习' },
  { title: '学习小能手', desc: '完成30个学习任务', icon: '📖', type: 'category_count', value: 30, category: '学习' },
  { title: '学习达人', desc: '连续7天完成学习', icon: '✏️', type: 'streak_days', value: 7, category: '学习' },
  { title: '学霸养成', desc: '连续30天完成学习', icon: '📝', type: 'streak_days', value: 30, category: '学习' },
  { title: '学习之星', desc: '连续100天完成学习', icon: '🎓', type: 'streak_days', value: 100, category: '学习' },
  
  // === 兴趣爱好类（练琴等） ===
  { title: '兴趣萌芽', desc: '完成第1个兴趣任务', icon: '🎹', type: 'category_count', value: 1, category: '兴趣' },
  { title: '小小艺术家', desc: '完成20个兴趣任务', icon: '🎨', type: 'category_count', value: 20, category: '兴趣' },
  { title: '坚持练琴', desc: '连续7天完成兴趣任务', icon: '🎸', type: 'streak_days', value: 7, category: '兴趣' },
  { title: '音乐达人', desc: '连续30天完成兴趣任务', icon: '🎻', type: 'streak_days', value: 30, category: '兴趣' },
  { title: '艺术大师', desc: '连续100天完成兴趣任务', icon: '🎤', type: 'streak_days', value: 100, category: '兴趣' },
  
  // === 劳动类 ===
  { title: '劳动小蜜蜂', desc: '完成第1个劳动任务', icon: '🧹', type: 'category_count', value: 1, category: '劳动' },
  { title: '家务小帮手', desc: '完成30个劳动任务', icon: '🧺', type: 'category_count', value: 30, category: '劳动' },
  { title: '劳动达人', desc: '连续7天完成劳动', icon: '🛏️', type: 'streak_days', value: 7, category: '劳动' },
  { title: '勤劳之星', desc: '连续30天完成劳动', icon: '🍽️', type: 'streak_days', value: 30, category: '劳动' },
  
  // === 连续打卡类 ===
  { title: '三天小确幸', desc: '连续3天完成任务', icon: '📅', type: 'streak_days', value: 3, category: null },
  { title: '周周坚持', desc: '连续7天完成任务', icon: '🗓️', type: 'streak_days', value: 7, category: null },
  { title: '习惯养成', desc: '连续21天完成任务', icon: '💯', type: 'streak_days', value: 21, category: null },
  { title: '月度坚持', desc: '连续30天完成任务', icon: '⚡', type: 'streak_days', value: 30, category: null },
  { title: '百日挑战', desc: '连续100天完成任务', icon: '🎊', type: 'streak_days', value: 100, category: null },
  
  // === 好习惯类（手动） ===
  { title: '护牙小卫士', desc: '坚持每天刷牙', icon: '🦷', type: 'manual', value: 0, category: null },
  { title: '护眼小达人', desc: '坚持做眼保健操', icon: '👀', type: 'manual', value: 0, category: null },
  { title: '早睡早起', desc: '养成良好作息习惯', icon: '😴', type: 'manual', value: 0, category: null },
  { title: '多喝水宝宝', desc: '每天喝够8杯水', icon: '💧', type: 'manual', value: 0, category: null },
  { title: '爱干净宝宝', desc: '勤洗手讲卫生', icon: '🧴', type: 'manual', value: 0, category: null },
  { title: '小手干净', desc: '坚持不咬指甲不拔手皮', icon: '🧤', type: 'manual', value: 0, category: null },
  { title: '健康饮食', desc: '多吃蔬果少吃零食', icon: '🥗', type: 'manual', value: 0, category: null },
  
  // === 品德类（手动） ===
  { title: '礼貌小天使', desc: '说话有礼貌', icon: '😊', type: 'manual', value: 0, category: null },
  { title: '乐于助人', desc: '主动帮助他人', icon: '🤝', type: 'manual', value: 0, category: null },
  { title: '懂得感恩', desc: '学会说谢谢', icon: '🙏', type: 'manual', value: 0, category: null },
  { title: '勇敢宝贝', desc: '敢于面对困难', icon: '🦁', type: 'manual', value: 0, category: null },
  { title: '诚实守信', desc: '做一个诚实的孩子', icon: '💝', type: 'manual', value: 0, category: null },
];

// 获取所有图标的扁平列表
const getAllIcons = () => {
  const icons: { icon: string; name: string }[] = [];
  Object.values(ACHIEVEMENT_ICON_CATEGORIES).forEach(category => {
    icons.push(...category);
  });
  return icons;
};

export default function ParentAchievements() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [list, setList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeIconCategory, setActiveIconCategory] = useState('基础');
  
  // 表单状态
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [icon, setIcon] = useState('🏆');
  const [conditionType, setConditionType] = useState('task_count');
  const [conditionValue, setConditionValue] = useState('');
  const [conditionCategory, setConditionCategory] = useState('');
  
  // 编辑状态
  const [editingAchievement, setEditingAchievement] = useState<any>(null);

  useEffect(() => { fetchList(); }, []);
  const fetchList = async () => { const res = await api.get('/parent/achievements'); setList(res.data); };

  const resetForm = () => {
    setTitle('');
    setDesc('');
    setIcon('🏆');
    setConditionType('task_count');
    setConditionValue('');
    setConditionCategory('');
  };

  const handleAdd = async () => {
    if (!title) return toast.warning('请输入标题');
    const condConfig = CONDITION_TYPES.find(c => c.value === conditionType);
    if (condConfig?.needValue && !conditionValue) return toast.warning('请输入目标值');
    if (condConfig?.needCategory && !conditionCategory) return toast.warning('请选择任务类别');
    
    await api.post('/parent/achievements', { 
      title, 
      description: desc, 
      icon, 
      conditionType, 
      conditionValue: +conditionValue || 0,
      conditionCategory: conditionCategory || null
    });
    setShowAdd(false); 
    resetForm();
    fetchList();
    toast.success('成就创建成功');
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除成就',
      message: '确定删除这个成就吗？已解锁的记录会保留。',
      type: 'danger',
      confirmText: '删除',
    });
    if (!confirmed) return;
    await api.delete(`/parent/achievements/${id}`);
    toast.success('删除成功');
    fetchList();
  };

  // 打开编辑
  const openEdit = (item: any) => {
    setEditingAchievement(item);
    setTitle(item.title);
    setDesc(item.description || '');
    setIcon(item.icon);
    setConditionType(item.conditionType);
    setConditionValue(item.conditionValue?.toString() || '');
    setConditionCategory(item.conditionCategory || '');
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingAchievement) return;
    if (!title) return toast.warning('请输入标题');
    
    await api.put(`/parent/achievements/${editingAchievement.id}`, {
      title,
      description: desc,
      icon,
      conditionType,
      conditionValue: +conditionValue || 0,
      conditionCategory: conditionCategory || null
    });
    
    setEditingAchievement(null);
    resetForm();
    fetchList();
    toast.success('修改成功');
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingAchievement(null);
    resetForm();
  };

  const applyTemplate = (tpl: typeof ACHIEVEMENT_TEMPLATES[0]) => {
    setTitle(tpl.title);
    setDesc(tpl.desc);
    setIcon(tpl.icon);
    setConditionType(tpl.type);
    setConditionValue(tpl.value.toString());
    setConditionCategory(tpl.category || '');
    setShowTemplates(false);
  };

  // 获取条件类型显示文本
  const getConditionText = (item: any) => {
    switch (item.conditionType) {
      case 'manual': return '🎁 手动颁发';
      case 'task_count': return `📋 完成 ${item.conditionValue} 个任务`;
      case 'coin_count': return `💰 获得 ${item.conditionValue} 金币`;
      case 'xp_count': return `⭐ 获得 ${item.conditionValue} 经验`;
      case 'level_reach': return `🚀 达到 ${item.conditionValue} 级`;
      case 'category_count': return `📊 完成 ${item.conditionValue} 个${item.conditionCategory || ''}任务`;
      case 'streak_days': return `🔥 连续 ${item.conditionValue} 天${item.conditionCategory ? `(${item.conditionCategory})` : ''}`;
      default: return item.conditionType;
    }
  };

  // 渲染表单（新建和编辑共用）
  const renderForm = (isEdit: boolean) => {
    const condConfig = CONDITION_TYPES.find(c => c.value === conditionType);
    
    return (
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
              <div className="absolute top-full left-0 mt-1 p-2 bg-white rounded-xl shadow-xl border z-50 w-72">
                {/* 类别 tabs */}
                <div className="flex overflow-x-auto gap-1 mb-2 pb-1 border-b">
                  {Object.keys(ACHIEVEMENT_ICON_CATEGORIES).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveIconCategory(cat)}
                      className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                        activeIconCategory === cat 
                          ? 'bg-yellow-500 text-white' 
                          : 'text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {/* 图标网格 */}
                <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                  {ACHIEVEMENT_ICON_CATEGORIES[activeIconCategory as keyof typeof ACHIEVEMENT_ICON_CATEGORIES].map((item, i) => (
                    <button 
                      key={i}
                      onClick={() => { setIcon(item.icon); setShowIconPicker(false); }}
                      className={`w-8 h-8 rounded text-lg hover:bg-yellow-100 transition-colors ${icon === item.icon ? 'bg-yellow-200 ring-2 ring-yellow-400' : ''}`}
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
        
        <div>
          <label className="text-xs text-gray-500 font-bold">解锁条件</label>
          <select className="w-full p-2 rounded-lg border bg-white" value={conditionType} onChange={e => setConditionType(e.target.value)}>
            {CONDITION_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
        </div>
        
        {/* 需要选择类别时 */}
        {condConfig?.needCategory && (
          <div>
            <label className="text-xs text-gray-500 font-bold">任务类别</label>
            <select className="w-full p-2 rounded-lg border bg-white" value={conditionCategory} onChange={e => setConditionCategory(e.target.value)}>
              <option value="">请选择类别</option>
              {TASK_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}
        
        {/* 需要输入数值时 */}
        {condConfig?.needValue && (
          <div>
            <label className="text-xs text-gray-500 font-bold">
              {conditionType === 'streak_days' ? '连续天数' : 
               conditionType === 'level_reach' ? '等级' : '目标值'}
            </label>
            <input 
              className="w-full p-2 rounded-lg border" 
              type="number" 
              placeholder={conditionType === 'streak_days' ? '7' : '10'} 
              value={conditionValue} 
              onChange={e => setConditionValue(e.target.value)} 
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      <Header title="成就管理" showBack onBack={() => navigate('/parent/dashboard')} rightElem={<button onClick={() => setShowAdd(true)}><Plus className="text-blue-600"/></button>} />
      
      {/* 新建成就 - 底部抽屉 */}
      <BottomSheet 
        isOpen={showAdd} 
        onClose={() => { setShowAdd(false); resetForm(); }} 
        title="🏆 新建成就"
        footer={
          <div className="flex gap-3">
            <Button size="sm" onClick={handleAdd} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 border-none">保存成就</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); resetForm(); }} className="flex-1">取消</Button>
          </div>
        }
      >
        <div className="mb-4">
          <button 
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full text-sm bg-blue-100 text-blue-600 px-3 py-2 rounded-lg font-bold hover:bg-blue-200 transition-colors"
          >
            {showTemplates ? '关闭模板' : '📋 从模板选择（推荐）'}
          </button>
        </div>

        {/* 模板选择 */}
        {showTemplates && (
          <div className="mb-4 p-3 bg-gray-50 rounded-xl border max-h-64 overflow-y-auto">
            <div className="grid grid-cols-1 gap-2">
              {ACHIEVEMENT_TEMPLATES.map((tpl, i) => (
                <button 
                  key={i}
                  onClick={() => applyTemplate(tpl)}
                  className="flex items-center gap-3 p-2 bg-white rounded-lg hover:bg-yellow-50 text-left transition-colors border"
                >
                  <span className="text-2xl">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{tpl.title}</div>
                    <div className="text-xs text-gray-400 truncate">{tpl.desc}</div>
                  </div>
                  <div className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {tpl.type === 'manual' ? '手动' : 
                     tpl.type === 'streak_days' ? `${tpl.value}天` :
                     tpl.type === 'category_count' ? `${tpl.category}${tpl.value}次` :
                     `${tpl.value}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderForm(false)}
      </BottomSheet>

      {/* 编辑成就弹窗 */}
      {editingAchievement && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col animate-in zoom-in-95" style={{ maxHeight: 'calc(100% - 32px)' }}>
            <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
              <h3 className="font-bold text-lg">编辑成就</h3>
              <button onClick={cancelEdit} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {renderForm(true)}
            </div>
            <div className="flex-shrink-0 p-4 border-t flex gap-3">
              <Button size="sm" onClick={handleSaveEdit} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 border-none">
                <Check size={16} className="mr-1"/> 保存修改
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit} className="flex-1">取消</Button>
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
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-800 truncate">{item.title}</div>
                <div className="text-xs text-gray-500 truncate">{item.description}</div>
                <div className="text-[10px] text-blue-600 mt-1 bg-blue-50 inline-block px-2 py-0.5 rounded-full font-medium">
                  {getConditionText(item)}
                </div>
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => openEdit(item)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                <Pen size={16}/>
              </button>
              <button onClick={() => handleDelete(item.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={16}/>
              </button>
            </div>
          </Card>
        ))}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
