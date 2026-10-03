import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow, ModuleMeta } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 业务状态字段：每个模块 fields 里以「状态」结尾的那个（批记录状态、放行状态……）。 */
export function statusFieldOf(meta: ModuleMeta): string {
  return meta.fields.find((field) => field.endsWith('状态')) ?? meta.fields[meta.fields.length - 1]
}

/** 终态：没有任何动作能从该状态发起，落到终态的记录不再算待处理。 */
export function isTerminalStatus(meta: ModuleMeta, status: string): boolean {
  return !Object.values(meta.actionSources).some((sources) => sources.includes(status))
}

/**
 * 归一化一份记录：归档口径与复核口径相左时先判优先级——以写库的系统状态 status 为准，
 * 业务状态字段跟随它；pending 按是否终态重算。返回是否有改动。
 */
function normalizeRows(meta: ModuleMeta, rows: EntryRow[]): boolean {
  const statusField = statusFieldOf(meta)
  let changed = false
  for (const row of rows) {
    let status = String(row.status ?? '')
    if (!meta.statuses.includes(status)) {
      status = meta.statuses[0]
      row.status = status
      changed = true
    }
    if (String(row[statusField] ?? '') !== status) {
      row[statusField] = status
      changed = true
    }
    const pending = !isTerminalStatus(meta, status)
    if (row.pending !== pending) {
      row.pending = pending
      changed = true
    }
  }
  return changed
}

function normalizeAll(data: Record<string, EntryRow[]>): boolean {
  let changed = false
  for (const [key, rows] of Object.entries(data)) {
    const meta = MODULE_BY_KEY.get(key)
    if (meta && Array.isArray(rows)) {
      changed = normalizeRows(meta, rows) || changed
    }
  }
  return changed
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    normalizeAll(fallback)
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    normalizeAll(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    // 旧数据可能两份状态各说各话：归一化后落库，之后清单、总览、导出看的都是同一份。
    if (normalizeAll(merged)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
    return merged
  } catch {
    normalizeAll(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

function ensureCache(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  // 读路径只给拷贝：列表、总览、导出拿到的都是快照，写库必须走 saveRows，
  // 不会再出现「只动了列表用的那份数据，写库的记录没变」。
  return clone(ensureCache())
}

export function listRows(key: string): EntryRow[] {
  return clone(ensureCache()[key] ?? [])
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 入库即校准：不管谁写、写的是什么，落库前都按优先级归一化，
  // 保证写库的那份记录永远一致，总览、清单、导出看到的都是它。
  const meta = MODULE_BY_KEY.get(key)
  const stored = clone(rows)
  if (meta) {
    normalizeRows(meta, stored)
  }
  const next = { ...ensureCache(), [key]: stored }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const meta = MODULE_BY_KEY.get(key)
  if (meta) {
    normalizeRows(meta, rows)
  }
  saveRows(key, rows)
  return clone(rows)
}

export function storageKey(): string {
  return STORAGE_KEY
}
