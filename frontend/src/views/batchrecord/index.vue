<template>
  <section class="page" data-module="batchrecord">
    <header class="page-head">
      <div>
        <h2>批生产记录管理</h2>
        <p class="page-desc">维护批生产记录，围绕批号、产品名称、生产工序、投料量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记批生产记录</button>
        <button class="btn" type="button" @click="exportRows">导出批生产记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无批生产记录数据，可先登记批生产记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条批生产记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>批生产记录详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
          <template v-if="detailRow['归档时间']">
            <dt>归档时间</dt>
            <dd>{{ detailRow['归档时间'] }}</dd>
          </template>
        </dl>
        <div class="drawer-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action, detailRow)"
          >
            {{ action }}
          </button>
        </div>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('batchrecord')
const columns = ["批号", "产品名称", "生产工序", "投料量", "操作人", "复核人", "起始时间", "批记录状态"]
const actions = ["提交编制", "送交复核", "归档批记录"]
const statuses = ["待编制", "编制中", "已复核", "已归档"]

const rows = ref<EntryRow[]>([])
// 未筛选的全量快照：统计卡、状态图例、明细列表都从这一份取，保证三处同源。
const snapshot = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailRow = ref<EntryRow | null>(null)

function countStatus(status: string): number {
  return snapshot.value.filter((row) => String(row.status) === status).length
}

const currentMonth = new Date().toISOString().slice(0, 7)

// 同一批号重复归档只算一次；归档月份以归档时间为准，缺省回看起始时间。
const archivedThisMonth = computed(() => {
  const batches = new Set<string>()
  for (const row of snapshot.value) {
    if (String(row.status) !== '已归档') {
      continue
    }
    const when = String(row['归档时间'] ?? row['起始时间'] ?? '')
    if (!when.startsWith(currentMonth)) {
      continue
    }
    batches.add(String(row['批号'] ?? row.id))
  }
  return batches.size
})

const stats = computed(() => [
  { label: '待编制批记录', value: countStatus('待编制') },
  { label: '编制中批记录', value: countStatus('编制中') },
  { label: '本月归档数', value: archivedThisMonth.value },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countStatus(status),
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '批生产记录登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  errorMessage.value = ''
  detailRow.value = getEntry(meta.key, Number(row.id))
}

function closeDetail() {
  detailRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (detailRow.value) {
    detailRow.value = getEntry(meta.key, Number(row.id))
  }
}

function reload() {
  errorMessage.value = ''
  try {
    snapshot.value = listEntries(meta.key).items
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批生产记录列表读取失败'
  }
}

onMounted(reload)
</script>
