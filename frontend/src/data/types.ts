/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 指标口径：status 按状态计数，uniqueBy 按字段去重（同一批号只算一次），sumOf 对数值字段求和。 */
export type MetricSpec = {
  label: string
  status?: string
  uniqueBy?: string
  sumOf?: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 每个动作允许的发起状态：状态只能往下流转，不在来源状态里的一律按跳级拒收。 */
  actionSources: Record<string, string[]>
  metrics: MetricSpec[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
