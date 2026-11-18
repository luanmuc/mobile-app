// import mitt from 'mitt'
// import type { Emitter } from 'mitt'

export default class Event {
  listeners: Map<string, Array<(...args: any[]) => any>>
  constructor() {
    this.listeners = new Map()
  }

  on(eventName: string, listener: (...args: any[]) => any) {
    let targetListeners = this.listeners.get(eventName)
    if (!targetListeners) this.listeners.set(eventName, targetListeners = [])
    targetListeners.push(listener)
  }

  off(eventName: string, listener: (...args: any[]) => any) {
    let targetListeners = this.listeners.get(eventName)
    if (!targetListeners) return
    // A03-P2-10：原来只 splice 掉首条。同一引用被 on 两次（组件重复挂载 / HMR / 双订阅）时，
    // off 一次会残留一条，emit 仍然重复触发。off 的调用点全在卸载/注销处，意图是「彻底收不到」，
    // 因此这里按引用移除全部匹配项（与 mitt 的 off 语义一致）。
    const filtered = targetListeners.filter(cb => cb !== listener)
    if (filtered.length === targetListeners.length) return
    if (filtered.length) this.listeners.set(eventName, filtered)
    else this.listeners.delete(eventName)
  }

  emit(eventName: string, ...args: any[]) {
    setImmediate(() => {
      let targetListeners = this.listeners.get(eventName)
      if (!targetListeners) return
      // A03-P1-3：单个监听器抛错不能中断同批其它监听器（事件总线是 store/UI 刷新的唯一通道，
      // 一处异常会放大成整页不刷新，且异常会变成未处理 rejection）。
      // 逐个隔离 + 打日志，保证其余订阅者照常收到。
      for (const listener of targetListeners) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          listener(...args)
        } catch (e) {
          // 不引入 log 依赖（Event 在最底层，避免循环依赖），直接走 console 兜底
          console.error(`[event] 监听器异常 (${eventName}):`, e)
        }
      }
    })
  }

  offAll(eventName: string) {
    let targetListeners = this.listeners.get(eventName)
    if (!targetListeners) return
    this.listeners.delete(eventName)
  }
}

// export class App_EVENT {
//   listeners: Map<string, Array<() => void>>
//   constructor() {
//     this.listeners = new Map()
//   }

//   on(eventName: string, listener: () => void) {
//     let targetListeners = this.listeners.get(eventName)
//     if (targetListeners) this.listeners.set(eventName, targetListeners = [])
//     targetListeners!.push(listener)
//   }

//   off(eventName: string, listener: () => void) {

//   }
// }

