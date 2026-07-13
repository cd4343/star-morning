import { describe, expect, it } from 'vitest';
import {
  buildAchievementDisplayFields,
  hasSystemAchievementIdentityChanged,
} from './achievementDisplay';

const systemRow = (systemKey: string, title: string, icon: string) => ({
  title,
  description: '历史说明',
  icon,
  system_key: systemKey,
  is_system: 1,
});

describe('Phase 4 成就统一展示字段', () => {
  it('生活、学习、运动同为连续三天时仍返回不同名称和图标键', () => {
    const displays = [
      buildAchievementDisplayFields(systemRow('life.streak.3', '三日小当家', '🧹')),
      buildAchievementDisplayFields(systemRow('study.streak.3', '三日书声', '📅')),
      buildAchievementDisplayFields(systemRow('sport.streak.3', '连动三天', '🔥')),
    ];

    expect(displays.map(item => item.displayTitle)).toEqual(['三日小当家', '三日书声', '连动三天']);
    expect(new Set(displays.map(item => item.iconKey)).size).toBe(3);
  });

  it('系统记录以目录为准，同时保留旧图标作为降级显示', () => {
    expect(buildAchievementDisplayFields(systemRow('task.count.1', '初来乍到', '🌱'))).toEqual({
      systemKey: 'task.count.1',
      isSystem: true,
      displayTitleKey: 'achievement.system.task.count.1.title',
      displayDescriptionKey: 'achievement.system.task.count.1.description',
      displayTitle: '点亮第一步',
      displayDescription: '完成 1 个任务',
      iconKey: 'task.first-step',
      displayIcon: '🌱',
      category: '启动',
    });
  });

  it('家庭自定义和未知旧系统记录安全沿用原始内容，不会白屏或被自动改名', () => {
    expect(buildAchievementDisplayFields({
      title: '我们家的小冠军',
      description: '家庭自己的约定',
      icon: '🏅',
      category: '家庭',
      is_system: 0,
    })).toMatchObject({
      systemKey: null,
      isSystem: false,
      displayTitle: '我们家的小冠军',
      displayDescription: '家庭自己的约定',
      displayIcon: '🏅',
      category: '家庭',
    });

    expect(buildAchievementDisplayFields(systemRow('retired.unknown', '旧版纪念', '🎖️')))
      .toMatchObject({ systemKey: 'retired.unknown', isSystem: true, displayTitle: '旧版纪念', displayIcon: '🎖️' });
  });

  it('系统成就允许只改奖励，但任何身份字段变化都会被识别', () => {
    const stored = {
      title: '三日小当家', description: '旧说明', icon: '🧹', conditionType: 'streak_days',
      conditionValue: 3, conditionCategory: '生活', category: '生活',
    };
    expect(hasSystemAchievementIdentityChanged(stored, { rewardCoins: 20 })).toBe(false);
    expect(hasSystemAchievementIdentityChanged(stored, { ...stored, rewardCoins: 20 })).toBe(false);
    expect(hasSystemAchievementIdentityChanged(stored, { ...stored, title: '另一个名字' })).toBe(true);
    expect(hasSystemAchievementIdentityChanged(stored, { ...stored, conditionValue: 7 })).toBe(true);
  });
});
