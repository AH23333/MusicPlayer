const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("ElectronAPI", {
  // 基础功能
  testFunc: (keyword) => ipcRenderer.invoke("test-func", keyword),
  searchMusic: (keyword, offset) =>
    ipcRenderer.invoke("search-music", keyword, offset),
  savePlaylist: (playlist) => ipcRenderer.invoke("save-playlist", playlist),
  readPlaylist: () => ipcRenderer.invoke("read-playlist"),
  // 新增：获取歌词
  fetchLyrics: (songId) => ipcRenderer.invoke("fetch-lyrics", songId),
  // 新增：我喜欢的歌曲
  readLikedSongs: () => ipcRenderer.invoke("read-liked-songs"),
  saveLikedSongs: (likedSongs) =>
    ipcRenderer.invoke("save-liked-songs", likedSongs),
  // 新增：关注歌手
  readFollowedArtists: () => ipcRenderer.invoke("read-followed-artists"),
  saveFollowedArtists: (followedArtists) =>
    ipcRenderer.invoke("save-followed-artists", followedArtists),
  // 新增：自定义歌单
  readCustomPlaylists: () => ipcRenderer.invoke("read-custom-playlists"),
  saveCustomPlaylists: (playlists) =>
    ipcRenderer.invoke("save-custom-playlists", playlists),
  // 新增：最近播放
  readLatestPlayed: () => ipcRenderer.invoke("read-latest-played"),
  saveLatestPlayed: (latestPlayed) =>
    ipcRenderer.invoke("save-latest-played", latestPlayed),
  // 新增：自建歌单
  readDIYPlaylists: () => ipcRenderer.invoke("read-diy-playlists"),
  saveDIYPlaylists: (playlists) =>
    ipcRenderer.invoke("save-diy-playlists", playlists),
  savePlaylistCover: (data) => ipcRenderer.invoke("save-playlist-cover", data),
  // 新增：导入导出歌单
  exportPlaylist: (playlist) => ipcRenderer.invoke("export-playlist", playlist),
  importPlaylist: () => ipcRenderer.invoke("import-playlist"),
  // 新增：导入导出用户信息
  exportUserInfo: (localData) => ipcRenderer.invoke("export-user-info", localData),
  importUserInfo: () => ipcRenderer.invoke("import-user-info"),
  // 新增：搜索历史
  readSearchHistory: () => ipcRenderer.invoke("read-search-history"),
  saveSearchHistory: (searchHistory) =>
    ipcRenderer.invoke("save-search-history", searchHistory),
  // 新增：本地歌曲
  readLocalSongs: () => ipcRenderer.invoke("read-local-songs"),
  importLocalSongs: (filePaths) =>
    ipcRenderer.invoke("import-local-songs", filePaths),
  deleteLocalSong: (songUrl) =>
    ipcRenderer.invoke("delete-local-song", songUrl),
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  selectDownloadDirectory: () =>
    ipcRenderer.invoke("select-download-directory"),
  // 新增：检查更新（手动模式）
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  openDownloadPage: (url) => ipcRenderer.invoke("open-download-page", url),
  onUpdateAvailable: (callback) =>
    ipcRenderer.on("update-available", (event, info) => callback(info)),
  // 新增：一键更新
  downloadUpdate: (url, digest) =>
    ipcRenderer.invoke("download-update", url, digest),
  cancelUpdate: () => ipcRenderer.invoke("cancel-update"),
  prepareUpdate: (zipPath) => ipcRenderer.invoke("prepare-update", zipPath),
  installUpdate: (newRoot) => ipcRenderer.invoke("install-update", newRoot),
  onUpdateDownloadProgress: (callback) =>
    ipcRenderer.on("update-download-progress", (event, data) => callback(data)),
  // 新增：音乐下载服务
  musicDlSearch: (keyword, sources, page, limit) =>
    ipcRenderer.invoke("musicDlSearch", keyword, sources, page, limit),
  musicDlLyric: (id, source) => ipcRenderer.invoke("musicDlLyric", id, source),
  musicDlStatus: () => ipcRenderer.invoke("musicDlStatus"),
  musicDlSources: () => ipcRenderer.invoke("musicDlSources"),
  musicDlToplists: (source) => ipcRenderer.invoke("musicDlToplists", source),
  musicDlToplistSongs: (source, id, name) =>
    ipcRenderer.invoke("musicDlToplistSongs", source, id, name),
  musicDlRecommend: (source) => ipcRenderer.invoke("musicDlRecommend", source),
  musicDlPlaylistCategories: (source) =>
    ipcRenderer.invoke("musicDlPlaylistCategories", source),
  musicDlCategoryPlaylists: (source, categoryId, page, limit) =>
    ipcRenderer.invoke(
      "musicDlCategoryPlaylists",
      source,
      categoryId,
      page,
      limit
    ),
  musicDlQrCreate: (source) => ipcRenderer.invoke("musicDlQrCreate", source),
  musicDlQrCheck: (source, key) =>
    ipcRenderer.invoke("musicDlQrCheck", source, key),
  musicDlLoginStatus: (source) =>
    ipcRenderer.invoke("musicDlLoginStatus", source),
  musicDlLogout: (source) => ipcRenderer.invoke("musicDlLogout", source),
  musicDlUserPlaylists: (source, page, limit) =>
    ipcRenderer.invoke("musicDlUserPlaylists", source, page, limit),
  musicDlQrImageUrl: (text, size) =>
    ipcRenderer.invoke("musicDlQrImageUrl", text, size),
  musicDlDownloadLyric: (song) =>
    ipcRenderer.invoke("musicDlDownloadLyric", song),
  musicDlPlaylistDetail: (source, id, name) =>
    ipcRenderer.invoke("musicDlPlaylistDetail", source, id, name),
  musicDlPlaylistSearch: (keyword, sources) =>
    ipcRenderer.invoke("musicDlPlaylistSearch", keyword, sources),
  musicDlParse: (url) => ipcRenderer.invoke("musicDlParse", url),
musicDlSwitchSource: (name, artist, current, duration) =>
  ipcRenderer.invoke(
    "musicDlSwitchSource",
    name,
    artist,
    current,
    duration
  ),
musicDlAlbumSearch: (keyword) =>
  ipcRenderer.invoke("musicDlAlbumSearch", keyword),
musicDlAlbum: (source, id, name) =>
  ipcRenderer.invoke("musicDlAlbum", source, id, name),
  musicDlDownloadQueueList: (page, limit, status) =>
    ipcRenderer.invoke("musicDlDownloadQueueList", page, limit, status),
  musicDlDownloadQueueEnqueue: (requestId, songs, options) =>
    ipcRenderer.invoke("musicDlDownloadQueueEnqueue", requestId, songs, options),
  musicDlDownloadQueueAction: (id, action) =>
    ipcRenderer.invoke("musicDlDownloadQueueAction", id, action),
  musicDlDownloadQueueClear: () =>
    ipcRenderer.invoke("musicDlDownloadQueueClear"),
  musicDlDownloadRecordsList: (page, pageSize) =>
    ipcRenderer.invoke("musicDlDownloadRecordsList", page, pageSize),
  musicDlDownloadRecordsClear: () =>
    ipcRenderer.invoke("musicDlDownloadRecordsClear"),
  musicDlCoverProxyUrl: (url) =>
    ipcRenderer.invoke("musicDlCoverProxyUrl", url),
  musicDlPrecheck: (songs) => ipcRenderer.invoke("musicDlPrecheck", songs),
  musicDlCookiesGet: () => ipcRenderer.invoke("musicDlCookiesGet"),
  musicDlCookiesSet: (payload) =>
    ipcRenderer.invoke("musicDlCookiesSet", payload),
  musicSongDetail: (server, id) =>
    ipcRenderer.invoke("music-song-detail", server, id),
  fetchWebPlaylist: (urlOrId, platform) =>
    ipcRenderer.invoke("fetch-web-playlist", urlOrId, platform || "auto"),
  fetchNeteasePlaylist: (urlOrId) =>
    ipcRenderer.invoke("fetch-web-playlist", urlOrId, "netease"),
  downloadAudioFiles: (payload) =>
    ipcRenderer.invoke("download-audio-files", payload),
  onDownloadProgress: (callback) => {
    const handler = (_e, data) => callback(data)
    ipcRenderer.on("download-progress", handler)
    return () =>
      ipcRenderer.removeListener("download-progress", handler)
  },
  // 窗口控制（无边框自定义标题栏）
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowMaximize: () => ipcRenderer.send("window-maximize"),
  windowClose: () => ipcRenderer.send("window-close"),

  // ===== 新功能：媒体键 / 托盘 / 迷你 / 桌面歌词 / 通知 =====
  onMediaControl: (cb) => {
    const h = (_e, action) => cb(action)
    ipcRenderer.on("media-control", h)
  },
  setMiniMode: (enter) => ipcRenderer.send("set-mini-mode", !!enter),
  toggleDesktopLyrics: (force) =>
    ipcRenderer.send("desktop-lyrics-toggle", typeof force === "boolean" ? force : undefined),
  desktopLyricsLine: (data) => ipcRenderer.send("desktop-lyrics-line", data),
  setDesktopLyricsOpacity: (v) => ipcRenderer.send("desktop-lyrics-opacity", v),
  onDesktopLyricsLine: (cb) =>
    ipcRenderer.on("desktop-lyrics-line", (_e, data) => cb(data)),
  onDesktopLyricsState: (cb) =>
    ipcRenderer.on("desktop-lyrics-state", (_e, open) => cb(open)),
  desktopLyricsClose: () => ipcRenderer.send("desktop-lyrics-toggle", false),
  desktopLyricsPlayerCtl: (action) =>
    ipcRenderer.send("desktop-lyrics-player-ctl", action),
  desktopLyricsLock: (locked) =>
    ipcRenderer.send("desktop-lyrics-lock", !!locked),
  // 锁定期间悬停徽标/工具条时临时恢复窗口鼠标交互（用于点击解锁）
  desktopLyricsSetInteractive: (interactive) =>
    ipcRenderer.send("desktop-lyrics-set-interactive", !!interactive),
  desktopLyricsResetSize: () => ipcRenderer.send("desktop-lyrics-reset-size"),
  desktopLyricsMenuSize: (h) => ipcRenderer.send("desktop-lyrics-menu-size", h),
  desktopLyricsDragStart: () => ipcRenderer.send("desktop-lyrics-drag-start"),
  desktopLyricsDragMove: (dx, dy) =>
    ipcRenderer.send("desktop-lyrics-drag-move", Number(dx) || 0, Number(dy) || 0),
  desktopLyricsDragEnd: () => ipcRenderer.send("desktop-lyrics-drag-end"),
  onDesktopLyricsLockState: (cb) =>
    ipcRenderer.on("desktop-lyrics-lock-state", (_e, locked) => cb(locked)),
  desktopLyricsPlayerState: (playing) =>
    ipcRenderer.send("desktop-lyrics-player-state", !!playing),
  onDesktopLyricsPlayerState: (cb) =>
    ipcRenderer.on("desktop-lyrics-player-state", (_e, playing) => cb(playing)),
  desktopLyricsAccent: (hex) =>
    ipcRenderer.send("desktop-lyrics-accent", hex),
  onDesktopLyricsAccent: (cb) =>
    ipcRenderer.on("desktop-lyrics-accent", (_e, hex) => cb(hex)),
  onDesktopLyricsAccentRequest: (cb) =>
    ipcRenderer.on("desktop-lyrics-accent-request", () => cb()),
  notifySong: (info) => ipcRenderer.send("notify-song", info),

  // 跨域音频经同源代理，避免 Web Audio（频谱/EQ）被 CORS 污染
  proxyMedia: (url) => {
    if (!url || typeof url !== "string") return url
    if (/^https?:\/\//i.test(url)) return "mpmedia://audio/?u=" + encodeURIComponent(url)
    return url
  },
})
