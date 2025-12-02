import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';

const API_URL = 'http://localhost:3001/api';
let parentToken = '';
let childToken = '';
let familyId = '';
let parentId = '';
let childId = '';
let taskId = '';

// 启动后端服务器
// console.log('🚀 正在启动后端服务器进行测试...');
// const server = spawn('npx', ['ts-node', 'src/server.ts'], {
//   cwd: path.join(__dirname, '..'),
//   shell: true,
//   env: { ...process.env, PORT: '3001' }
// });

// 等待服务器启动
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const runTest = async () => {
  try {
    // await wait(5000); // 等待5秒确保服务器启动
    console.log('✅ 假设服务器已启动，开始测试 API 流程...\n');

    // 1. 注册家长
    console.log('👉 1. 测试注册家长...');
    const email = `test_parent_${Date.now()}@example.com`;
    const regRes = await axios.post(`${API_URL}/auth/register`, {
      email,
      password: 'password123'
    });
    parentToken = regRes.data.token;
    console.log('   ✅ 注册成功，Token获取:', parentToken.slice(0, 10) + '...');

    // 2. 创建家庭
    console.log('👉 2. 测试创建家庭...');
    const familyRes = await axios.post(`${API_URL}/auth/create-family`, {
      familyName: '测试家庭',
      childName: '测试小宝'
    }, { headers: { Authorization: `Bearer ${parentToken}` } });
    parentToken = familyRes.data.token; // 更新为正式 Token
    console.log('   ✅ 家庭创建成功');

    // 3. 获取成员列表 (找到孩子ID)
    console.log('👉 3. 获取家庭成员...');
    const membersRes = await axios.get(`${API_URL}/auth/members`, {
      headers: { Authorization: `Bearer ${parentToken}` }
    });
    const members = membersRes.data;
    const child = members.find((m: any) => m.role === 'child');
    const parent = members.find((m: any) => m.role === 'parent');
    childId = child.id;
    parentId = parent.id;
    console.log(`   ✅ 找到成员: 家长(${parent.name}), 孩子(${child.name})`);

    // 4. 切换到孩子身份
    console.log('👉 4. 切换到孩子身份...');
    const switchRes = await axios.post(`${API_URL}/auth/switch-user`, {
      targetUserId: childId
    }, { headers: { Authorization: `Bearer ${parentToken}` } });
    childToken = switchRes.data.token;
    console.log('   ✅ 孩子 Token 获取成功');

    // 5. 家长创建任务
    console.log('👉 5. 家长创建任务...');
    await axios.post(`${API_URL}/parent/tasks`, {
      title: '测试任务-扫地',
      coinReward: 10,
      xpReward: 10,
      durationMinutes: 15,
      category: '劳动',
      frequency: { type: 'daily' }
    }, { headers: { Authorization: `Bearer ${parentToken}` } });
    console.log('   ✅ 任务创建成功');

    // 6. 孩子获取任务列表
    console.log('👉 6. 孩子查看任务...');
    const childDashRes = await axios.get(`${API_URL}/child/dashboard`, {
      headers: { Authorization: `Bearer ${childToken}` }
    });
    const task = childDashRes.data.tasks.find((t: any) => t.title === '测试任务-扫地');
    taskId = task.id;
    console.log(`   ✅ 孩子看到了任务: ${task.title} (ID: ${taskId})`);

    // 7. 孩子完成任务
    console.log('👉 7. 孩子提交任务...');
    await axios.post(`${API_URL}/child/tasks/${taskId}/complete`, {}, {
      headers: { Authorization: `Bearer ${childToken}` }
    });
    console.log('   ✅ 任务提交成功，状态: pending');

    // 8. 家长查看待审核
    console.log('👉 8. 家长查看审核列表...');
    const parentDashRes = await axios.get(`${API_URL}/parent/dashboard`, {
      headers: { Authorization: `Bearer ${parentToken}` }
    });
    const reviewItem = parentDashRes.data.pendingReviews.find((r: any) => r.title === '测试任务-扫地');
    console.log(`   ✅ 家长看到了待审核任务: ${reviewItem.title}`);

    // 9. 家长通过审核
    console.log('👉 9. 家长通过审核...');
    const approveRes = await axios.post(`${API_URL}/parent/review/${reviewItem.id}`, {
      action: 'approve'
    }, { headers: { Authorization: `Bearer ${parentToken}` } });
    console.log(`   ✅ 审核通过: ${approveRes.data.message}`);

    // 10. 验证孩子金币增加
    console.log('👉 10. 验证数据持久化 (孩子金币)...');
    const finalChildRes = await axios.get(`${API_URL}/child/dashboard`, {
      headers: { Authorization: `Bearer ${childToken}` }
    });
    const coins = finalChildRes.data.child.coins;
    console.log(`   ✅ 孩子当前金币: ${coins} (预期: 10)`);
    
    if (coins === 10) {
        console.log('\n🎉🎉🎉 完整流程测试通过！数据读写功能正常！ 🎉🎉🎉');
    } else {
        console.error('❌ 金币数值不对，测试失败');
    }

  } catch (error: any) {
    console.error('❌ 测试过程中出错:', error.message);
    if (error.response) {
        console.error('   状态码:', error.response.status);
        console.error('   响应数据:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    // server.kill(); // 关闭服务器
    process.exit();
  }
};

runTest();

