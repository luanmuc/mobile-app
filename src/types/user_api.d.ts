declare namespace LX {
  namespace UserApi {
    type UserApiSourceInfoType = 'music'
    // App 侧额外实现的治理动作（音源脚本 v8.0 起声明）：health 快照、toggle 开关、probe 手动探测、config 参数、trend 趋势
    type UserApiSourceInfoActions = 'musicUrl' | 'lyric' | 'pic' | 'health' | 'toggle' | 'probe' | 'config' | 'trend' | 'healthEvents'

    interface UserApiSourceInfo {
      name: string
      type: UserApiSourceInfoType
      actions: UserApiSourceInfoActions[]
      qualitys: LX.Quality[]
    }

    type UserApiSources = Record<LX.Source, UserApiSourceInfo>


    interface UserApiInfo {
      id: string
      name: string
      description: string
      // script: string
      allowShowUpdateAlert: boolean
      author: string
      homepage: string
      version: string
      sources?: UserApiSources
    }

    interface UserApiStatus {
      status: boolean
      message?: string
      apiInfo?: UserApiInfo
    }

    interface UserApiUpdateInfo {
      name: string
      description: string
      log: string
      updateUrl?: string
    }

    interface UserApiRequestParams {
      requestKey: string
      data: any
    }
    interface UserApiRequestParams {
      requestKey: string
      data: any
    }
    type UserApiRequestCancelParams = string
    type UserApiSetApiParams = string

    interface UserApiSetAllowUpdateAlertParams {
      id: string
      enable: boolean
    }

    interface ImportUserApi {
      apiInfo: UserApiInfo
      apiList: UserApiInfo[]
    }

  }
}
