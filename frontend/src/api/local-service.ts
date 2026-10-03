import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, isTerminalStatus, listRows, resetRows, saveRows, statusFieldOf } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
    pairs.every(([field, value]) => String(row[field] ?? '').trim().includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 这条记录当前可执行的动作：只放行登记在 actionSources 里的来源状态，页面按它渲染按钮。 */
export function availableActions(key: string, row: EntryRow): string[] {
  const meta = moduleMeta(key)
  const status = String(row.status)
  return meta.actions.filter((action) => (meta.actionSources[action] ?? []).includes(status))
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态只能往下流转：目标必须排在当前状态之后，倒退一律拒收。
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (targetIndex <= currentIndex) {
    return { ok: false, message: `状态只能往下流转，不能从「${current}」退回到「${target}」` }
  }
  // 跳级拒收：动作只能从登记的来源状态发起。
  const sources = meta.actionSources[action] ?? []
  if (!sources.includes(current)) {
    return {
      ok: false,
      message: `「${action}」只能从「${sources.join('」「')}」发起，当前状态「${current}」，跳级操作拒收`,
    }
  }
  // 归档与送交复核写进同一份批记录：系统状态与业务状态字段一次切换到位。
  const statusField = statusFieldOf(meta)
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    [statusField]: target,
    pending: !isTerminalStatus(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已执行「${action}」，当前状态「${target}」` }
}

/** 指标卡：从同一份记录现算，归档类口径按批号去重，同一批号重复归档只算一次。 */
export function moduleMetrics(key: string): { label: string; value: number }[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.metrics.map((spec) => {
    if (spec.sumOf) {
      const sum = rows.reduce((total, row) => total + (Number(row[spec.sumOf as string]) || 0), 0)
      return { label: spec.label, value: sum }
    }
    const matched = rows.filter((row) => String(row.status) === spec.status)
    if (spec.uniqueBy) {
      const distinct = new Set(matched.map((row) => String(row[spec.uniqueBy as string] ?? row.id)))
      return { label: spec.label, value: distinct.size }
    }
    return { label: spec.label, value: matched.length }
  })
}

/** 状态图例：与指标卡、明细、总览同源，都数写库的同一份记录。 */
export function statusSummary(key: string): { status: string; count: number }[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
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
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
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
