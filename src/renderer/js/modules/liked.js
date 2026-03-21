import store from '../store/index.js'
import api from '../services/api.js'

class Liked {
  // 加载我喜欢的歌曲
  async loadLikedSongs() {
    try {
      const likedSongs = await api.readLikedSongs()
      store.dispatch('setLikedSongs', likedSongs)
      return likedSongs
    } catch (error) {
      console.error('加载我喜欢的歌曲失败:', error)
      return []
    }
  }

  // 保存我喜欢的歌曲
  async saveLikedSongs() {
    const state = store.getState()
    await api.saveLikedSongs(state.likedSongs)
  }

  // 切换歌曲喜欢状态
  async toggleLiked(songId) {
    store.dispatch('toggleLikedSong', songId)
    await this.saveLikedSongs()
  }

  // 检查歌曲是否被喜欢
  isLiked(songId) {
    const state = store.getState()
    return state.likedSongs.some(song => song.id === songId)
  }

  // 获取我喜欢的歌曲列表
  getLikedSongs() {
    const state = store.getState()
    return state.likedSongs
  }

  // 获取我喜欢的歌曲数量
  getLikedCount() {
    const state = store.getState()
    return state.likedSongs.length
  }

  // 清空我喜欢的歌曲
  async clearLikedSongs() {
    store.dispatch('setLikedSongs', [])
    await this.saveLikedSongs()
  }

  // 批量添加歌曲到我喜欢
  async addMultipleToLiked(songs) {
    const state = store.getState()
    const currentLiked = state.likedSongs
    const newLiked = [...currentLiked]
    
    songs.forEach(song => {
      if (!newLiked.some(s => s.id === song.id)) {
        newLiked.push(song)
      }
    })
    
    store.dispatch('setLikedSongs', newLiked)
    await this.saveLikedSongs()
  }

  // 从喜欢列表中移除歌曲
  async removeFromLiked(songId) {
    const state = store.getState()
    const newLiked = state.likedSongs.filter(song => song.id !== songId)
    store.dispatch('setLikedSongs', newLiked)
    await this.saveLikedSongs()
  }
}

export default new Liked()