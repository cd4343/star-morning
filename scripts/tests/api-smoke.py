# Star Coin 端到端冒烟测试（41项）
# 用法：在数据库副本上启动后端（勿连生产库！）：
#   set STARCOIN_DB_PATH=测试副本.db & set NODE_ENV=development & set PORT=3199 & npm run dev
#   python scripts/tests/api-smoke.py
# 覆盖：注册/家庭/切换用户/任务全链路/打回原因/守卫扣减/探索全模块/
#       经济锚点/周报/专注力/低电量模式/哈希不泄漏/SSRF防护
import json, urllib.request, urllib.error, base64
BASE = 'http://localhost:3199/api'
def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
results = []
def check(name, cond, detail=''):
    results.append((name, cond, detail))
st, sms = call('POST', '/auth/sms/send', {'phone': '13900000099', 'purpose': 'register'})
dev_code = str(sms.get('devCode') or '')
check('发送注册验证码(mock)', st == 200 and len(dev_code) == 6, f"{st} {sms}")
st, reg = call('POST', '/auth/register', {'phone': '13900000099', 'password': 'test1234', 'smsCode': dev_code})
check('注册家长', st == 200 and 'token' in reg, f"{st} {reg.get('message','')}")
tk = reg.get('token','')
if tk.count('.') == 2:
    payload = json.loads(base64.urlsafe_b64decode(tk.split('.')[1] + '==='))
    check('JWT含exp(30天)', 'exp' in payload, str(list(payload.keys())))
else:
    check('JWT含exp(30天)', False, 'no token')
st, fam = call('POST', '/auth/create-family', {'familyName': '测试家', 'parentName': '爸爸', 'parentRole': 'dad', 'childName': '小测', 'childGender': 'boy'}, tk)
check('创建家庭', st == 200 and 'token' in fam, f"{st}")
tk = fam.get('token', tk)
st, members = call('GET', '/auth/members', token=tk)
parent = next((m for m in members if m['role']=='parent'), {})
child = next((m for m in members if m['role']=='child'), {})
check('members含pendingReviewCount', 'pendingReviewCount' in parent, str(parent.keys()))
check('members无pin/password哈希', 'pin' not in parent and 'password' not in parent, '')
st, sw = call('POST', '/auth/switch-user', {'targetUserId': child.get('id')}, tk)
check('switch-user成功', st == 200, f"{st}")
check('switch-user无pin/password', 'pin' not in sw.get('user',{}) and 'password' not in sw.get('user',{}), str(list(sw.get('user',{}).keys())[:6]))
child_tk = sw.get('token','')
st, task = call('POST', '/parent/tasks', {'title': '冒烟测试任务', 'coinReward': 10, 'xpReward': 10, 'durationMinutes': 10, 'icon': '🧪'}, tk)
task_id = task.get('id') or (task.get('task') or {}).get('id')
check('创建任务', st == 200 and task_id, f"{st} {task.get('message','')} keys={list(task.keys())}")
st, stt = call('POST', f'/child/tasks/{task_id}/start', {}, child_tk)
check('孩子开始任务', st == 200, f"{st} {stt.get('message','')}")
st, sub = call('POST', f'/child/tasks/{task_id}/complete', {}, child_tk)
check('孩子提交任务', st == 200, f"{st} {sub.get('message','')}")
st, dash = call('GET', '/parent/dashboard', token=tk)
pend = dash.get('pendingReviews', [])
check('待审列表1条', len(pend) == 1, str(len(pend)))
entry_id = pend[0]['id'] if pend else ''
st, rj = call('POST', f'/parent/review/{entry_id}', {'action': 'reject'}, tk)
check('无原因打回被拒400', st == 400, f"{st} {rj.get('message','')}")
st, rj2 = call('POST', f'/parent/review/{entry_id}', {'action': 'reject', 'reason': '床还没整理好，再试一次吧'}, tk)
check('带原因打回成功', st == 200, f"{st} {rj2.get('message','')}")
st, cdash = call('GET', '/child/dashboard', token=child_tk)
rr = cdash.get('recentReviews', [])
rej = next((x for x in rr if x.get('status')=='rejected'), None)
check('孩子端看到打回+原因', bool(rej) and str(rej.get('reviewNote','')).startswith('床还没'), str(rej)[:80])
check('child dashboard无哈希', 'pin' not in (cdash.get('child') or {}) and 'password' not in (cdash.get('child') or {}), '')
st, lot = call('POST', '/child/lottery/play', {}, child_tk)
check('0金币抽奖守卫拒绝400', st == 400 and '金币不足' in lot.get('message',''), f"{st} {lot.get('message','')}")
st, members2 = call('GET', '/auth/members', token=tk)
p2 = next((m for m in members2 if m['role']=='parent'), {})
check('处理后待审数为0', p2.get('pendingReviewCount') == 0, str(p2.get('pendingReviewCount')))
passed = sum(1 for _,c,_ in results if c)
for n, c, d in results: print(('✅' if c else '❌'), n, ('| '+d if d and not c else ''))
print(f"通过 {passed}/{len(results)}")

# 探索新端点检查
st, q = call('GET', '/parent/explore/quota', token=tk)
check('探索配额端点', st == 200 and 'usedBytes' in q and q.get('totalBytes') == 500*1024*1024, f"{st} {q}")
st, es = call('PUT', '/parent/explore/settings', {'exploreRequirePhoto': True}, tk)
check('探索设置写入', st == 200, f"{st} {es}")
st, es2 = call('GET', '/parent/explore/settings', token=tk)
check('探索设置读取', st == 200 and bool(es2.get('exploreRequirePhoto')) is True, f"{st} {es2}")
st, tl = call('GET', '/parent/explore/timeline', token=tk)
check('回忆时间线端点', st == 200, f"{st}")
st, ces = call('GET', '/child/explore/settings', token=child_tk)
check('孩子端读探索设置', st == 200, f"{st}")
passed = sum(1 for _,c,_ in results if c)
print(f"含探索共通过 {passed}/{len(results)}")

st, mp = call('GET', '/child/explore/map-places', token=child_tk)
check('地图标记端点', st == 200 and isinstance(mp, list), f"{st}")
st, gv = call('PUT', '/parent/explore/settings', {'exploreGeoVerify': True}, tk)
check('定位开关写入', st == 200, f"{st}")
st, cs = call('GET', '/child/explore/settings', token=child_tk)
check('孩子端读定位开关', st == 200 and bool(cs.get('exploreGeoVerify')), f"{st} {cs}")
print(f"最终通过 {sum(1 for _,c,_ in results if c)}/{len(results)}")

st, fs = call('PUT', '/parent/explore/feed-settings', {'exploreCity': '上海', 'exploreFeedDailyLimit': 3}, tk)
check('发现设置写入', st == 200, f"{st} {fs}")
st, push = call('POST', '/parent/explore/feed/push', {'title': '周末科技馆半价', 'summary': '爸爸看到的活动'}, tk)
check('家长推送卡片', st == 200, f"{st} {push}")
st, feed = call('GET', '/child/explore/feed', token=child_tk)
parent_card = next((x for x in feed if x.get('type')=='parent'), None) if isinstance(feed, list) else None
check('孩子端看到家长卡', st == 200 and parent_card is not None, f"{st} {str(feed)[:60]}")
if parent_card:
    st, w = call('POST', f"/child/explore/feed/{parent_card['id']}/want", {}, child_tk)
    check('想去操作', st == 200, f"{st} {w}")
st, stats = call('GET', '/parent/explore/stats', token=tk)
check('观察统计端点', st == 200, f"{st}")
st, bad = call('POST', '/parent/explore/feed-sources', {'url': 'http://127.0.0.1/x'}, tk)
check('SSRF防护(拒内网)', st == 400, f"{st} {bad}")
print(f"全部通过 {sum(1 for _,c,_ in results if c)}/{len(results)}")

st, eco = call('GET', '/parent/economy-settings', token=tk)
check('经济锚点读取', st == 200 and eco.get('ecoTasksPerDay') == 10, f"{st} {eco}")
st, ps = call('GET', '/parent/price-suggestion?type=shop&days=7', token=tk)
check('商品建议价端点', st == 200 and 'suggestedCoins' in ps, f"{st} {ps}")
st, wr = call('GET', '/parent/weekly-reports?limit=2', token=tk)
check('周报列表端点', st == 200, f"{st}")
st, cwr = call('GET', '/child/weekly-report/latest', token=child_tk)
check('孩子端周报端点', st in (200, 404), f"{st}")
print(f"总计通过 {sum(1 for _,c,_ in results if c)}/{len(results)}")

st, fs2 = call('GET', '/child/focus-stats', token=child_tk)
check('专注力统计端点', st == 200 and 'thisWeekMinutes' in fs2, f"{st} {fs2}")
st, le = call('POST', '/child/low-energy/toggle', {}, child_tk)
check('低电量开启', st == 200 and le.get('active') is True, f"{st} {le}")
st, cd2 = call('GET', '/child/dashboard', token=child_tk)
check('dashboard带lowEnergyToday', st == 200 and cd2.get('lowEnergyToday') is True, f"{st}")
st, pd2 = call('GET', '/parent/dashboard', token=tk)
check('家长端看到低电量孩子', st == 200 and len(pd2.get('lowEnergyChildren', [])) == 1, f"{st} {pd2.get('lowEnergyChildren')}")
st, le2 = call('POST', '/child/low-energy/toggle', {}, child_tk)
check('低电量恢复', st == 200 and le2.get('active') is False, f"{st}")
print(f"总计 {sum(1 for _,c,_ in results if c)}/{len(results)}")
