import { randomInt } from 'crypto';
import DypnsapiClient, {
  CheckSmsVerifyCodeRequest,
  SendSmsVerifyCodeRequest,
} from '@alicloud/dypnsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';

export type SmsPurpose = 'login' | 'register' | 'reset-password';
export type SmsProviderName = 'mock' | 'http' | 'aliyun-pnvs';

export type SmsSendResult = {
  provider: SmsProviderName;
  bizId?: string;
  localCode?: string;
  devCode?: string;
};

export type SmsProvider = {
  name: SmsProviderName;
  send(phone: string, purpose: SmsPurpose, outId: string): Promise<SmsSendResult>;
  verify(phone: string, code: string): Promise<boolean | null>;
};

type AliyunClient = Pick<DypnsapiClient, 'sendSmsVerifyCode' | 'checkSmsVerifyCode'>;
type AliyunClientFactory = (config: $OpenApiUtil.Config) => AliyunClient;

const providerError = (code: string, message: string) => {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
};

const generateLocalCode = () => String(randomInt(100000, 1000000));

const defaultAliyunClientFactory: AliyunClientFactory = config => new DypnsapiClient(config);

export const createSmsProvider = (
  env: NodeJS.ProcessEnv = process.env,
  createAliyunClient: AliyunClientFactory = defaultAliyunClientFactory
): SmsProvider => {
  const configuredName = String(
    env.SMS_PROVIDER || (env.NODE_ENV === 'production' ? '' : 'mock')
  ).toLowerCase();

  if (configuredName === 'mock') {
    return {
      name: 'mock',
      async send() {
        const localCode = generateLocalCode();
        return {
          provider: 'mock',
          localCode,
          devCode: env.SMS_EXPOSE_DEV_CODE === 'true' ? localCode : undefined,
        };
      },
      async verify() {
        return null;
      },
    };
  }

  if (configuredName === 'http') {
    const url = env.SMS_HTTP_URL;
    if (!url) {
      throw providerError('SMS_PROVIDER_NOT_CONFIGURED', 'SMS_HTTP_URL is not configured');
    }

    return {
      name: 'http',
      async send(phone, purpose) {
        const localCode = generateLocalCode();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (env.SMS_HTTP_TOKEN) headers.Authorization = `Bearer ${env.SMS_HTTP_TOKEN}`;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ phone, code: localCode, purpose }),
        });
        if (!response.ok) {
          throw providerError('SMS_PROVIDER_SEND_FAILED', `SMS HTTP provider returned ${response.status}`);
        }
        return { provider: 'http', localCode };
      },
      async verify() {
        return null;
      },
    };
  }

  if (configuredName === 'aliyun-pnvs') {
    const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const signName = env.ALIYUN_PNVS_SIGN_NAME;
    const templateCode = env.ALIYUN_PNVS_TEMPLATE_CODE;
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      throw providerError(
        'SMS_PROVIDER_NOT_CONFIGURED',
        'Alibaba Cloud PNVS credentials, sign name, or template code are missing'
      );
    }

    const client = createAliyunClient(new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: 'dypnsapi.aliyuncs.com',
      regionId: 'cn-hangzhou',
      connectTimeout: 5000,
      readTimeout: 8000,
    }));

    return {
      name: 'aliyun-pnvs',
      async send(phone, _purpose, outId) {
        try {
          const response = await client.sendSmsVerifyCode(new SendSmsVerifyCodeRequest({
            phoneNumber: phone,
            countryCode: '86',
            signName,
            templateCode,
            templateParam: '{"code":"##code##","min":"5"}',
            codeLength: 6,
            codeType: 1,
            validTime: 300,
            interval: 60,
            duplicatePolicy: 1,
            outId,
            returnVerifyCode: false,
          }));
          if (response.body?.code !== 'OK' || response.body.success === false) {
            throw providerError(
              'SMS_PROVIDER_SEND_FAILED',
              response.body?.message || 'Alibaba Cloud PNVS rejected the SMS request'
            );
          }
          return {
            provider: 'aliyun-pnvs',
            bizId: response.body.model?.bizId,
          };
        } catch (error) {
          if ((error as { code?: string }).code === 'SMS_PROVIDER_SEND_FAILED') throw error;
          throw providerError('SMS_PROVIDER_SEND_FAILED', 'Alibaba Cloud PNVS SMS request failed');
        }
      },
      async verify(phone, code) {
        try {
          const response = await client.checkSmsVerifyCode(new CheckSmsVerifyCodeRequest({
            phoneNumber: phone,
            countryCode: '86',
            verifyCode: code,
            caseAuthPolicy: 1,
          }));
          if (response.body?.code !== 'OK' || response.body.success === false) {
            throw providerError(
              'SMS_PROVIDER_VERIFY_FAILED',
              response.body?.message || 'Alibaba Cloud PNVS rejected the verification request'
            );
          }
          return response.body.model?.verifyResult === 'PASS';
        } catch (error) {
          if ((error as { code?: string }).code === 'SMS_PROVIDER_VERIFY_FAILED') throw error;
          throw providerError('SMS_PROVIDER_VERIFY_FAILED', 'Alibaba Cloud PNVS verification failed');
        }
      },
    };
  }

  throw providerError('SMS_PROVIDER_NOT_CONFIGURED', 'SMS provider is not configured');
};
