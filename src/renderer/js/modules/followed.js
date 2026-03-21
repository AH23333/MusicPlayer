import store from '../store/index.js'
import api from '../services/api.js'

class Followed {
  // 加载关注歌手
  async loadFollowedArtists() {
    try {
      const followedArtists = await api.readFollowedArtists()
      store.dispatch('setFollowedArtists', followedArtists)
      return followedArtists
    } catch (error) {
      console.error('加载关注歌手失败:', error)
      return []
    }
  }

  // 保存关注歌手
  async saveFollowedArtists() {
    const state = store.getState()
    await api.saveFollowedArtists(state.followedArtists)
  }

  // 切换歌手关注状态
  async toggleFollowed(artist) {
    store.dispatch('toggleFollowedArtist', artist)
    await this.saveFollowedArtists()
  }

  // 检查歌手是否被关注
  isFollowed(artistName) {
    const state = store.getState()
    return state.followedArtists.some(artist => artist.name === artistName)
  }

  // 获取关注歌手列表
  getFollowedArtists() {
    const state = store.getState()
    return state.followedArtists
  }

  // 获取关注歌手数量
  getFollowedCount() {
    const state = store.getState()
    return state.followedArtists.length
  }

  // 清空关注歌手
  async clearFollowedArtists() {
    store.dispatch('setFollowedArtists', [])
    await this.saveFollowedArtists()
  }
}

export default new Followed()