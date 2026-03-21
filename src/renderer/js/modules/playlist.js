import store from '../store/index.js'
import api from '../services/api.js'

class Playlist {
  // 添加歌曲到播放队列
  addToPlaylist(song) {
    store.dispatch('addToPlayQueue', song)
    this.savePlaylist()
  }

  // 批量添加歌曲到播放队列
  addMultipleToPlaylist(songs) {
    songs.forEach(song => {
      store.dispatch('addToPlayQueue', song)
    })
    this.savePlaylist()
  }

  // 从播放队列移除歌曲
  removeFromPlaylist(index) {
    store.dispatch('removeFromPlayQueue', index)
    this.savePlaylist()
  }

  // 清空播放队列
  clearPlaylist() {
    store.dispatch('clearPlayQueue')
    this.savePlaylist()
  }

  // 设置播放队列
  setPlaylist(queue) {
    store.dispatch('setPlayQueue', queue)
    this.savePlaylist()
  }

  // 保存播放队列到本地
  async savePlaylist() {
    const state = store.getState()
    await api.savePlaylist(state.playQueue)
  }

  // 从本地加载播放队列
  async loadPlaylist() {
    try {
      const playlist = await api.readPlaylist()
      store.dispatch('setPlayQueue', playlist)
    } catch (error) {
      console.error('加载播放队列失败:', error)
    }
  }

  // 播放整个播放列表
  playPlaylist() {
    const state = store.getState()
    if (state.playQueue.length > 0) {
      store.dispatch('setCurrentSongIndex', 0)
      // 触发播放逻辑
      if (typeof window.playCurrentSong === 'function') {
        window.playCurrentSong()
      }
    }
  }

  // 获取当前播放队列
  getPlaylist() {
    const state = store.getState()
    return state.playQueue
  }

  // 获取当前播放歌曲
  getCurrentSong() {
    const state = store.getState()
    const { playQueue, currentSongIndex } = state
    if (currentSongIndex >= 0 && currentSongIndex < playQueue.length) {
      return playQueue[currentSongIndex]
    }
    return null
  }

  // 获取当前播放索引
  getCurrentIndex() {
    const state = store.getState()
    return state.currentSongIndex
  }

  // 重新排序播放队列
  reorderPlaylist(newOrder) {
    const state = store.getState()
    const { playQueue } = state
    const newQueue = newOrder.map(index => playQueue[index])
    store.dispatch('setPlayQueue', newQueue)
    this.savePlaylist()
  }

  // 随机打乱播放队列
  shufflePlaylist() {
    const state = store.getState()
    const { playQueue } = state
    const shuffled = [...playQueue].sort(() => Math.random() - 0.5)
    store.dispatch('setPlayQueue', shuffled)
    this.savePlaylist()
  }

  // 检查歌曲是否在播放队列中
  isSongInPlaylist(songId) {
    const state = store.getState()
    return state.playQueue.some(song => song.id === songId)
  }

  // 获取播放队列长度
  getPlaylistLength() {
    const state = store.getState()
    return state.playQueue.length
  }
}

export default new Playlist()