import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSmsSendAllowance,
  verifyStoredSmsCode,
} from './smsVerification';

describe('SMS verification records', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE auth_sms_codes (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        purpose TEXT NOT NULL,
        codeHash TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        expiresAt DATETIME NOT NULL,
        consumedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        provider TEXT NOT NULL DEFAULT 'local',
        providerBizId TEXT
      );
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it('consumes a local code exactly once so retries cannot authenticate twice', async () => {
    const codeHash = await bcrypt.hash('123456', 4);
    await db.run(
      `INSERT INTO auth_sms_codes (id, phone, purpose, codeHash, expiresAt)
       VALUES ('local-1', '13800138000', 'register', ?, ?)`,
      codeHash,
      '2099-01-01T00:00:00.000Z'
    );

    await expect(verifyStoredSmsCode(db, '13800138000', '123456', 'register'))
      .resolves.toEqual({ ok: true });
    await expect(verifyStoredSmsCode(db, '13800138000', '123456', 'register'))
      .resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('does not count Alibaba service failures as wrong-code attempts', async () => {
    await db.run(
      `INSERT INTO auth_sms_codes
         (id, phone, purpose, codeHash, expiresAt, provider, providerBizId)
       VALUES ('cloud-1', '13800138000', 'login', '', ?, 'aliyun-pnvs', 'biz-1')`,
      '2099-01-01T00:00:00.000Z'
    );
    const provider = {
      name: 'aliyun-pnvs' as const,
      send: vi.fn(),
      verify: vi.fn().mockRejectedValue(
        Object.assign(new Error('network'), { code: 'SMS_PROVIDER_VERIFY_FAILED' })
      ),
    };

    await expect(verifyStoredSmsCode(
      db,
      '13800138000',
      '123456',
      'login',
      () => provider
    )).rejects.toMatchObject({ code: 'SMS_PROVIDER_VERIFY_FAILED' });
    expect((await db.get('SELECT attempts FROM auth_sms_codes WHERE id = ?', 'cloud-1')).attempts)
      .toBe(0);
  });

  it('enforces resend, hourly, and rolling daily limits per phone and purpose', async () => {
    const now = new Date('2026-07-24T06:00:00.000Z');
    for (let index = 0; index < 10; index += 1) {
      const createdAt = new Date(now.getTime() - (index + 1) * 2 * 60 * 60 * 1000).toISOString();
      await db.run(
        `INSERT INTO auth_sms_codes
           (id, phone, purpose, codeHash, expiresAt, consumedAt, createdAt)
         VALUES (?, '13800138000', 'register', 'hash', ?, ?, ?)`,
        `daily-${index}`,
        '2099-01-01T00:00:00.000Z',
        createdAt,
        createdAt
      );
    }
    await expect(getSmsSendAllowance(db, '13800138000', 'register', now))
      .resolves.toMatchObject({ ok: false, reason: 'daily-limit' });

    await db.run('DELETE FROM auth_sms_codes');
    for (let index = 0; index < 5; index += 1) {
      const createdAt = new Date(now.getTime() - (index + 1) * 2 * 60 * 1000).toISOString();
      await db.run(
        `INSERT INTO auth_sms_codes
           (id, phone, purpose, codeHash, expiresAt, consumedAt, createdAt)
         VALUES (?, '13800138000', 'register', 'hash', ?, ?, ?)`,
        `hourly-${index}`,
        '2099-01-01T00:00:00.000Z',
        createdAt,
        createdAt
      );
    }
    await expect(getSmsSendAllowance(db, '13800138000', 'register', now))
      .resolves.toMatchObject({ ok: false, reason: 'hourly-limit' });

    await db.run('DELETE FROM auth_sms_codes');
    await db.run(
      `INSERT INTO auth_sms_codes
         (id, phone, purpose, codeHash, expiresAt, createdAt)
       VALUES ('recent', '13800138000', 'register', 'hash', ?, ?)`,
      '2099-01-01T00:00:00.000Z',
      new Date(now.getTime() - 10_000).toISOString()
    );
    await expect(getSmsSendAllowance(db, '13800138000', 'register', now))
      .resolves.toMatchObject({ ok: false, reason: 'resend', retryAfterSeconds: 50 });
  });
});
