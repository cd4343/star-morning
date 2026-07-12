import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../components/Header';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { Trash2, Pen, Check, Sparkles } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';
import { CreateActionCard } from '../../components/CreateActionCard';
import {
  getAchievementDisplay as getSharedAchievementDisplay,
  getAchievementRank as getSharedAchievementRank,
} from '../../utils/achievementDisplay';

// 成就图标库 - 按类别分组，统一 emoji 风格
const ACHIEVEMENT_ICON_CATEGORIES = {
  '探索': [
    { icon: '🧭', name: '指南针' },
    { icon: '🗺️', name: '地图' },
    { icon: '🏛️', name: '博物馆' },
    { icon: '🔬', name: '科技馆' },
    { icon: '🌿', name: '自然' },
    { icon: '🧳', name: '旅行' },
    { icon: '📸', name: '相机' },
    { icon: '🎤', name: '语音' },
    { icon: '🏔️', name: '高山' },
    { icon: '🏕️', name: '露营' },
    { icon: '🌟', name: '全能' },
    { icon: '🚗', name: '出行' },
  ],
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
  { value: 'manual', label: '家长确认类', needValue: false, needCategory: false },
  // 探索成就：这些类型由后端评估，前端需在此登记，否则编辑时目标值输入框消失、下拉会改坏类型
  { value: 'explore_checkin_count', label: '探索·累计打卡次数', needValue: true, needCategory: false },
  { value: 'explore_category_count', label: '探索·某类地点打卡数', needValue: true, needCategory: false },
  { value: 'explore_voice_count', label: '探索·语音留言数', needValue: true, needCategory: false },
  { value: 'explore_media_count', label: '探索·照片纪念数', needValue: true, needCategory: false },
  { value: 'explore_confirmed_count', label: '探索·家长确认探索次数', needValue: true, needCategory: false },
];

// 任务类别
const TASK_CATEGORIES = ['生活', '学习', '运动', '活动', '情绪调节', '其他'];
const ACHIEVEMENT_CATEGORIES = ['启动', '坚持', '生活', '学习', '运动', '活动', '情绪', '金币', '成长', '探索', '品格', '家庭', '其他'];
const ACHIEVEMENT_CATEGORY_HINTS: Record<string, string> = {
  启动: '奖励开始和小步完成。',
  坚持: '看见稳定和连续。',
  生活: '自理、家务和日常责任。',
  学习: '作业、阅读、练习和专注。',
  运动: '重在参与和身体习惯。',
  活动: '兴趣、艺术和探索体验。',
  情绪: '表达、冷静和复原。',
  金币: '储蓄、兑换和目标感。',
  成长: '等级、经验和综合提升。',
  探索: '地点打卡、见识和表达。',
  品格: '礼貌、诚实、勇敢和合作。',
  家庭: '分担、协作和亲子约定。',
  其他: '特殊目标暂放这里。',
};

// 预设成就模板：前端创建、后端默认种子使用同一套分类语义
const ACHIEVEMENT_TEMPLATES = [
  { title: '启程有光', desc: '完成 1 个任务', icon: '🌱', type: 'task_count', value: 1, category: null, achievementCategory: '启动' },
  { title: '小步成章', desc: '完成 10 个任务', icon: '🧭', type: 'task_count', value: 10, category: null, achievementCategory: '启动' },
  { title: '百炼成章', desc: '完成 50 个任务', icon: '🏆', type: 'task_count', value: 50, category: null, achievementCategory: '启动' },
  { title: '星路领航', desc: '完成 100 个任务', icon: '🌟', type: 'task_count', value: 100, category: null, achievementCategory: '启动' },
  { title: '一路繁星', desc: '完成 300 个任务', icon: '✨', type: 'task_count', value: 300, category: null, achievementCategory: '启动' },

  { title: '三天不断线', desc: '连续 3 天完成任务，先守住小周期', icon: '📅', type: 'streak_days', value: 3, category: null, achievementCategory: '坚持' },
  { title: '一周节奏', desc: '连续 7 天完成任务，节奏开始成形', icon: '🗓️', type: 'streak_days', value: 7, category: null, achievementCategory: '坚持' },
  { title: '习惯养成', desc: '连续 21 天完成任务，习惯正在长出来', icon: '💯', type: 'streak_days', value: 21, category: null, achievementCategory: '坚持' },
  { title: '月度坚持', desc: '连续 30 天完成任务，稳定性很珍贵', icon: '⚡', type: 'streak_days', value: 30, category: null, achievementCategory: '坚持' },
  { title: '久久为功', desc: '连续 60 天完成任务', icon: '🔥', type: 'streak_days', value: 60, category: null, achievementCategory: '坚持' },
  { title: '百日如一', desc: '连续 100 天完成任务', icon: '🎊', type: 'streak_days', value: 100, category: null, achievementCategory: '坚持' },

  { title: '生活小帮手', desc: '完成第 1 个生活任务', icon: '🧹', type: 'category_count', value: 1, category: '生活', achievementCategory: '生活' },
  { title: '自理有方', desc: '完成 10 个生活任务', icon: '🛏️', type: 'category_count', value: 10, category: '生活', achievementCategory: '生活' },
  { title: '井井有条', desc: '完成 30 个生活任务', icon: '🍽️', type: 'category_count', value: 30, category: '生活', achievementCategory: '生活' },
  { title: '家务担当', desc: '完成 60 个生活任务', icon: '🧺', type: 'category_count', value: 60, category: '生活', achievementCategory: '生活' },
  { title: '生活小管家', desc: '完成 100 个生活任务', icon: '🏠', type: 'category_count', value: 100, category: '生活', achievementCategory: '生活' },
  { title: '整洁一周', desc: '连续 7 天完成生活任务', icon: '🍽️', type: 'streak_days', value: 7, category: '生活', achievementCategory: '生活' },
  { title: '日常有序', desc: '连续 21 天完成生活任务', icon: '🧺', type: 'streak_days', value: 21, category: '生活', achievementCategory: '生活' },

  { title: '学习启动', desc: '完成第 1 个学习任务，先开始就算赢', icon: '📚', type: 'category_count', value: 1, category: '学习', achievementCategory: '学习' },
  { title: '专注小苗', desc: '完成 10 个学习任务', icon: '✏️', type: 'category_count', value: 10, category: '学习', achievementCategory: '学习' },
  { title: '作业小闯将', desc: '完成 30 个学习任务', icon: '📖', type: 'category_count', value: 30, category: '学习', achievementCategory: '学习' },
  { title: '学海拾贝', desc: '完成 60 个学习任务', icon: '📚', type: 'category_count', value: 60, category: '学习', achievementCategory: '学习' },
  { title: '求知小灯塔', desc: '完成 100 个学习任务', icon: '🎓', type: 'category_count', value: 100, category: '学习', achievementCategory: '学习' },
  { title: '学习一周星', desc: '连续 7 天完成学习任务', icon: '🎓', type: 'streak_days', value: 7, category: '学习', achievementCategory: '学习' },
  { title: '书声不断', desc: '连续 21 天完成学习任务', icon: '📖', type: 'streak_days', value: 21, category: '学习', achievementCategory: '学习' },

  { title: '动起来', desc: '完成第 1 个运动任务', icon: '🏃', type: 'category_count', value: 1, category: '运动', achievementCategory: '运动' },
  { title: '活力小步', desc: '完成 10 个运动任务', icon: '⚽', type: 'category_count', value: 10, category: '运动', achievementCategory: '运动' },
  { title: '运动小将', desc: '完成 30 个运动任务', icon: '🏸', type: 'category_count', value: 30, category: '运动', achievementCategory: '运动' },
  { title: '体能守护者', desc: '完成 60 个运动任务', icon: '🚴', type: 'category_count', value: 60, category: '运动', achievementCategory: '运动' },
  { title: '强健之星', desc: '完成 100 个运动任务', icon: '💪', type: 'category_count', value: 100, category: '运动', achievementCategory: '运动' },
  { title: '活力一周', desc: '连续 7 天完成运动任务', icon: '🔥', type: 'streak_days', value: 7, category: '运动', achievementCategory: '运动' },
  { title: '元气常在', desc: '连续 21 天完成运动任务', icon: '🏅', type: 'streak_days', value: 21, category: '运动', achievementCategory: '运动' },

  { title: '探索新事物', desc: '完成第 1 个活动任务', icon: '🎹', type: 'category_count', value: 1, category: '活动', achievementCategory: '活动' },
  { title: '兴趣练习者', desc: '完成 10 个活动任务', icon: '🎨', type: 'category_count', value: 10, category: '活动', achievementCategory: '活动' },
  { title: '灵感小匠', desc: '完成 30 个活动任务', icon: '🎸', type: 'category_count', value: 30, category: '活动', achievementCategory: '活动' },
  { title: '小小创作者', desc: '完成 60 个活动任务', icon: '🎤', type: 'category_count', value: 60, category: '活动', achievementCategory: '活动' },
  { title: '创意满格', desc: '完成 100 个活动任务', icon: '🌈', type: 'category_count', value: 100, category: '活动', achievementCategory: '活动' },
  { title: '活动坚持星', desc: '连续 7 天完成活动任务', icon: '🎸', type: 'streak_days', value: 7, category: '活动', achievementCategory: '活动' },
  { title: '艺海拾光', desc: '连续 21 天完成活动任务', icon: '🎤', type: 'streak_days', value: 21, category: '活动', achievementCategory: '活动' },

  { title: '会说感受', desc: '能说出自己现在的感受', icon: '💝', type: 'manual', value: 0, category: null, achievementCategory: '情绪' },
  { title: '冷静小勇士', desc: '生气或着急时尝试冷静动作', icon: '🤫', type: 'manual', value: 0, category: null, achievementCategory: '情绪' },
  { title: '求助很勇敢', desc: '卡住时能向家长或老师求助', icon: '🦸', type: 'manual', value: 0, category: null, achievementCategory: '情绪' },

  { title: '积少成多', desc: '获得 100 金币', icon: '🪙', type: 'coin_count', value: 100, category: null, achievementCategory: '金币' },
  { title: '聚沙成塔', desc: '获得 500 金币', icon: '💰', type: 'coin_count', value: 500, category: null, achievementCategory: '金币' },
  { title: '家财万贯', desc: '获得 1000 金币', icon: '🏦', type: 'coin_count', value: 1000, category: null, achievementCategory: '金币' },
  { title: '富足有方', desc: '获得 3000 金币', icon: '💎', type: 'coin_count', value: 3000, category: null, achievementCategory: '金币' },
  { title: '星河宝藏', desc: '获得 5000 金币', icon: '🎁', type: 'coin_count', value: 5000, category: null, achievementCategory: '金币' },
  { title: '丰盈之库', desc: '获得 10000 金币', icon: '👑', type: 'coin_count', value: 10000, category: null, achievementCategory: '金币' },

  { title: '初露锋芒', desc: '达到 2 级', icon: '⭐', type: 'level_reach', value: 2, category: null, achievementCategory: '成长' },
  { title: '新手入门', desc: '累计获得 100 经验', icon: '⭐', type: 'xp_count', value: 100, category: null, achievementCategory: '成长' },
  { title: '成长之路', desc: '达到 5 级', icon: '📈', type: 'level_reach', value: 5, category: null, achievementCategory: '成长' },
  { title: '进阶高手', desc: '达到 10 级', icon: '🚀', type: 'level_reach', value: 10, category: null, achievementCategory: '成长' },
  { title: '闪耀成长', desc: '达到 20 级', icon: '🌟', type: 'level_reach', value: 20, category: null, achievementCategory: '成长' },
  { title: '登峰造极', desc: '达到 30 级', icon: '👑', type: 'level_reach', value: 30, category: null, achievementCategory: '成长' },

  { title: '初次出发', desc: '完成 1 次探索打卡', icon: '🧭', type: 'explore_checkin_count', value: 1, category: null, achievementCategory: '探索' },
  { title: '见识在路上', desc: '完成 5 次探索打卡', icon: '🗺️', type: 'explore_checkin_count', value: 5, category: null, achievementCategory: '探索' },
  { title: '行路少年', desc: '完成 10 次探索打卡', icon: '🚶', type: 'explore_checkin_count', value: 10, category: null, achievementCategory: '探索' },
  { title: '博物初见', desc: '打卡 1 个博物馆', icon: '🏛️', type: 'explore_category_count', value: 1, category: '博物馆', achievementCategory: '探索' },
  { title: '自然观察员', desc: '打卡 3 个自然或公园地点', icon: '🌿', type: 'explore_category_count', value: 3, category: '自然,公园', achievementCategory: '探索' },
  { title: '城市小旅人', desc: '打卡 3 个城市地点', icon: '🏙️', type: 'explore_category_count', value: 3, category: '城市', achievementCategory: '探索' },
  { title: '勇敢表达', desc: '留下 1 条语音留言', icon: '🎙️', type: 'explore_voice_count', value: 1, category: null, achievementCategory: '探索' },
  { title: '小小记录家', desc: '上传 3 次照片纪念', icon: '📷', type: 'explore_media_count', value: 3, category: null, achievementCategory: '探索' },
  { title: '亲子探索家', desc: '完成 3 次家长确认探索', icon: '🎒', type: 'explore_confirmed_count', value: 3, category: null, achievementCategory: '探索' },

  { title: '礼貌小天使', desc: '能用礼貌的话表达需要', icon: '😊', type: 'manual', value: 0, category: null, achievementCategory: '品格' },
  { title: '乐于助人', desc: '主动帮助别人一次', icon: '🤝', type: 'manual', value: 0, category: null, achievementCategory: '品格' },
  { title: '懂得感谢', desc: '记得对别人说谢谢', icon: '🙏', type: 'manual', value: 0, category: null, achievementCategory: '品格' },
  { title: '诚实守信', desc: '遇到问题能诚实说明', icon: '🦁', type: 'manual', value: 0, category: null, achievementCategory: '品格' },

  { title: '家庭小帮手', desc: '主动为家里做一件小事', icon: '🏠', type: 'manual', value: 0, category: null, achievementCategory: '家庭' },
  { title: '合作之星', desc: '和家人一起完成一次合作任务', icon: '🤝', type: 'manual', value: 0, category: null, achievementCategory: '家庭' },
  { title: '约定守护者', desc: '遵守一次和家人约好的规则', icon: '🎯', type: 'manual', value: 0, category: null, achievementCategory: '家庭' },
];

const getTemplateAchievementCategory = (tpl: typeof ACHIEVEMENT_TEMPLATES[number]) => {
  if (tpl.achievementCategory && ACHIEVEMENT_CATEGORIES.includes(tpl.achievementCategory)) return tpl.achievementCategory;
  if (tpl.category && ACHIEVEMENT_CATEGORIES.includes(tpl.category)) return tpl.category;
  if (tpl.type === 'task_count') return '启动';
  if (tpl.type === 'coin_count') return '金币';
  if (tpl.type === 'xp_count' || tpl.type === 'level_reach') return '成长';
  if (tpl.type === 'streak_days') return '坚持';

  const text = `${tpl.title}${tpl.desc}`;
  if (/(感受|冷静|求助|情绪)/.test(text)) return '情绪';
  if (/(家庭|家人|合作|约定)/.test(text)) return '家庭';
  if (/(礼貌|助人|感恩|勇敢|诚实)/.test(text)) return '品格';
  return '其他';
};

const getTemplateReward = (tpl: typeof ACHIEVEMENT_TEMPLATES[number]) => {
  const value = Number(tpl.value || 0);
  if (tpl.type === 'manual') return { coins: 10, xp: 10, privilegePoints: 0 };
  if (tpl.type === 'streak_days') {
    return {
      coins: Math.min(100, Math.max(10, value * 3)),
      xp: Math.min(120, Math.max(10, value * 3)),
      privilegePoints: value >= 30 ? 1 : 0,
    };
  }
  if (tpl.type === 'task_count' || tpl.type === 'category_count') {
    return {
      coins: Math.min(100, Math.max(5, Math.round(value * 0.5))),
      xp: Math.min(150, Math.max(5, value)),
      privilegePoints: value >= 100 ? 1 : 0,
    };
  }
  if (tpl.type === 'coin_count') {
    return {
      coins: 0,
      xp: Math.min(100, Math.max(10, Math.round(value / 20))),
      privilegePoints: value >= 1000 ? 1 : 0,
    };
  }
  if (tpl.type === 'level_reach') {
    return {
      coins: Math.min(120, Math.max(20, value * 10)),
      xp: 0,
      privilegePoints: value >= 10 ? 1 : 0,
    };
  }
  return { coins: 0, xp: 0, privilegePoints: 0 };
};

const getRewardText = (item: any) => {
  if (!item) return '';
  const parts = [];
  if (Number(item.rewardCoins || 0) > 0) parts.push(`${item.rewardCoins} 金币`);
  if (Number(item.rewardXp || 0) > 0) parts.push(`${item.rewardXp} 经验`);
  if (Number(item.rewardPrivilegePoints || 0) > 0) parts.push(`${item.rewardPrivilegePoints} 特权点`);
  return parts.join(' + ');
};

const getLocalRank = getSharedAchievementRank;
const getLocalAchievementDisplay = getSharedAchievementDisplay;


export default function ParentAchievements() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [list, setList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeIconCategory, setActiveIconCategory] = useState('基础');
  const [achievementFilter, setAchievementFilter] = useState('全部');
  const [templateFilter, setTemplateFilter] = useState('全部');

  // 表单状态
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [icon, setIcon] = useState('🏆');
  const [conditionType, setConditionType] = useState('task_count');
  const [conditionValue, setConditionValue] = useState('');
  const [conditionCategory, setConditionCategory] = useState('');
  const [achievementCategory, setAchievementCategory] = useState('启动');
  const [rewardCoins, setRewardCoins] = useState('0');
  const [rewardXp, setRewardXp] = useState('0');
  const [rewardPrivilegePoints, setRewardPrivilegePoints] = useState('0');
  const [rewardDelivery, setRewardDelivery] = useState<'instant' | 'backpack'>('instant');

  // 编辑状态
  const [editingAchievement, setEditingAchievement] = useState<any>(null);

  const [children, setChildren] = useState<any[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/auth/members');
        const kids = (res.data || []).filter((m: any) => m.role === 'child');
        setChildren(kids);
        if (kids.length > 0) setSelectedChildId(prev => prev || kids[0].id);
      } catch (e) { console.error(e); }
    })();
  }, []);

  useEffect(() => { fetchList(); }, [selectedChildId]);
  const fetchList = async () => {
    try {
      const res = await api.get('/parent/achievements', selectedChildId ? { params: { childId: selectedChildId } } : undefined);
      setList(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error('获取成就列表失败:', error);
      setList([]);
      toast.error('成就列表暂时无法加载，请稍后重试');
    }
  };

  // P3：家长手动颁发"高光时刻"成就（后端 /award：颁发后不自动发奖，由孩子领取）
  const handleAward = async (item: any) => {
    if (!selectedChildId) { toast.warning('请先在上方选择要颁发的孩子'); return; }
    const ok = await confirm({ title: '颁发成就', message: `确认给该孩子颁发「${item.title}」吗？颁发后由孩子自己去领取奖励。`, confirmText: '颁发' });
    if (!ok) return;
    try {
      await api.post(`/parent/achievements/${item.id}/award`, { childId: selectedChildId });
      toast.success('已颁发，等待孩子领取');
      fetchList();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '颁发失败');
    }
  };

  const resetForm = () => {
    setTitle('');
    setDesc('');
    setIcon('🏆');
    setConditionType('task_count');
    setConditionValue('');
    setConditionCategory('');
    setAchievementCategory('启动');
    setRewardCoins('0');
    setRewardXp('0');
    setRewardPrivilegePoints('0');
    setRewardDelivery('instant');
  };

  const openCreateSheet = (useTemplates = false) => {
    resetForm();
    setShowIconPicker(false);
    setShowTemplates(useTemplates);
    setTemplateFilter('全部');
    setShowAdd(true);
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
      conditionCategory: conditionCategory || null,
      category: achievementCategory || '其他',
      rewardCoins: +rewardCoins || 0,
      rewardXp: +rewardXp || 0,
      rewardPrivilegePoints: +rewardPrivilegePoints || 0,
      rewardDelivery
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
    setAchievementCategory(item.category || '其他');
    setRewardCoins(String(item.rewardCoins || 0));
    setRewardXp(String(item.rewardXp || 0));
    setRewardPrivilegePoints(String(item.rewardPrivilegePoints || 0));
    setRewardDelivery(item.rewardDelivery === 'backpack' ? 'backpack' : 'instant');
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
      conditionCategory: conditionCategory || null,
      category: achievementCategory || '其他',
      rewardCoins: +rewardCoins || 0,
      rewardXp: +rewardXp || 0,
      rewardPrivilegePoints: +rewardPrivilegePoints || 0,
      rewardDelivery
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
    setAchievementCategory(getTemplateAchievementCategory(tpl));
    const reward = getTemplateReward(tpl);
    setRewardCoins(String(reward.coins));
    setRewardXp(String(reward.xp));
    setRewardPrivilegePoints(String(reward.privilegePoints));
    setShowTemplates(false);
  };

  // 获取条件类型显示文本
  const getConditionText = (item: any) => {
    switch (item.conditionType) {
      case 'manual': return '🎁 家长确认';
      case 'task_count': return `📋 完成 ${item.conditionValue} 个任务`;
      case 'coin_count': return `💰 获得 ${item.conditionValue} 金币`;
      case 'xp_count': return `⭐ 获得 ${item.conditionValue} 经验`;
      case 'level_reach': return `🚀 达到 ${item.conditionValue} 级`;
      case 'category_count': return `📊 完成 ${item.conditionValue} 个${item.conditionCategory || ''}任务`;
      case 'streak_days': return `🔥 连续 ${item.conditionValue} 天${item.conditionCategory ? `(${item.conditionCategory})` : ''}`;
      case 'explore_checkin_count': return `🧭 完成 ${item.conditionValue} 次探索打卡`;
      case 'explore_category_count': return `🗺️ 打卡 ${item.conditionValue} 个${item.conditionCategory ? ` ${String(item.conditionCategory).replace(/,/g, '/')} ` : ''}地点`;
      case 'explore_voice_count': return `🎙️ 留下 ${item.conditionValue} 条语音留言`;
      case 'explore_media_count': return `📷 上传 ${item.conditionValue} 次照片纪念`;
      case 'explore_confirmed_count': return `🎒 完成 ${item.conditionValue} 次家长确认探索`;
      default: return item.conditionType;
    }
  };

  // 渲染表单（新建和编辑共用）
  const renderForm = (_isEdit: boolean) => {
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
          <label className="text-xs text-gray-500 font-bold">成就分类</label>
          <select className="w-full p-2 rounded-lg border bg-white" value={achievementCategory} onChange={e => setAchievementCategory(e.target.value)}>
            {ACHIEVEMENT_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <div className="mt-1 text-[10px] text-gray-400 leading-relaxed">
            {ACHIEVEMENT_CATEGORY_HINTS[achievementCategory] || ACHIEVEMENT_CATEGORY_HINTS['其他']}
          </div>
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

        <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100">
          <div className="text-xs text-yellow-700 font-bold mb-2">达成奖励（可选）</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 font-bold">金币</label>
              <input className="w-full p-2 rounded-lg border bg-white" type="number" min="0" value={rewardCoins} onChange={e => setRewardCoins(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-bold">经验</label>
              <input className="w-full p-2 rounded-lg border bg-white" type="number" min="0" value={rewardXp} onChange={e => setRewardXp(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-bold">特权点</label>
              <input className="w-full p-2 rounded-lg border bg-white" type="number" min="0" value={rewardPrivilegePoints} onChange={e => setRewardPrivilegePoints(e.target.value)} />
            </div>
          </div>
          <div className="text-[10px] text-gray-500 mt-2">模板会自动给出建议值，家长也可以按家庭规则微调。</div>
        </div>

        <div>
          <label className="text-xs text-gray-500 font-bold">奖励领取方式</label>
          <select className="w-full p-2 rounded-lg border bg-white" value={rewardDelivery} onChange={e => setRewardDelivery(e.target.value as 'instant' | 'backpack')}>
            <option value="instant">达成时立即发放</option>
            <option value="backpack">放入孩子背包，孩子自己打开</option>
          </select>
          <div className="text-[10px] text-gray-400 mt-1">ADHD 场景建议多数成就即时发放；长期里程碑可放入背包，增加仪式感。</div>
        </div>
      </div>
    );
  };

  const groupedAchievements = list.reduce((acc, item) => {
    const group = item.category || '其他';
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  Object.values(groupedAchievements as Record<string, any[]>).forEach((items) => {
    items.sort((a, b) =>
      getLocalRank(a).order - getLocalRank(b).order ||
      Number(a.conditionValue || 0) - Number(b.conditionValue || 0) ||
      String(getLocalAchievementDisplay(a).title || '').localeCompare(String(getLocalAchievementDisplay(b).title || ''), 'zh-Hans-CN')
    );
  });

  const achievementCategoryOrder = Array.from(new Set([
    ...ACHIEVEMENT_CATEGORIES,
    ...Object.keys(groupedAchievements),
  ])).filter(cat => groupedAchievements[cat]?.length);
  const visibleAchievementCategoryOrder = achievementFilter === '全部'
    ? achievementCategoryOrder
    : achievementCategoryOrder.filter(cat => cat === achievementFilter);
  const templateCategories = Array.from(new Set(
    ACHIEVEMENT_TEMPLATES.map(tpl => getTemplateAchievementCategory(tpl))
  )).sort((a, b) => ACHIEVEMENT_CATEGORIES.indexOf(a) - ACHIEVEMENT_CATEGORIES.indexOf(b));
  const filteredTemplates = templateFilter === '全部'
    ? ACHIEVEMENT_TEMPLATES
    : ACHIEVEMENT_TEMPLATES.filter(tpl => getTemplateAchievementCategory(tpl) === templateFilter);
  const groupedTemplates = filteredTemplates.reduce((acc, tpl) => {
    const group = getTemplateAchievementCategory(tpl);
    if (!acc[group]) acc[group] = [];
    acc[group].push(tpl);
    return acc;
  }, {} as Record<string, typeof ACHIEVEMENT_TEMPLATES>);
  const unlockedCount = list.filter(item => item.unlockedAt || item.isUnlocked || item.unlocked).length;
  const categoryOverview = achievementCategoryOrder.map(cat => {
    const achievements = (groupedAchievements[cat] || []) as any[];
    const unlocked = achievements.filter(item => item.unlockedAt || item.isUnlocked || item.unlocked).length;
    return {
      cat,
      total: achievements.length,
      unlocked,
      hint: ACHIEVEMENT_CATEGORY_HINTS[cat] || ACHIEVEMENT_CATEGORY_HINTS['其他'],
    };
  });
  const currentCategoryOverview = achievementFilter === '全部'
    ? {
        cat: '全部',
        total: list.length,
        unlocked: unlockedCount,
        hint: '按分类查看孩子已经拿到哪些里程碑，也能发现哪些能力维度还没有被照顾到。',
      }
    : categoryOverview.find(item => item.cat === achievementFilter);

  return (
    <Layout>
      <Header title="成就管理" showBack onBack={() => navigate('/parent/dashboard')} />

      {/* 新建成就 - 底部抽屉 */}
      <BottomSheet
        isOpen={showAdd}
        onClose={() => { setShowAdd(false); setShowTemplates(false); resetForm(); }}
        title={showTemplates ? '📋 从模板创建成就' : '🏆 新建成就'}
        footer={
          <div className="flex gap-3">
            <Button size="sm" onClick={handleAdd} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 border-none">保存成就</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setShowTemplates(false); resetForm(); }} className="flex-1">取消</Button>
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
          <div className="mb-4 space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {['全部', ...templateCategories].map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setTemplateFilter(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
                    templateFilter === cat ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-white text-gray-500 border-gray-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="p-3 bg-gray-50 rounded-xl border max-h-72 overflow-y-auto space-y-3">
              {templateCategories.filter(cat => groupedTemplates[cat]?.length).map((cat, catIndex) => (
                <details key={cat} className="group rounded-xl bg-white border border-gray-100 overflow-hidden" open={templateFilter !== '全部' || catIndex === 0}>
                  <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between text-sm font-black text-gray-700">
                    <span>{cat}模板</span>
                    <span className="text-[10px] text-gray-400 group-open:hidden">展开</span>
                    <span className="text-[10px] text-gray-400 hidden group-open:inline">收起</span>
                  </summary>
                  <div className="px-2 pb-2 space-y-2">
                    {groupedTemplates[cat].map((tpl) => (
                      <button
                        key={`${tpl.title}-${tpl.type}-${tpl.value}`}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="w-full flex items-center gap-3 p-2 bg-gray-50 rounded-lg hover:bg-yellow-50 text-left transition-colors border border-gray-100"
                      >
                        <span className="text-2xl">{tpl.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{tpl.title}</div>
                          <div className="text-xs text-gray-400 truncate">{tpl.desc}</div>
                        </div>
                        <div className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {tpl.type === 'manual' ? '确认类' :
                           tpl.type === 'streak_days' ? `${tpl.value}天` :
                           tpl.type === 'category_count' ? `${tpl.category}${tpl.value}次` :
                           `${tpl.value}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {renderForm(false)}
      </BottomSheet>

      <BottomSheet
        isOpen={Boolean(editingAchievement)}
        onClose={cancelEdit}
        title="🏆 编辑成就"
        footer={
          <div className="flex gap-3">
            <Button size="sm" onClick={handleSaveEdit} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 border-none">
              <Check size={16} className="mr-1"/> 保存修改
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} className="flex-1">取消</Button>
          </div>
        }
      >
        {renderForm(true)}
      </BottomSheet>

      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        <CreateActionCard
          icon="🏆"
          title="成就是孩子的里程碑"
          description="按能力分类，只保留关键节点，让孩子看见自己正在变强。"
          primaryLabel="🏆 新建成就"
          onPrimary={() => openCreateSheet(false)}
          primaryClassName="bg-gradient-to-r from-yellow-500 to-orange-500 border-none"
          secondaryLabel="从模板创建"
          secondaryIcon={<Sparkles size={15} />}
          onSecondary={() => openCreateSheet(true)}
          tone="from-yellow-50 to-orange-50 border-yellow-100"
        />

        {children.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-500">查看孩子：</span>
            {children.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelectedChildId(c.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${selectedChildId === c.id ? 'bg-yellow-500 text-white shadow' : 'bg-white border border-gray-200 text-gray-500'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-3 text-center">
            <div className="text-xl font-black text-gray-800">{list.length}</div>
            <div className="text-[10px] font-bold text-gray-400">成就总数</div>
          </div>
          <div className="rounded-2xl border border-green-100 bg-green-50 p-3 text-center">
            <div className="text-xl font-black text-green-600">{unlockedCount}</div>
            <div className="text-[10px] font-bold text-green-500">已解锁</div>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-center">
            <div className="text-xl font-black text-blue-600">{achievementCategoryOrder.length}</div>
            <div className="text-[10px] font-bold text-blue-500">分类</div>
          </div>
        </div>

        {categoryOverview.length > 0 && (
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-black text-gray-900">分类总览</div>
                <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                  每个分类代表一个成长维度，适合用来检查奖励体系是不是只偏向某一种表现。
                </div>
              </div>
              <div className="px-2 py-1 rounded-full bg-yellow-50 text-yellow-700 text-[10px] font-bold whitespace-nowrap">
                {categoryOverview.length} 类
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {categoryOverview.map(item => {
                const progress = Math.round((item.unlocked / Math.max(1, item.total)) * 100);
                const active = achievementFilter === item.cat;
                return (
                  <button
                    key={item.cat}
                    type="button"
                    onClick={() => setAchievementFilter(item.cat)}
                    className={`text-left rounded-2xl border p-3 transition-colors ${
                      active ? 'border-yellow-300 bg-yellow-50' : 'border-gray-100 bg-gray-50 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-black text-gray-800 truncate">{item.cat}</div>
                      <div className="text-[10px] font-bold text-gray-500">{item.unlocked}/{item.total}</div>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-orange-400"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[10px] text-gray-500 line-clamp-2 leading-snug">{item.hint}</div>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {achievementCategoryOrder.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['全部', ...achievementCategoryOrder].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setAchievementFilter(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
                  achievementFilter === cat ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-white text-gray-500 border-gray-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {currentCategoryOverview && categoryOverview.length > 0 && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-gray-900 truncate">
                  当前查看：{currentCategoryOverview.cat}
                </div>
                <div className="text-xs text-blue-700 mt-1 leading-relaxed">
                  {currentCategoryOverview.hint}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-lg font-black text-blue-700">{currentCategoryOverview.unlocked}/{currentCategoryOverview.total}</div>
                <div className="text-[10px] font-bold text-blue-500">已解锁</div>
              </div>
            </div>
          </div>
        )}

        {list.length === 0 && !showAdd && (
          <div className="text-center py-10 rounded-2xl border border-dashed border-gray-200 bg-white">
            <div className="text-5xl mb-3">🏆</div>
            <div className="text-gray-500 font-bold mb-1">还没有成就</div>
            <div className="text-xs text-gray-400 mb-4">先用模板建立几个清晰目标，后面再慢慢补充个性化成就。</div>
            <Button size="sm" onClick={() => openCreateSheet(true)}>
              使用模板快速创建
            </Button>
          </div>
        )}

        {visibleAchievementCategoryOrder.map((cat, index) => (
          <details
            key={cat}
            className="group rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden"
            open={achievementFilter !== '全部' || index === 0}
          >
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-black text-gray-800">{cat}成就</div>
                <div className="text-[10px] font-bold text-gray-400">{groupedAchievements[cat].length} 个里程碑</div>
                <div className="mt-1 text-[10px] text-gray-500 leading-snug max-w-[260px]">
                  {ACHIEVEMENT_CATEGORY_HINTS[cat] || ACHIEVEMENT_CATEGORY_HINTS['其他']}
                </div>
              </div>
              <span className="text-[10px] text-gray-400 group-open:hidden">展开</span>
              <span className="text-[10px] text-gray-400 hidden group-open:inline">收起</span>
            </summary>
            <div className="space-y-2 px-2 pb-3">
            {groupedAchievements[cat].map((item: any) => {
              const rewardText = getRewardText(item);
              const isUnlocked = item.unlockedAt || item.isUnlocked || item.unlocked;
              const display = getLocalAchievementDisplay(item);
              const displayTitle = display.title;
              const displayDescription = display.description;
              const displayIcon = display.icon;
              const rank = display.rank;
              const showConditionChip = item.conditionType === 'manual';
              return (
                <Card key={item.id} className="flex justify-between items-center hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                      {displayIcon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-bold text-gray-800 truncate">{displayTitle}</div>
                        {rank.label && (
                          <span className="px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500 text-[9px] font-black whitespace-nowrap">
                            {rank.icon || displayIcon} {rank.label}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{displayDescription}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {showConditionChip && (
                          <div className="text-[10px] text-blue-600 bg-blue-50 inline-block px-2 py-0.5 rounded-full font-medium">
                            {getConditionText(item)}
                          </div>
                        )}
                        {rewardText && (
                          <div className="text-[10px] text-yellow-700 bg-yellow-50 inline-block px-2 py-0.5 rounded-full font-medium">
                            奖励 {rewardText}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(() => {
                      const claimable = item.rewardClaimable;
                      const target = Number(item.conditionValue || 0);
                      const cls = isUnlocked ? (claimable ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600') : 'bg-gray-50 text-gray-400';
                      const label = isUnlocked
                        ? (claimable ? '待领取' : '已完成')
                        : (target > 0 ? `进行中 ${Math.min(Number(item.progress || 0), target)}/${target}` : '进行中');
                      return <div className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>{label}</div>;
                    })()}
                    {item.conditionType === 'manual' && !isUnlocked && selectedChildId && (
                      <button onClick={() => handleAward(item)} className="px-2 py-1 rounded-full text-[10px] font-bold bg-purple-500 text-white hover:bg-purple-600 transition-colors whitespace-nowrap">
                        颁发
                      </button>
                    )}
                    <button onClick={() => openEdit(item)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                      <Pen size={16}/>
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </Card>
              );
            })}
            </div>
          </details>
        ))}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
