import store from '../store/index.js'
import api from '../services/api.js'

class Recent {
  // 加载最近播放
  async loadLatestPlayed() {
    try {
      const latestPlayed = await api.readLatestPlayed()
      store.dispatch('setLatestPlayed', latestPlayed)
      return latestPlayed
    } catch (error) {
      console.error('加载最近播放失败:', error)
      return []
    }
  }

  // 保存最近播放
  async saveLatestPlayed() {
    const state = store.getState()
    await api.saveLatestPlayed(state.latestPlayed)
  }

  // 添加歌曲到最近播放
  async addToLatestPlayed(song) {
    store.dispatch('addToLatestPlayed', song)
    await this.saveLatestPlayed()
  }

  // 获取最近播放列表
  getLatestPlayed() {
    const state = store.getState()
    return state.latestPlayed
  }

  // 获取最近播放数量
  getLatestCount() {
    const state = store.getState()
    return state.latestPlayed.length
  }

  // 清空最近播放
  async clearLatestPlayed() {
    store.dispatch('setLatestPlayed', [])
    await this.saveLatestPlayed()
  }

  // 移除最近播放中的歌曲
  async removeFromLatestPlayed(songId) {
    const state = store.getState()
    const newLatest = state.latestPlayed.filter(song => song.id !== songId)
    store.dispatch('setLatestPlayed', newLatest)
    await this.saveLatestPlayed()
  }
}

export default new Recent()