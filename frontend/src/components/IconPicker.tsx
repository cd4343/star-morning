import React, { useState } from 'react';

// 扩展的图标库 - 按类别分组
export const ICON_LIBRARY = {
  // 日常生活
  daily: [
    { icon: '🛏️', name: '床铺' },
    { icon: '🪥', name: '牙刷' },
    { icon: '🧹', name: '扫把' },
    { icon: '🗑️', name: '垃圾桶' },
    { icon: '🧺', name: '衣物' },
    { icon: '🧽', name: '海绵' },
    { icon: '🚿', name: '淋浴' },
    { icon: '🪣', name: '水桶' },
    { icon: '🧴', name: '洗护品' },
    { icon: '🧸', name: '玩具' },
    { icon: '👕', name: '衣服' },
    { icon: '👟', name: '鞋子' },
    { icon: '🎒', name: '书包' },
    { icon: '🧦', name: '袜子' },
    { icon: '🧥', name: '外套' },
  ],
  // 学习教育
  study: [
    { icon: '📚', name: '书本' },
    { icon: '📖', name: '阅读' },
    { icon: '✍️', name: '写字' },
    { icon: '📝', name: '笔记' },
    { icon: '📜', name: '卷轴' },
    { icon: '🔤', name: '字母' },
    { icon: '🔢', name: '数字' },
    { icon: '🧮', name: '算盘' },
    { icon: '📐', name: '三角尺' },
    { icon: '✏️', name: '铅笔' },
    { icon: '🖊️', name: '钢笔' },
    { icon: '📓', name: '笔记本' },
    { icon: '🎓', name: '毕业帽' },
    { icon: '💡', name: '灯泡' },
    { icon: '🧠', name: '大脑' },
  ],
  // 运动健康
  sports: [
    { icon: '⚽', name: '足球' },
    { icon: '🏀', name: '篮球' },
    { icon: '🏃', name: '跑步' },
    { icon: '🚴', name: '骑车' },
    { icon: '🏊', name: '游泳' },
    { icon: '⛹️', name: '运动' },
    { icon: '🤸', name: '体操' },
    { icon: '🧘', name: '瑜伽' },
    { icon: '🎾', name: '网球' },
    { icon: '🏓', name: '乒乓球' },
    { icon: '🏸', name: '羽毛球' },
    { icon: '⛳', name: '高尔夫' },
    { icon: '🎿', name: '滑雪' },
    { icon: '🛹', name: '滑板' },
    { icon: '👀', name: '眼睛' },
    { icon: '🌅', name: '早起' },
    { icon: '💪', name: '力量' },
    { icon: '❤️', name: '健康' },
  ],
  // 兴趣爱好
  hobby: [
    { icon: '🎹', name: '钢琴' },
    { icon: '🎸', name: '吉他' },
    { icon: '🎻', name: '小提琴' },
    { icon: '🎺', name: '小号' },
    { icon: '🥁', name: '架子鼓' },
    { icon: '🎤', name: '唱歌' },
    { icon: '🎨', name: '画画' },
    { icon: '🖼️', name: '画框' },
    { icon: '🎭', name: '戏剧' },
    { icon: '♟️', name: '国际象棋' },
    { icon: '🧩', name: '拼图' },
    { icon: '🎲', name: '骰子' },
    { icon: '📷', name: '摄影' },
    { icon: '🎬', name: '电影' },
    { icon: '✂️', name: '手工' },
    { icon: '🧶', name: '编织' },
    { icon: '🪴', name: '盆栽' },
    { icon: '🌱', name: '植物' },
  ],
  // 家务劳动
  chores: [
    { icon: '🍽️', name: '餐具' },
    { icon: '🥄', name: '餐具' },
    { icon: '🧊', name: '冰箱' },
    { icon: '🚰', name: '水龙头' },
    { icon: '🪟', name: '窗户' },
    { icon: '🚪', name: '门' },
    { icon: '🛋️', name: '沙发' },
    { icon: '🪑', name: '椅子' },
    { icon: '🐕', name: '宠物狗' },
    { icon: '🐈', name: '宠物猫' },
    { icon: '🐟', name: '鱼' },
    { icon: '🌻', name: '向日葵' },
    { icon: '🌷', name: '郁金香' },
    { icon: '🧯', name: '灭火器' },
    { icon: '🔧', name: '扳手' },
  ],
  // 娱乐休闲
  entertainment: [
    { icon: '📺', name: '电视' },
    { icon: '🎮', name: '游戏机' },
    { icon: '📱', name: '手机' },
    { icon: '💻', name: '电脑' },
    { icon: '🎧', name: '耳机' },
    { icon: '🎪', name: '马戏团' },
    { icon: '🎢', name: '过山车' },
    { icon: '🎡', name: '摩天轮' },
    { icon: '🏞️', name: '公园' },
    { icon: '🏖️', name: '沙滩' },
    { icon: '⛺', name: '露营' },
    { icon: '🎠', name: '旋转木马' },
    { icon: '🎰', name: '抽奖' },
    { icon: '🎁', name: '礼物' },
    { icon: '🎀', name: '蝴蝶结' },
  ],
  // 食物零食
  food: [
    { icon: '🍕', name: '披萨' },
    { icon: '🍔', name: '汉堡' },
    { icon: '🍦', name: '冰淇淋' },
    { icon: '🍬', name: '糖果' },
    { icon: '🍭', name: '棒棒糖' },
    { icon: '🍪', name: '饼干' },
    { icon: '🎂', name: '蛋糕' },
    { icon: '🧁', name: '杯子蛋糕' },
    { icon: '🍩', name: '甜甜圈' },
    { icon: '🍫', name: '巧克力' },
    { icon: '🍿', name: '爆米花' },
    { icon: '🥤', name: '饮料' },
    { icon: '🧃', name: '果汁' },
    { icon: '🍼', name: '奶瓶' },
    { icon: '🍌', name: '香蕉' },
    { icon: '🍎', name: '苹果' },
  ],
  // 奖励徽章
  reward: [
    { icon: '⭐', name: '星星' },
    { icon: '🌟', name: '闪亮星' },
    { icon: '✨', name: '闪光' },
    { icon: '💫', name: '流星' },
    { icon: '🏆', name: '奖杯' },
    { icon: '🥇', name: '金牌' },
    { icon: '🥈', name: '银牌' },
    { icon: '🥉', name: '铜牌' },
    { icon: '👑', name: '皇冠' },
    { icon: '💎', name: '钻石' },
    { icon: '💰', name: '金币袋' },
    { icon: '🪙', name: '金币' },
    { icon: '💵', name: '钞票' },
    { icon: '🎫', name: '票券' },
    { icon: '🏷️', name: '标签' },
    { icon: '🔔', name: '铃铛' },
  ],
  // 时间相关
  time: [
    { icon: '⏰', name: '闹钟' },
    { icon: '⏱️', name: '秒表' },
    { icon: '🕐', name: '时钟' },
    { icon: '🌙', name: '月亮' },
    { icon: '☀️', name: '太阳' },
    { icon: '🌈', name: '彩虹' },
    { icon: '☁️', name: '云朵' },
    { icon: '⛅', name: '多云' },
    { icon: '😴', name: '睡觉' },
    { icon: '🌛', name: '月亮脸' },
    { icon: '🎆', name: '烟花' },
    { icon: '🎇', name: '烟火' },
  ],
  // 晨间启动
  morning: [
    { icon: '🌄', name: '日出' },
    { icon: '☀️', name: '太阳' },
    { icon: '⏰', name: '闹钟' },
    { icon: '🛌', name: '起床' },
    { icon: '🪟', name: '开窗' },
    { icon: '💧', name: '喝水' },
    { icon: '🪥', name: '刷牙' },
    { icon: '🧼', name: '洗脸' },
    { icon: '👕', name: '穿衣' },
    { icon: '🎒', name: '书包' },
    { icon: '🥣', name: '早餐' },
    { icon: '🧘', name: '拉伸' },
  ],
  // 情绪与安抚
  calm: [
    { icon: '🫶', name: '接纳' },
    { icon: '💗', name: '爱心' },
    { icon: '🫧', name: '泡泡呼吸' },
    { icon: '🌊', name: '海浪' },
    { icon: '🍃', name: '叶子' },
    { icon: '🧘', name: '冥想' },
    { icon: '🎧', name: '听音乐' },
    { icon: '🧸', name: '安抚玩具' },
    { icon: '📝', name: '写下来' },
    { icon: '🧊', name: '冷静' },
    { icon: '🤝', name: '求助' },
    { icon: '✨', name: '恢复' },
  ],
  // 活动挑战
  movement: [
    { icon: '🏃', name: '跑步' },
    { icon: '🤸', name: '开合跳' },
    { icon: '🕺', name: '跳舞' },
    { icon: '🧘', name: '拉伸' },
    { icon: '💪', name: '力量' },
    { icon: '🪜', name: '爬楼' },
    { icon: '🛝', name: '滑梯' },
    { icon: '🛴', name: '滑板车' },
    { icon: '⚽', name: '球类' },
    { icon: '🥏', name: '飞盘' },
    { icon: '🎯', name: '投掷' },
    { icon: '🏅', name: '挑战章' },
  ],
  // 外出与体验
  outing: [
    { icon: '🏞️', name: '公园' },
    { icon: '🎢', name: '游乐场' },
    { icon: '🎬', name: '电影' },
    { icon: '🏛️', name: '博物馆' },
    { icon: '📚', name: '书店' },
    { icon: '🚲', name: '骑行' },
    { icon: '🚌', name: '公交' },
    { icon: '🚆', name: '火车' },
    { icon: '🗺️', name: '地图' },
    { icon: '🎟️', name: '门票' },
    { icon: '🍱', name: '外食' },
    { icon: '📷', name: '拍照' },
  ],
  // 表情动作
  emoji: [
    { icon: '😊', name: '微笑' },
    { icon: '😎', name: '酷' },
    { icon: '🤩', name: '惊喜' },
    { icon: '🥳', name: '庆祝' },
    { icon: '🤗', name: '拥抱' },
    { icon: '👍', name: '点赞' },
    { icon: '👏', name: '鼓掌' },
    { icon: '🙌', name: '举手' },
    { icon: '✅', name: '完成' },
    { icon: '❌', name: '错误' },
    { icon: '🔄', name: '刷新' },
    { icon: '🆕', name: '新' },
    { icon: '🆓', name: '免费' },
    { icon: '🈲', name: '禁止' },
    { icon: '👫', name: '朋友' },
    { icon: '👨‍👩‍👧', name: '家庭' },
  ],
};

// 所有图标的扁平化列表
export const ALL_ICONS = Object.values(ICON_LIBRARY).flat();

// 按类别获取图标
export const getIconsByCategory = (category: keyof typeof ICON_LIBRARY) => ICON_LIBRARY[category];

// 类别中文名称
const CATEGORY_NAMES: Record<string, string> = {
  daily: '日常生活',
  study: '学习教育',
  sports: '运动健康',
  hobby: '兴趣爱好',
  chores: '家务劳动',
  entertainment: '娱乐休闲',
  food: '食物零食',
  reward: '奖励徽章',
  time: '时间相关',
  morning: '晨间启动',
  calm: '情绪安抚',
  movement: '活动挑战',
  outing: '外出体验',
  emoji: '表情动作',
};

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  categories?: (keyof typeof ICON_LIBRARY)[];
}

export const IconPicker: React.FC<IconPickerProps> = ({ 
  value, 
  onChange,
  categories = ['daily', 'study', 'sports', 'hobby', 'chores']
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<keyof typeof ICON_LIBRARY>(categories[0]);

  return (
    <div className="relative">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-10 rounded-lg border bg-white text-2xl flex items-center justify-center hover:bg-gray-50 shadow-sm transition-all"
      >
        {value || '🎁'}
      </button>
      
      {isOpen && (
        <>
          {/* 背景遮罩 - 透明，用于检测点击外部关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          
          {/* 图标选择器 */}
          <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border z-50 w-80 max-h-80 overflow-hidden">
            {/* 类别 tabs */}
            <div className="flex overflow-x-auto border-b bg-gray-50 p-1 gap-1">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                    activeCategory === cat 
                      ? 'bg-blue-500 text-white' 
                      : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {CATEGORY_NAMES[cat]}
                </button>
              ))}
            </div>
            
            {/* 图标网格 */}
            <div className="p-2 max-h-52 overflow-y-auto">
              <div className="grid grid-cols-6 gap-1">
                {ICON_LIBRARY[activeCategory].map((item, i) => (
                  <button 
                    key={i}
                    type="button"
                    onClick={() => { onChange(item.icon); setIsOpen(false); }}
                    className={`w-10 h-10 rounded-lg text-xl hover:bg-blue-100 transition-all flex items-center justify-center ${
                      value === item.icon ? 'bg-blue-200 ring-2 ring-blue-400 scale-110' : 'bg-gray-50'
                    }`}
                    title={item.name}
                  >
                    {item.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default IconPicker;

