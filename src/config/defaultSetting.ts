const defaultSetting: LX.AppSetting = {
  version: '2.3',
  'common.isAutoTheme': false,
  'common.langId': null,
  'common.apiSource': '',
  'common.sourceNameType': 'real',
  'common.shareType': 'system',
  'common.isAgreePact': false,
  'common.autoHidePlayBar': true,
  'common.drawerLayoutPosition': 'left',
  'common.homePageScroll': true,
  'common.allowProgressBarSeek': false,
  'common.showBackBtn': false,
  'common.showExitBtn': true,
  'common.useSystemFileSelector': true,
  'common.alwaysKeepStatusbarHeight': false,
  'common.enableDebugLog': true, // 调试日志开关（b64 起默认开启，收集详细运行日志便于排障）

  'player.startupAutoPlay': false,
  'player.startupPushPlayDetailScreen': false,
  'player.togglePlayMethod': 'listLoop',
  'player.playQuality': 'flac', // v1.9.3：默认由 flac24bit 改为 flac——实测 20 个源无任何 flac24bit 能力，请求该档会得到空链，且降档链最多 3 档会把 128k 兜底挤掉
  'player.isSavePlayTime': true, // v1.9.3：默认记住播放进度
  'player.volume': 1,
  'player.playbackRate': 1,
  'player.cacheSize': '1024',
  'player.timeoutExit': '',
  'player.timeoutExitPlayed': true,
  'player.isAutoCleanPlayedList': false,
  'player.isHandleAudioFocus': true,
  'player.autoResumeAfterInterrupt': true,
  'player.duckOnTransientDuck': true,
  'player.isEnableAudioOffload': false,
  'player.isShowLyricTranslation': false,
  'player.isShowLyricRoma': false,
  'player.isShowNotificationImage': true,
  'player.isS2t': false,
  'player.isShowBluetoothLyric': false,
  'player.isShowBluetoothFullLyric': false,
  'player.isShowNotificationLyric': true, // 通知栏标题显示当前歌词（与原版默认一致；需要时可手动关闭）

  // 'playDetail.isShowLyricProgressSetting': false,
  'playDetail.style.align': 'center',
  'playDetail.vertical.style.lrcFontSize': 210,
  'playDetail.horizontal.style.lrcFontSize': 220,
  'playDetail.isShowLyricProgressSetting': true,

  'desktopLyric.enable': false,
  'desktopLyric.isLock': true, // 桌面歌词默认锁定（定制；用户指定）
  'desktopLyric.width': 100,
  'desktopLyric.maxLineNum': 5,
  'desktopLyric.isSingleLine': false,
  'desktopLyric.showToggleAnima': true,
  'desktopLyric.position.x': 0,
  'desktopLyric.position.y': 0,
  'desktopLyric.textPosition.x': 'center',
  'desktopLyric.textPosition.y': 'center',
  'desktopLyric.style.fontSize': 180,
  'desktopLyric.style.opacity': 100,
  'desktopLyric.style.lyricUnplayColor': 'rgba(255, 255, 255, 1)',
  'desktopLyric.style.lyricPlayedColor': 'rgba(7, 197, 86, 1)',
  'desktopLyric.style.lyricShadowColor': 'rgba(0, 0, 0, 0.6)',

  'search.isShowHotSearch': false,
  'search.isShowHistorySearch': false,

  'list.isClickPlayList': true, // 点击歌曲时默认播放整个列表（原版默认 false=单曲；定制开启以获得整列表连续播放）
  'list.isShowAlbumName': false,
  'list.isShowInterval': true,
  'list.addMusicLocationType': 'top',

  'download.fileName': '{title} - {artist}',
  'download.onlyWifi': false,
  'download.maxTask': 2,
  'download.autoRetry': true,
  'download.notifyComplete': true,
  'download.dir': '',

  'sync.enable': false,

  // 'theme.id': 'blue_plus',
  'theme.id': 'green',
  'theme.lightId': 'green',
  'theme.darkId': 'black',
  'theme.hideBgDark': false,
  'theme.dynamicBg': false,
  'theme.fontShadow': false,
}


// 使用新年皮肤
if (new Date().getMonth() < 2) {
  defaultSetting['theme.id'] = 'happy_new_year'
  defaultSetting['desktopLyric.style.lyricPlayedColor'] = 'rgba(255, 18, 34, 1)'
}

export default defaultSetting
