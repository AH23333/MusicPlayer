// preload.js - 完整版
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
})
