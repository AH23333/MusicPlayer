// 封装 ElectronAPI 调用
class ApiService {
  // 测试函数
  async testFunc(keyword) {
    return await window.ElectronAPI.testFunc(keyword)
  }

  // 搜索音乐
  async searchMusic(keyword, offset = 0) {
    return await window.ElectronAPI.searchMusic(keyword, offset)
  }

  // 保存播放列表
  async savePlaylist(playlist) {
    return await window.ElectronAPI.savePlaylist(playlist)
  }

  // 读取播放列表
  async readPlaylist() {
    return await window.ElectronAPI.readPlaylist()
  }

  // 获取歌词
  async fetchLyrics(songId) {
    return await window.ElectronAPI.fetchLyrics(songId)
  }

  // 读取我喜欢的歌曲
  async readLikedSongs() {
    return await window.ElectronAPI.readLikedSongs()
  }

  // 保存我喜欢的歌曲
  async saveLikedSongs(likedSongs) {
    return await window.ElectronAPI.saveLikedSongs(likedSongs)
  }

  // 读取关注歌手
  async readFollowedArtists() {
    return await window.ElectronAPI.readFollowedArtists()
  }

  // 保存关注歌手
  async saveFollowedArtists(followedArtists) {
    return await window.ElectronAPI.saveFollowedArtists(followedArtists)
  }

  // 读取自定义歌单
  async readCustomPlaylists() {
    return await window.ElectronAPI.readCustomPlaylists()
  }

  // 保存自定义歌单
  async saveCustomPlaylists(playlists) {
    return await window.ElectronAPI.saveCustomPlaylists(playlists)
  }

  // 读取最近播放
  async readLatestPlayed() {
    return await window.ElectronAPI.readLatestPlayed()
  }

  // 保存最近播放
  async saveLatestPlayed(latestPlayed) {
    return await window.ElectronAPI.saveLatestPlayed(latestPlayed)
  }

  // 读取自建歌单
  async readDIYPlaylists() {
    return await window.ElectronAPI.readDIYPlaylists()
  }

  // 保存自建歌单
  async saveDIYPlaylists(playlists) {
    return await window.ElectronAPI.saveDIYPlaylists(playlists)
  }

  // 保存歌单封面
  async savePlaylistCover(data) {
    return await window.ElectronAPI.savePlaylistCover(data)
  }

  // 导出歌单
  async exportPlaylist(playlist) {
    return await window.ElectronAPI.exportPlaylist(playlist)
  }

  // 导入歌单
  async importPlaylist() {
    return await window.ElectronAPI.importPlaylist()
  }

  // 导出用户信息
  async exportUserInfo() {
    return await window.ElectronAPI.exportUserInfo()
  }

  // 导入用户信息
  async importUserInfo() {
    return await window.ElectronAPI.importUserInfo()
  }

  // 读取搜索历史
  async readSearchHistory() {
    return await window.ElectronAPI.readSearchHistory()
  }

  // 保存搜索历史
  async saveSearchHistory(searchHistory) {
    return await window.ElectronAPI.saveSearchHistory(searchHistory)
  }

  // 读取本地歌曲
  async readLocalSongs() {
    return await window.ElectronAPI.readLocalSongs()
  }

  // 导入本地歌曲
  async importLocalSongs(filePaths) {
    return await window.ElectronAPI.importLocalSongs(filePaths)
  }

  // 删除本地歌曲
  async deleteLocalSong(songUrl) {
    return await window.ElectronAPI.deleteLocalSong(songUrl)
  }

  // 打开文件选择对话框
  async openFileDialog() {
    return await window.ElectronAPI.openFileDialog()
  }

  // 检查更新
  async checkForUpdates() {
    return await window.ElectronAPI.checkForUpdates()
  }

  // 打开下载页面
  async openDownloadPage(url) {
    return await window.ElectronAPI.openDownloadPage(url)
  }
}

export default new ApiService()