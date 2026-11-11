import { useEffect, useState, useRef } from 'react'
import TrackPlayer, { State, Event } from 'react-native-track-player'

/** Get current playback state and subsequent updatates  */
export const usePlaybackState = () => {
  const [state, setState] = useState(State.None)

  useEffect(() => {
    async function setPlayerState() {
      const playerState = await TrackPlayer.getState()
      setState(playerState)
    }

    void setPlayerState()

    const sub = TrackPlayer.addEventListener(Event.PlaybackState, data => {
      setState(data.state as State)
    })

    return () => { sub.remove() }
  }, [])

  return state
}

/**
 * Attaches a handler to the given TrackPlayer events and performs cleanup on unmount
 * @param events - TrackPlayer events to subscribe to
 * @param handler - callback invoked when the event fires
 */
// export const useTrackPlayerEvents = (events, handler) => {
//   const savedHandler = useRef()

//   useEffect(() => {
//     savedHandler.current = handler
//   }, [handler])

//   useEffect(() => {
//     // eslint-disable-next-line no-undef
//     if (__DEV__) {
//       const allowedTypes = Object.values(Event)
//       const invalidTypes = events.filter(type => !allowedTypes.includes(type))
//       if (invalidTypes.length) {
//         console.warn(
//           'One or more of the events provided to useTrackPlayerEvents is ' +
//             `not a valid TrackPlayer event: ${invalidTypes.join("', '")}. ` +
//             'A list of available events can be found at ' +
//             'https://react-native-kit.github.io/react-native-track-player/documentation/#events',
//         )
//       }
//     }

//     const subs = events.map(event =>
//       TrackPlayer.addEventListener(event, payload => savedHandler.current({ ...payload, type: event })),
//     )

//     return () => subs.forEach(sub => sub.remove())
//   }, [events])
// }

const pollTrackPlayerStates = [
  State.Playing,
  State.Buffering,
] as const
/**
 * Poll for track progress for the given interval (in miliseconds)
 * @param updateInterval - ms interval
 */
export function useProgress(updateInterval: number) {
  const [state, setState] = useState({ position: 0, duration: 0, buffered: 0 })
  const playerState = usePlaybackState()
  const stateRef = useRef(state)
  const isUnmountedRef = useRef(true)
  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const getProgress = async() => {
    const [position, duration, buffered] = await Promise.all([
      TrackPlayer.getPosition(),
      TrackPlayer.getDuration(),
      TrackPlayer.getBufferedPosition(),
    ])
    // After the asynchronous code is executed, if the component has been uninstalled, do not update the status
    if (isUnmountedRef.current) return

    if (
      position === stateRef.current.position &&
      duration === stateRef.current.duration &&
      buffered === stateRef.current.buffered
    ) return

    const state = { position, duration, buffered }
    stateRef.current = state
    setState(state)
  }

  useEffect(() => {
    // @ts-expect-error
    if (!pollTrackPlayerStates.includes(playerState)) return

    void getProgress()

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const poll = setInterval(getProgress, updateInterval || 1000)
    return () => { clearInterval(poll) }
  }, [playerState, updateInterval])

  return state
}

export function useBufferProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let isUnmounted = false
    let preBuffered = 0
    let duration = 0
    // RN 运行时 setInterval 返回 number，类型标注为 NodeJS.Timer 仅用于兼容 @types/node
    let interval: NodeJS.Timer | null = null

    const clearItv = () => {
      if (!interval) return
      clearInterval(interval as unknown as number)
      interval = null
    }
    const updateBuffer = async() => {
      const buffered = await (duration ? TrackPlayer.getBufferedPosition() : Promise.all([TrackPlayer.getBufferedPosition(), TrackPlayer.getDuration()]).then(([buffered, _duration]) => {
        duration = _duration
        return buffered
      }))
      // console.log('updateBuffer', buffered, duration, buffered > 0, buffered == duration)
      // After the asynchronous code is executed, if the component has been uninstalled, do not update the status
      if (buffered > 0 && buffered == duration) clearItv()
      if (buffered == preBuffered || isUnmounted) return
      preBuffered = buffered
      setProgress(duration ? (buffered / duration) : 0)
    }

    const sub = TrackPlayer.addEventListener(Event.PlaybackState, data => {
      switch (data.state) {
        case State.None:
          // console.log('state', 'None')
          setProgress(0)
          break
        // case State.Ready:
        //   console.log('state', 'Ready')
        //   break
        // case State.Stopped:
        //   console.log('state', 'Stopped')
        //   break
        // case State.Paused:
        //   console.log('state', 'Paused')
        //   break
        // case State.Playing:
        //   console.log('state', 'Playing')
        //   break
        case State.Buffering:
          // console.log('state', 'Buffering')
          clearItv()
          duration = 0
          interval = setInterval(updateBuffer, 1000)
          void updateBuffer()
          break
        // case State.Connecting:
        //   console.log('state', 'Connecting')
        //   break
        // default:
        //   console.log('playback-state', data)
        //   break
      }
    })

    // 启动早期播放器还没 setupPlayer 时不要碰原生：binder 会顺手创建一个默认 playback 并拉起 MusicService
    const isReady = () => global.lx.playerStatus.isInitialized
    if (isReady()) void updateBuffer()
    if (isReady()) {
      void TrackPlayer.getState().then((state) => {
        if (state == State.Buffering) {
        // 先清掉可能已存在的同款计时器，否则这里会再起一个且旧引用丢失，永远清不掉
          clearItv()
          interval = setInterval(updateBuffer, 1000)
        }
      })
    }
    return () => {
      isUnmounted = true
      sub.remove()
      clearItv()
    }
  }, [])

  return progress
}
