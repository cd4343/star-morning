import { describe, expect, it, vi } from 'vitest';
import { createSmsProvider } from './smsProvider';

const aliyunEnv = {
  NODE_ENV: 'production',
  SMS_PROVIDER: 'aliyun-pnvs',
  ALIBABA_CLOUD_ACCESS_KEY_ID: 'test-id',
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'test-secret',
  ALIYUN_PNVS_SIGN_NAME: '恒创联众',
  ALIYUN_PNVS_TEMPLATE_CODE: '100001',
};

describe('SMS providers', () => {
  it('keeps mock codes local and exposes them only when explicitly enabled', async () => {
    const hidden = createSmsProvider({ NODE_ENV: 'test', SMS_PROVIDER: 'mock' });
    const visible = createSmsProvider({
      NODE_ENV: 'test',
      SMS_PROVIDER: 'mock',
      SMS_EXPOSE_DEV_CODE: 'true',
    });

    const hiddenResult = await hidden.send('13800138000', 'register', 'hidden');
    const visibleResult = await visible.send('13800138000', 'register', 'visible');

    expect(hiddenResult.localCode).toMatch(/^\d{6}$/);
    expect(hiddenResult.devCode).toBeUndefined();
    expect(visibleResult.devCode).toMatch(/^\d{6}$/);
    expect(await visible.verify('13800138000', '123456')).toBeNull();
  });

  it('fails closed when production SMS is not configured', () => {
    expect(() => createSmsProvider({ NODE_ENV: 'production' })).toThrow(
      expect.objectContaining({ code: 'SMS_PROVIDER_NOT_CONFIGURED' })
    );
  });

  it('sends through Alibaba PNVS with the approved template and no local code', async () => {
    const sendSmsVerifyCode = vi.fn().mockResolvedValue({
      body: {
        code: 'OK',
        success: true,
        model: { bizId: 'biz-123' },
      },
    });
    const provider = createSmsProvider(aliyunEnv, () => ({
      sendSmsVerifyCode,
      checkSmsVerifyCode: vi.fn(),
    }));

    const result = await provider.send('13800138000', 'register', 'request-1');

    expect(sendSmsVerifyCode).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: '13800138000',
      countryCode: '86',
      signName: '恒创联众',
      templateCode: '100001',
      templateParam: '{"code":"##code##","min":"5"}',
      codeLength: 6,
      codeType: 1,
      validTime: 300,
      interval: 60,
      duplicatePolicy: 1,
      outId: 'request-1',
      returnVerifyCode: false,
    }));
    expect(result).toEqual({ provider: 'aliyun-pnvs', bizId: 'biz-123' });
  });

  it('accepts only PASS from Alibaba PNVS and rejects provider errors loudly', async () => {
    const checkSmsVerifyCode = vi.fn()
      .mockResolvedValueOnce({ body: { code: 'OK', success: true, model: { verifyResult: 'PASS' } } })
      .mockResolvedValueOnce({ body: { code: 'OK', success: true, model: { verifyResult: 'UNKNOWN' } } })
      .mockResolvedValueOnce({ body: { code: 'AUTH_FAILED', success: false, message: 'denied' } });
    const provider = createSmsProvider(aliyunEnv, () => ({
      sendSmsVerifyCode: vi.fn(),
      checkSmsVerifyCode,
    }));

    await expect(provider.verify('13800138000', '123456')).resolves.toBe(true);
    await expect(provider.verify('13800138000', '654321')).resolves.toBe(false);
    await expect(provider.verify('13800138000', '111111')).rejects.toMatchObject({
      code: 'SMS_PROVIDER_VERIFY_FAILED',
    });
  });
});
