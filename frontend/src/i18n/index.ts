// 最小 i18n 骨架：当前仅 zh-CN。新代码的用户可见字符串必须走 t()，
// 存量字符串按页面分批迁移（见 docs/REQUIREMENTS_BACKLOG.md i18n 条目）。
import zhCN from './locales/zh-CN';

type Messages = Record<string, string>;

const locales: Record<string, Messages> = { 'zh-CN': zhCN };

let current = 'zh-CN';

export const setLocale = (locale: string) => {
  if (locales[locale]) current = locale;
};

export const getLocale = () => current;

// 供 toLocaleDateString / Intl 等 API 使用的 locale，与界面语言保持一致
export const getDateLocale = () => current;

export const t = (key: string, vars?: Record<string, string | number>): string => {
  let msg = locales[current][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
};
