import { spanText, type HealthFinding, type HealthReport } from './healthDiagnostics'

// 错误码类 finding：页面单独成组，其他线索不混排。
// 后端已保证 new_code 与 recent_failure 不会重复露出同一个错误码。
export const CODE_FINDING_IDS = ['new_code', 'recent_failure'] as const

export const percentText = (rate: number | null | undefined): string => (
  rate == null ? '-' : `${Math.round(rate * 100)}%`
)

export const isCodeFinding = (finding: HealthFinding): boolean => (
  (CODE_FINDING_IDS as readonly string[]).includes(finding.id)
)

export interface HealthDiagnosticsView {
  stats: {
    total: number
    ok: number
    failed: number
    rateText: string
    rateWarn: boolean
  }
  coverage: {
    full: boolean
    span: string
    truncated: boolean
  }
  h1: {
    total: number
    ok: number
    empty: boolean
  }
  cacheHits: {
    h1: number
    h24: number
    hasAny: boolean
  }
  weighting: {
    unweightedSuccesses: number
    hasUnweighted: boolean
  }
  codes: HealthFinding[]
  others: HealthFinding[]
  findingCount: number
  empty: boolean
  collapsed: {
    ok: number
    total: number
    rateText: string
    findingCount: number
  }
}

/**
 * 把报告压成窗口直接消费的视图模型。
 * 纯函数：不排序、不改写 findings，只按错误码/其他线索分组，保留后端顺序。
 */
export const buildHealthDiagnosticsView = (report: HealthReport): HealthDiagnosticsView => {
  const h24 = report.windows.h24
  const h1 = report.windows.h1
  const findings = Array.isArray(report.findings) ? report.findings : []
  const codes = findings.filter(isCodeFinding)
  const others = findings.filter(f => !isCodeFinding(f))
  const rateText = percentText(h24.successRate)
  return {
    stats: {
      total: h24.total,
      ok: h24.ok,
      failed: h24.failed,
      rateText,
      rateWarn: h24.successRate != null && h24.successRate < 0.6,
    },
    coverage: {
      full: report.windows.d7.covered,
      span: spanText(report.coverage.coveredMs),
      truncated: report.coverage.truncated,
    },
    h1: {
      total: h1.total,
      ok: h1.ok,
      empty: h1.total === 0,
    },
    cacheHits: {
      h1: report.cacheHits?.h1 ?? 0,
      h24: report.cacheHits?.h24 ?? 0,
      hasAny: (report.cacheHits?.h24 ?? 0) > 0,
    },
    weighting: {
      unweightedSuccesses: report.coverage.unweightedSuccesses,
      hasUnweighted: report.coverage.unweightedSuccesses > 0,
    },
    codes,
    others,
    findingCount: findings.length,
    empty: findings.length === 0,
    collapsed: {
      ok: h24.ok,
      total: h24.total,
      rateText,
      findingCount: findings.length,
    },
  }
}
