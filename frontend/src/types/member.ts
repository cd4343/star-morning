/**
 * 家庭成员共享类型定义
 * 由 SelectUser.tsx 和 ParentFamily.tsx 共同引用（两处定义的并集）
 */

export interface Member {
  id: string;
  name: string;
  role: 'parent' | 'child';
  avatar?: string;
  hasPin?: boolean;
  pendingReviewCount?: number;
  birthdate?: string;
  gender?: string; // boy, girl, dad, mom, grandpa, grandma
}
