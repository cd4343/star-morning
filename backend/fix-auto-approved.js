/**
 * 修复被错误自动审批的任务
 * 
 * 使用方法：
 * 1. 在服务器上进入 backend 目录
 * 2. 运行: node fix-auto-approved.js
 * 
 * 这个脚本会：
 * 1. 找出今天（北京时间）被错误审批的任务
 * 2. 将它们的状态从 approved 改回 pending
 * 3. 扣除已发放的金币和经验
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

// 北京时间偏移（UTC+8）
const BEIJING_OFFSET = 8 * 60; // 分钟

function getBeijingDate(date = new Date()) {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  return new Date(utc + (BEIJING_OFFSET * 60000));
}

function getBeijingDateString(date = new Date()) {
  const beijingDate = getBeijingDate(date);
  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function main() {
  const dbPath = path.join(__dirname, 'stellar.db');
  
  console.log('📂 打开数据库:', dbPath);
  
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  const todayBeijing = getBeijingDateString();
  console.log(`📅 今天日期（北京时间）: ${todayBeijing}`);
  console.log(`🕐 当前北京时间: ${getBeijingDate().toISOString()}`);

  // 查找今天（北京时间）提交但已被审批的任务
  const allApproved = await db.all(`
    SELECT te.id, te.taskId, te.childId, te.submittedAt, te.earnedCoins, te.earnedXp, t.title
    FROM task_entries te
    JOIN tasks t ON te.taskId = t.id
    WHERE te.status = 'approved'
    ORDER BY te.submittedAt DESC
  `);

  // 筛选出今天（北京时间）提交的任务
  const wronglyApproved = allApproved.filter(entry => {
    const submitDate = new Date(entry.submittedAt);
    const submitDateBeijing = getBeijingDateString(submitDate);
    return submitDateBeijing === todayBeijing;
  });

  console.log(`\n📊 找到 ${wronglyApproved.length} 个今天提交并被审批的任务:`);
  
  if (wronglyApproved.length === 0) {
    console.log('✅ 没有需要恢复的任务');
    await db.close();
    return;
  }

  for (const entry of wronglyApproved) {
    const submitDateBeijing = getBeijingDateString(new Date(entry.submittedAt));
    console.log(`  - ID: ${entry.id.substring(0, 8)}...`);
    console.log(`    任务: ${entry.title}`);
    console.log(`    提交时间(UTC): ${entry.submittedAt}`);
    console.log(`    提交日期(北京): ${submitDateBeijing}`);
    console.log(`    已发放: ${entry.earnedCoins}金币, ${entry.earnedXp}经验`);
  }

  // 询问确认
  console.log('\n⚠️  以上任务将被恢复为待审核状态，已发放的金币和经验将被扣除。');
  console.log('⚠️  请确认这些确实是被错误自动审批的任务！\n');

  // 在脚本中直接执行恢复
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('是否继续恢复？(输入 yes 确认): ', async (answer) => {
    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ 操作已取消');
      rl.close();
      await db.close();
      return;
    }

    console.log('\n🔄 开始恢复任务...\n');

    for (const entry of wronglyApproved) {
      try {
        // 1. 将任务状态改回 pending
        await db.run(`
          UPDATE task_entries 
          SET status = 'pending', earnedCoins = 0, earnedXp = 0, rewardXp = 0, reviewedAt = NULL
          WHERE id = ?
        `, entry.id);

        // 2. 扣除已发放的金币和经验
        const coins = entry.earnedCoins || 0;
        const xp = entry.earnedXp || 0;
        
        if (coins > 0 || xp > 0) {
          await db.run(`
            UPDATE users SET coins = coins - ?, xp = xp - ? WHERE id = ?
          `, coins, xp, entry.childId);
        }

        console.log(`✅ 已恢复: ${entry.title}`);
        console.log(`   扣除: ${coins}金币, ${xp}经验`);
      } catch (error) {
        console.error(`❌ 恢复失败: ${entry.title}`, error);
      }
    }

    console.log('\n✅ 恢复完成！');
    console.log('📋 这些任务现在处于待审核状态，家长可以手动审批。');

    rl.close();
    await db.close();
  });
}

main().catch(console.error);

