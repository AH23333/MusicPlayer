import store from '../store/index.js'
import api from '../services/api.js'

class Local {
  // 加载本地歌曲
  async loadLocalSongs() {
    try {
      const localSongs = await api.readLocalSongs()
      store.dispatch('setLocalSongs', localSongs)
      return localSongs
    } catch (error) {
      console.error('加载本地歌曲失败:', error)
      return []
    }
  }

  // 导入本地歌曲
  async importLocalSongs(filePaths) {
    try {
      const result = await api.importLocalSongs(filePaths)
      if (result.success) {
        // 重新加载本地歌曲
        await this.loadLocalSongs()
        return result.songs
      }
      return []
    } catch (error) {
      console.error('导入本地歌曲失败:', error)
      return []
    }
  }

  // 删除本地歌曲
  async deleteLocalSong(songUrl) {
    try {
      const result = await api.deleteLocalSong(songUrl)
      if (result.success) {
        // 重新加载本地歌曲
        await this.loadLocalSongs()
        return true
      }
      return false
    } catch (error) {
      console.error('删除本地歌曲失败:', error)
      return false
    }
  }

  // 获取本地歌曲列表
  getLocalSongs() {
    const state = store.getState()
    return state.localSongs
  }

  // 获取本地歌曲数量
  getLocalCount() {
    const state = store.getState()
    return state.localSongs.length
  }
}

export default new Local()