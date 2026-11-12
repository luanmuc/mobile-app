/**
 * P2 桥媒体传输：二进制体 base64 信封
 *
 * 背景：QuickJS ↔ 原生桥用 JSON 传递，Buffer 会变成 {type:'Buffer',data:[...]}，
 * 1MiB 体积 3.57x、JSON.parse 87ms；base64 信封 1.33x、4.43ms。
 * 超过 256KB 时按定长分片，避免单个超大 base64 串在桥两侧同时驻留。
 */

export const MEDIA_ENVELOPE_VERSION = 2
export const MEDIA_CHUNK_BYTES = 256 * 1024

export interface MediaEnvelope {
  __lxMedia: 2
  encoding: 'base64'
  byteLength: number
  body?: string
  chunkBytes?: number
  chunks?: string[]
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

export const encodeMediaBody = (bytes: Uint8Array, chunkBytes: number = MEDIA_CHUNK_BYTES): MediaEnvelope => {
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) throw new Error('chunkBytes must be a positive number')
  const byteLength = bytes.byteLength
  if (!byteLength) return { __lxMedia: 2, encoding: 'base64', byteLength: 0 }
  if (byteLength <= chunkBytes) {
    return { __lxMedia: 2, encoding: 'base64', byteLength, body: toBase64(bytes) }
  }
  const chunks: string[] = []
  for (let offset = 0; offset < byteLength; offset += chunkBytes) {
    chunks.push(toBase64(bytes.subarray(offset, Math.min(offset + chunkBytes, byteLength))))
  }
  return { __lxMedia: 2, encoding: 'base64', byteLength, chunkBytes, chunks }
}
