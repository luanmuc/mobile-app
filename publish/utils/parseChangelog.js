/**
 *
 * @param {string} text
 * @returns
 */
export const parseChangelog = async(text) => {
  const versions = []
  const lines = text.split(/\r\n|\r|\n/)
  let currentVersion = null
  let currentDate = null
  let currentDesc = ''

  for (const line of lines) {
    const versionMatch = line.match(/^\s*##\s+\[?(\d+\.\d+\.\d+)\]?.*?-\s+(\d{4}-\d{2}-\d{2})$/)
    if (versionMatch) {
      if (currentVersion) {
        versions.push({
          version: currentVersion,
          date: currentDate,
          desc: currentDesc.trim(),
        })
      }
      currentVersion = versionMatch[1]
      // A13-P2-04：该正则只有两个捕获组（1=版本、2=日期），原代码取 [3] 恒为 undefined，
      // 生成的历史条目全部缺日期。
      currentDate = versionMatch[2]
      currentDesc = ''
    } else {
      currentDesc += `${line}\n`
    }
  }

  if (currentVersion) {
    versions.push({
      version: currentVersion,
      date: currentDate,
      desc: currentDesc.trim(),
    })
  }

  return versions
}
