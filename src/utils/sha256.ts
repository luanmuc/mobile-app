import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

// R83：在线更新音源时的完整性校验（sha256 由仓库根 lx-source.js.manifest.json 提供）。
// 为什么不用 TextEncoder：RN 旧运行时（Hermes 早期版本）没有它，这里手写 UTF-8 编码，
// 保证「Node 本地算出的哈希」与「真机算出的哈希」对同一份脚本完全一致。
// 代理对（emoji 等）按 UTF-8 标准合成 4 字节；孤立代理项按 U+FFFD 处理（与 Node Buffer 一致）。
const encodeUtf8 = (input: string): Uint8Array => {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        i++
      } else {
        bytes.push(0xef, 0xbf, 0xbd)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd)
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(bytes)
}

export const utf8ByteLength = (input: string) => encodeUtf8(input).length

export const sha256Hex = (input: string) => bytesToHex(sha256(encodeUtf8(input)))
