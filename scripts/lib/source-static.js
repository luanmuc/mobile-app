/**
 * 源仓静态源读取（v9.3-b）
 *
 * v9.0 把逻辑拆到 src/core/*.js 后，App 侧任何「只读 legacy.js」的检查都会把
 * 「已迁走」误判成「消失」。统一口径：legacy.js + 全部 core 模块拼接，
 * 与源仓门禁 STATIC_SRC 完全一致。
 */
const fs = require('fs')
const path = require('path')

const readSourceAll = (sourceRoot) => {
  const parts = []
  const legacy = path.join(sourceRoot, 'src', 'legacy.js')
  if (fs.existsSync(legacy)) parts.push(fs.readFileSync(legacy, 'utf8'))
  const coreDir = path.join(sourceRoot, 'src', 'core')
  if (fs.existsSync(coreDir)) {
    for (const f of fs.readdirSync(coreDir).filter(x => x.endsWith('.js')).sort()) {
      parts.push(fs.readFileSync(path.join(coreDir, f), 'utf8'))
    }
  }
  return parts.join('\n')
}

module.exports = { readSourceAll }
