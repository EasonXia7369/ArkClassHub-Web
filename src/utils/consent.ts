/**
 * 协议版本号（与服务端 src/consent.ts 的 CONSENT_VERSION 保持一致）。
 * 服务端会校验提交的版本号，不一致时返回 409 要求刷新页面。
 */
export const CONSENT_VERSION = '2026-11-24'

export interface ConsentState {
  version: string
  agreed: boolean
  consented_at: string | null
}

/** 需要在当前版本下重新同意？ */
export function needsConsent(state: ConsentState | null | undefined): boolean {
  if (!state) return false // 学生/未登录等不适用场景
  return !state.agreed || state.version !== CONSENT_VERSION
}