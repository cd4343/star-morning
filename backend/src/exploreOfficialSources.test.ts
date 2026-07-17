import { describe, expect, it } from 'vitest';
import {
  parseNationalPublicCultureActivities,
  parseShanghaiLibraryActivities,
  parseShanghaiMuseumActivities,
} from './exploreOfficialSources';

const now = new Date('2026-07-17T04:00:00.000Z');

describe('official Explore activity adapters', () => {
  it('keeps only current city-specific family activities from National Public Culture Cloud', () => {
    const candidates = parseNationalPublicCultureActivities({
      returnCode: 1,
      returnData: [
        {
          id: 1,
          resName: '成都青少年非遗体验日',
          resDesc: '面向青少年的非遗手作体验',
          areaName: '成都市',
          venueName: '成都文化馆',
          topicStartTime: '2026-07-20',
          topicEndTime: '2026-07-20',
          poster: 'https://img.example.com/chengdu.jpg',
          topicPcUrl: 'https://www.culturedc.cn/activity/1',
          categoryName: '各地活动',
          labelNames: '青少年,非遗',
        },
        {
          id: 2,
          resName: '四川省群众文化展演',
          resDesc: '省级群众文化活动',
          areaName: '四川',
          venueName: '省文化馆',
          topicStartTime: '2026-07-20',
          topicEndTime: '2026-07-20',
          poster: 'https://img.example.com/sichuan.jpg',
          topicPcUrl: 'https://www.culturedc.cn/activity/2',
        },
        {
          id: 3,
          resName: '成都过期亲子活动',
          resDesc: '已经结束',
          areaName: '成都市',
          venueName: '成都文化馆',
          topicStartTime: '2026-06-01',
          topicEndTime: '2026-06-02',
          poster: 'https://img.example.com/old.jpg',
          topicPcUrl: 'https://www.culturedc.cn/activity/3',
        },
      ],
    }, '成都', now);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: '1',
      sourceKey: 'national-public-culture-cloud',
      trustTier: 'B',
      title: '成都青少年非遗体验日',
      city: '成都',
      venue: '成都文化馆',
      activityStart: '2026-07-20',
    });
  });

  it('parses Shanghai Museum facts and excludes adult-only or ended events', () => {
    const html = `
      <div class="list-item">
        <a onclick="toLoad(318)" class="item-title font-medium ellipsis">共创世界树：古代美洲亲子工坊</a>
        <img class="list-img" src="/sheduplatform/static/photos/child.jpg">
        <span class="font-light">时间：2026-07-19 Sun 14:00-16:00</span>
        <span class="font-light">场馆：人民广场馆</span>
        <span class="font-light">地点：观众活动中心</span>
        <span class="font-light">主讲人：李老师</span>
        <span class="font-light">参与年龄段：8-14</span>
      </div>
      <div class="list-item">
        <a onclick="toLoad(319)" class="item-title font-medium ellipsis">成人考古讲座</a>
        <img class="list-img" src="/sheduplatform/static/photos/adult.jpg">
        <span class="font-light">时间：2026-07-20 Mon 14:00-16:00</span>
        <span class="font-light">场馆：东馆</span>
        <span class="font-light">地点：学术报告厅</span>
        <span class="font-light">参与年龄段：18-100</span>
      </div>`;

    const candidates = parseShanghaiMuseumActivities(html, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: '318',
      sourceKey: 'shanghai-museum-events',
      trustTier: 'S',
      city: '上海',
      district: '黄浦区',
      ageMin: 8,
      ageMax: 14,
    });
    expect(candidates[0].imageUrl).toBe('https://events.shanghaimuseum.net/sheduplatform/static/photos/child.jpg');
  });

  it('parses only family-relevant current Shanghai Library activities', () => {
    const html = `
      <div class="activity-list-item">
        <div class="activity-list-item-img" style="background-image:url(https://reg.library.sh.cn/child.jpg);">
          <div class="activity-list-item-label">东馆</div>
        </div>
        <div class="activity-list-item-title">【阅推活动】少年述史・馆员论典<div class="activity-list-item-tag">即将开始</div></div>
        <div class="activity-list-item-address">上图东馆4F地方文献馆（上海市浦东新区迎春路300号）</div>
        <div class="activity-list-item-date">2026年07月18日14:00 - 14:45</div>
      </div>
      <div class="activity-list-item">
        <div class="activity-list-item-img" style="background-image:url(https://reg.library.sh.cn/adult.jpg);"></div>
        <div class="activity-list-item-title">成人学术转型讲座</div>
        <div class="activity-list-item-address">上海图书馆东馆7楼</div>
        <div class="activity-list-item-date">2026年07月18日14:00 - 17:00</div>
      </div>`;

    const candidates = parseShanghaiLibraryActivities(html, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceKey: 'shanghai-library-activities',
      title: '【阅推活动】少年述史・馆员论典',
      city: '上海',
      district: '浦东新区',
      activityStart: '2026-07-18',
    });
  });
});
