
// interface DownloadList {

// }


declare namespace LX {
  namespace Download {
    type DownloadTaskStatus = 'run'
    | 'waiting'
    | 'pause'
    | 'error'
    | 'completed'

    // 下载失败原因分类（借鉴 MusicFree DownloadFailReason）
    type DownloadErrorReason = 'network'
    | 'cellular'
    | 'noSource'
    | 'noWrite'
    | 'noSpace'
    | 'unknown'

    type FileExt = 'mp3' | 'flac' | 'wav' | 'ape'

    interface ProgressInfo {
      progress: number
      speed: string
      downloaded: number
      total: number
    }

    interface DownloadTaskActionBase <A> {
      action: A
    }
    interface DownloadTaskActionData<A, D> extends DownloadTaskActionBase<A> {
      data: D
    }
    type DownloadTaskAction<A, D = undefined> = D extends undefined ? DownloadTaskActionBase<A> : DownloadTaskActionData<A, D>

    type DownloadTaskActions = DownloadTaskAction<'start'>
    | DownloadTaskAction<'complete'>
    | DownloadTaskAction<'refreshUrl'>
    | DownloadTaskAction<'statusText', string>
    | DownloadTaskAction<'progress', ProgressInfo>
    | DownloadTaskAction<'error', {
      error?: string
      message?: string
    }>

    interface ListItem {
      id: string
      isComplate: boolean
      status: DownloadTaskStatus
      statusText: string
      /** 状态的 i18n 键，UI 优先用它渲染，避免把中文写进存储 */
      statusKey?: string
      statusParams?: Record<string, string | number>
      downloaded: number
      total: number
      progress: number
      speed: string
      error?: string
      errorCode?: DownloadErrorReason
      retryCount?: number
      metadata: {
        musicInfo: LX.Music.MusicInfoOnline
        url: string | null
        quality: LX.Quality
        fragment?: boolean
        ext: FileExt
        fileName: string
        filePath: string
      }
    }

    interface saveDownloadMusicInfo {
      list: ListItem[]
      addMusicLocationType: LX.AddMusicLocationType
    }
  }
}
