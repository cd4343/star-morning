import bcrypt from 'bcryptjs';
import type { Database } from 'sqlite';
import {
  createSmsProvider,
  type SmsProvider,
  type SmsPurpose,
} from './smsProvider';

const SMS_RESEND_SECONDS = 60;
const SMS_MAX_PER_HOUR = 5;
const SMS_MAX_PER_DAY = 10;
const SMS_MAX_ATTEMPTS = 5;

export type SmsVerificationResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export type SmsSendAllowance =
  | { ok: true }
  | {
      ok: false;
      reason: 'resend' | 'hourly-limit' | 'daily-limit';
      retryAfterSeconds?: number;
    };

export const getSmsSendAllowance = async (
  db: Database,
  phone: string,
  purpose: SmsPurpose,
  now = new Date()
): Promise<SmsSendAllowance> => {
  const latest = await db.get(
    `SELECT createdAt FROM auth_sms_codes
     WHERE phone = ? AND purpose = ?
     ORDER BY julianday(createdAt) DESC
     LIMIT 1`,
    phone,
    purpose
  );
  if (latest?.createdAt) {
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(latest.createdAt).getTime()) / 1000)
    );
    if (ageSeconds < SMS_RESEND_SECONDS) {
      return {
        ok: false,
        reason: 'resend',
        retryAfterSeconds: SMS_RESEND_SECONDS - ageSeconds,
      };
    }
  }

  const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [hourly, daily] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS count FROM auth_sms_codes
       WHERE phone = ? AND purpose = ? AND julianday(createdAt) >= julianday(?)`,
      phone,
      purpose,
      hourStart
    ),
    db.get(
      `SELECT COUNT(*) AS count FROM auth_sms_codes
       WHERE phone = ? AND purpose = ? AND julianday(createdAt) >= julianday(?)`,
      phone,
      purpose,
      dayStart
    ),
  ]);
  if (Number(hourly?.count || 0) >= SMS_MAX_PER_HOUR) {
    return { ok: false, reason: 'hourly-limit' };
  }
  if (Number(daily?.count || 0) >= SMS_MAX_PER_DAY) {
    return { ok: false, reason: 'daily-limit' };
  }
  return { ok: true };
};

export const verifyStoredSmsCode = async (
  db: Database,
  phone: string,
  code: string,
  purpose: SmsPurpose,
  getProvider: () => SmsProvider = () => createSmsProvider()
): Promise<SmsVerificationResult> => {
  const record = await db.get(
    `SELECT * FROM auth_sms_codes
     WHERE phone = ? AND purpose = ? AND consumedAt IS NULL
     ORDER BY julianday(createdAt) DESC
     LIMIT 1`,
    phone,
    purpose
  );

  if (!record) {
    return { ok: false, status: 400, message: '验证码不存在或已失效' };
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await db.run(
      'UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL',
      new Date().toISOString(),
      record.id
    );
    return { ok: false, status: 400, message: '验证码已过期，请重新获取' };
  }
  if (Number(record.attempts || 0) >= SMS_MAX_ATTEMPTS) {
    await db.run(
      'UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL',
      new Date().toISOString(),
      record.id
    );
    return { ok: false, status: 429, message: '验证码尝试次数过多，请重新获取' };
  }

  let matched: boolean;
  if (record.provider === 'aliyun-pnvs') {
    const provider = getProvider();
    if (provider.name !== 'aliyun-pnvs') {
      const error = new Error('Alibaba Cloud PNVS is not configured') as Error & { code: string };
      error.code = 'SMS_PROVIDER_NOT_CONFIGURED';
      throw error;
    }
    matched = (await provider.verify(phone, code)) === true;
  } else {
    matched = await bcrypt.compare(code, record.codeHash);
  }

  if (!matched) {
    const nextAttempts = Number(record.attempts || 0) + 1;
    const consumedAt = nextAttempts >= SMS_MAX_ATTEMPTS ? new Date().toISOString() : null;
    await db.run(
      `UPDATE auth_sms_codes
       SET attempts = ?, consumedAt = COALESCE(?, consumedAt)
       WHERE id = ? AND consumedAt IS NULL`,
      nextAttempts,
      consumedAt,
      record.id
    );
    return {
      ok: false,
      status: nextAttempts >= SMS_MAX_ATTEMPTS ? 429 : 400,
      message: nextAttempts >= SMS_MAX_ATTEMPTS
        ? '验证码尝试次数过多，请重新获取'
        : '验证码错误',
    };
  }

  const consumed = await db.run(
    'UPDATE auth_sms_codes SET consumedAt = ? WHERE id = ? AND consumedAt IS NULL',
    new Date().toISOString(),
    record.id
  );
  if (Number(consumed.changes || 0) !== 1) {
    return { ok: false, status: 400, message: '验证码不存在或已失效' };
  }
  return { ok: true };
};
