import store from '../store/index.js'
import api from '../services/api.js'

class DIYPlaylists {
  // 加载自建歌单
  async loadDIYPlaylists() {
    try {
      const playlists = await api.readDIYPlaylists()
      store.dispatch('setDIYPlaylists', playlists)
      return playlists
    } catch (error) {
      console.error('加载自建歌单失败:', error)
      return []
    }
  }

  // 保存自建歌单
  async saveDIYPlaylists() {
    const state = store.getState()
    await api.saveDIYPlaylists(state.diyPlaylists)
  }

  // 创建自建歌单
  async createPlaylist(name, description = '', coverPath = '') {
    const newPlaylist = {
      id: `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      coverPath,
      songs: []
    }
    store.dispatch('addDIYPlaylist', newPlaylist)
    await this.saveDIYPlaylists()
    return newPlaylist
  }

  // 删除自建歌单
  async deletePlaylist(playlistId) {
    store.dispatch('removeDIYPlaylist', playlistId)
    await this.saveDIYPlaylists()
  }

  // 更新自建歌单
  async updatePlaylist(playlist) {
    store.dispatch('updateDIYPlaylist', playlist)
    await this.saveDIYPlaylists()
  }

  // 添加歌曲到歌单
  async addSongToPlaylist(playlistId, song) {
    const state = store.getState()
    const playlist = state.diyPlaylists.find(p => p.id === playlistId)
    if (playlist) {
      // 检查歌曲是否已存在
      if (!playlist.songs.some(s => s.id === song.id)) {
        playlist.songs.push(song)
        await this.updatePlaylist(playlist)
      }
    }
  }

  // 从歌单移除歌曲
  async removeSongFromPlaylist(playlistId, songId) {
    const state = store.getState()
    const playlist = state.diyPlaylists.find(p => p.id === playlistId)
    if (playlist) {
      playlist.songs = playlist.songs.filter(s => s.id !== songId)
      await this.updatePlaylist(playlist)
    }
  }

  // 获取自建歌单列表
  getDIYPlaylists() {
    const state = store.getState()
    return state.diyPlaylists
  }

  // 获取单个歌单
  getPlaylistById(playlistId) {
    const state = store.getState()
    return state.diyPlaylists.find(p => p.id === playlistId)
  }

  // 保存歌单封面
  async savePlaylistCover(playlistId, coverData) {
    try {
      const result = await api.savePlaylistCover({ playlistId, coverData })
      if (result.success) {
        const state = store.getState()
        const playlist = state.diyPlaylists.find(p => p.id === playlistId)
        if (playlist) {
          playlist.coverPath = result.coverPath
          await this.updatePlaylist(playlist)
        }
        return result
      }
      return { success: false }
    } catch (error) {
      console.error('保存歌单封面失败:', error)
      return { success: false }
    }
  }
}

export default new DIYPlaylists()