import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 主线之外的异常终态（拒绝、冻结、作废一类）：可以从任意靠前的状态切进去，切进去之后同样不许往回走。
const EXCEPTION_STATUS = /(拒绝|冻结|失败|超标|不合格|失效|终止|撤销|退回|复确认|整改|未通过|升级)/

// 每个模块的字段里都登记了一个「*状态」字段，它和 row.status 是同一份状态的两种写法：
// 读的时候按优先级对齐成一份，写的时候一次写全，列表、详情、总览看到的才是同一个数。
function statusFieldOf(meta: ModuleMeta): string {
  return meta.fields.find((field) => field.endsWith('状态')) ?? meta.fields[meta.fields.length - 1]
}

// 归档口径与复核口径相左时先判优先级：状态在流转链里走得越靠后，优先级越高，按那份算。
function reconcileStatus(meta: ModuleMeta, row: EntryRow): string | null {
  const field = statusFieldOf(meta)
  const candidates = [row.status, row[field]]
    .map((value) => String(value ?? ''))
    .filter((value) => meta.statuses.includes(value))
  if (candidates.length === 0) {
    return null
  }
  return candidates.reduce((a, b) =>
    meta.statuses.indexOf(a) >= meta.statuses.indexOf(b) ? a : b,
  )
}

// 模块数据的唯一入口：列表、详情、总览、导出都从这里取同一份；
// 顺带把历史遗留的两套状态按优先级对齐写回，旧数据读一次就修好。
function moduleRows(key: string): EntryRow[] {
  const meta = moduleMeta(key)
  const field = statusFieldOf(meta)
  const rows = listRows(key)
  let healed = false
  const next = rows.map((row) => {
    const effective = reconcileStatus(meta, row)
    if (effective === null) {
      return row
    }
    if (String(row.status) === effective && String(row[field] ?? '') === effective) {
      return row
    }
    healed = true
    return { ...row, status: effective, [field]: effective }
  })
  if (healed) {
    saveRows(key, next)
  }
  return next
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(moduleRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | null {
  const row = moduleRows(key).find((item) => Number(item.id) === id)
  return row ? { ...row } : null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = moduleRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex >= 0 && targetIndex <= currentIndex) {
    return { ok: false, message: `${meta.entity}状态只能往下流转，不能从「${current}」退回到「${target}」` }
  }
  // 跳级拒收：主线状态必须一步一阶；只有异常终态允许从靠前状态直接切入。
  if (!EXCEPTION_STATUS.test(target) && targetIndex !== currentIndex + 1) {
    const nextStatus = meta.statuses[currentIndex + 1]
    const nextAction = Object.keys(meta.actionTargets).find(
      (name) => meta.actionTargets[name] === nextStatus,
    )
    const hint = nextAction ? `，请先${nextAction}` : ''
    return { ok: false, message: `${meta.entity}不能从「${current}」跳级到「${target}」${hint}` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 同一条记录一次切换到位：row.status 与状态字段写进同一份，再落库。
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    [statusFieldOf(meta)]: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (target === lastStatus) {
    updated['归档时间'] = new Date().toISOString().slice(0, 10)
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of moduleRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = moduleRows(meta.key)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
