import api from './api.js'

// 封装数据持久化操作
class StorageService {
  // 保存播放列表
  async savePlaylist(playlist) {
    return await api.savePlaylist(playlist)
  }

  // 读取播放列表
  async readPlaylist() {
    return await api.readPlaylist()
  }

  // 保存我喜欢的歌曲
  async saveLikedSongs(likedSongs) {
    return await api.saveLikedSongs(likedSongs)
  }

  // 读取我喜欢的歌曲
  async readLikedSongs() {
    return await api.readLikedSongs()
  }

  // 保存关注歌手
  async saveFollowedArtists(followedArtists) {
    return await api.saveFollowedArtists(followedArtists)
  }

  // 读取关注歌手
  async readFollowedArtists() {
    return await api.readFollowedArtists()
  }

  // 保存自定义歌单
  async saveCustomPlaylists(playlists) {
    return await api.saveCustomPlaylists(playlists)
  }

  // 读取自定义歌单
  async readCustomPlaylists() {
    return await api.readCustomPlaylists()
  }

  // 保存最近播放
  async saveLatestPlayed(latestPlayed) {
    return await api.saveLatestPlayed(latestPlayed)
  }

  // 读取最近播放
  async readLatestPlayed() {
    return await api.readLatestPlayed()
  }

  // 保存自建歌单
  async saveDIYPlaylists(playlists) {
    return await api.saveDIYPlaylists(playlists)
  }

  // 读取自建歌单
  async readDIYPlaylists() {
    return await api.readDIYPlaylists()
  }

  // 保存搜索历史
  async saveSearchHistory(searchHistory) {
    return await api.saveSearchHistory(searchHistory)
  }

  // 读取搜索历史
  async readSearchHistory() {
    return await api.readSearchHistory()
  }
}

export default new StorageService()