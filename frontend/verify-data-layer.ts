// 数据层回归验证：把批记录归档反馈里的每个场景都跑一遍。
// 运行：node --experimental-vm-modules（先由 esbuild 打包）
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
}

const {
  listEntries,
  runAction,
  moduleMetrics,
  statusSummary,
  availableActions,
  loadOverview,
  exportEntries,
} = await import('@/api/local-service')
const { listRows, saveRows, storageKey } = await import('@/data/local-store')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  PASS ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}`, extra ?? '')
  }
}

function metric(key: string, label: string): number {
  return moduleMetrics(key).find((m) => m.label === label)?.value ?? -1
}
function summaryCount(key: string, status: string): number {
  return statusSummary(key).find((s) => s.status === status)?.count ?? -1
}
function overviewPending(name: string): number {
  return loadOverview().modules.find((m) => m.name === name)?.pending ?? -1
}

console.log('== 1. 归档一次切换到位，写进同一份批记录 ==')
const before = metric('batchrecord', '本月归档数')
const pendingBefore = overviewPending('批生产记录')
const r1 = runAction('batchrecord', 3, '归档批记录') // 已复核 -> 已归档
check('已复核可以归档', r1.ok, r1.message)
const row3 = listRows('batchrecord').find((r) => r.id === 3)!
check('系统状态已归档', row3.status === '已归档', row3.status)
check('业务字段批记录状态同步归档', row3['批记录状态'] === '已归档', row3['批记录状态'])
check('归档后不再待处理', row3.pending === false)
check('统计卡本月归档数 +1', metric('batchrecord', '本月归档数') === before + 1)
check('图例已归档 +1', summaryCount('batchrecord', '已归档') === 1)
check('图例已复核 -1', summaryCount('batchrecord', '已复核') === 0)
check('总览待处理 -1', overviewPending('批生产记录') === pendingBefore - 1)
check('明细条数不变', listEntries('batchrecord').total === 3)

console.log('== 2. 状态只能往下流转，跳级拒收 ==')
const r2 = runAction('batchrecord', 1, '归档批记录') // 待编制 -> 已归档 跳级
check('待编制直接归档被拒', !r2.ok, r2.message)
const r3 = runAction('batchrecord', 3, '提交编制') // 已归档 -> 编制中 倒退
check('已归档倒退被拒', !r3.ok, r3.message)
const r4 = runAction('batchrecord', 3, '归档批记录') // 重复归档同一行
check('同一行重复归档被拒', !r4.ok, r4.message)
const r5 = runAction('batchrecord', 1, '提交编制')
check('待编制可提交编制', r5.ok, r5.message)
const r6 = runAction('batchrecord', 1, '归档批记录') // 编制中 -> 已归档 跳级
check('编制中直接归档仍被拒', !r6.ok, r6.message)
check('可执行动作按状态过滤', JSON.stringify(availableActions('batchrecord', listRows('batchrecord').find((r) => r.id === 2)!)) === JSON.stringify(['送交复核']))

console.log('== 3. 同一批号重复归档只算一次 ==')
// 造一行同批号 B20260915 的记录并走到已归档
const rows = listRows('batchrecord')
rows.push({ id: 99, status: '已复核', pending: true, abnormal: false, 批号: 'B20260915', 产品名称: '布洛芬片0.2g', 生产工序: '包装', 投料量: '180kg', 操作人: '王强', 复核人: '赵敏', 起始时间: '2026-09-16', 批记录状态: '已复核' })
saveRows('batchrecord', rows)
const r7 = runAction('batchrecord', 99, '归档批记录')
check('同批号第二行可以归档（流转不受限）', r7.ok, r7.message)
check('归档数按批号去重仍只算一次', metric('batchrecord', '本月归档数') === before + 1, metric('batchrecord', '本月归档数'))
check('图例按行计为 2（口径不同但各自同源）', summaryCount('batchrecord', '已归档') === 2)

console.log('== 4. 口径冲突先判优先级：以系统状态为准 ==')
const dirty = listRows('materialrelease')
dirty[0]['放行状态'] = '已冻结' // 模拟旧数据：业务字段与系统状态不一致
dirty[0].pending = false
saveRows('materialrelease', dirty)
// 重新加载（清缓存效果）：直接读会触发归一化
const reloaded = listRows('materialrelease')
check('业务字段被校准回系统状态', reloaded[0]['放行状态'] === reloaded[0].status, reloaded[0])
check('pending 按终态重算', reloaded[0].pending === true)
check('物料放行清单同样生效', summaryCount('materialrelease', '待放行') === 1)

console.log('== 5. 列表 / 导出 / 总览同源 ==')
const csv = exportEntries('batchrecord').content
check('导出清单含归档后的同一状态', csv.includes('已归档') && csv.includes('B20260915'))
const listRow = listEntries('batchrecord').items.find((r) => r.id === 3)!
check('列表与写库一致', listRow.status === '已归档' && listRow['批记录状态'] === '已归档')
const ov = loadOverview()
check('总览模块数 18', ov.modules.length === 18)
check('待处理=各模块 pending 之和', ov.cards.find((c) => c.label === '待处理')!.value === ov.modules.reduce((s, m) => s + m.pending, 0))

console.log('== 6. 筛选精度 ==')
const filtered = listEntries('batchrecord', { 批号: 'B20260915' })
check('按批号检索命中两行同批号', filtered.total === 2, filtered.total)
const none = listEntries('batchrecord', { 批号: '不存在的批号' })
check('检索不到时为空', none.total === 0)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
if (failures > 0) process.exit(1)
void storageKey
