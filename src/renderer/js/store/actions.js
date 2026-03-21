// 状态变更函数
const actions = {
  // 设置播放队列
  setPlayQueue(state, queue) {
    state.playQueue = queue
  },
  
  // 添加歌曲到播放队列
  addToPlayQueue(state, song) {
    state.playQueue.push(song)
  },
  
  // 从播放队列移除歌曲
  removeFromPlayQueue(state, index) {
    state.playQueue.splice(index, 1)
    if (state.currentSongIndex > index) {
      state.currentSongIndex--
    } else if (state.currentSongIndex === index) {
      state.currentSongIndex = Math.max(0, state.currentSongIndex - 1)
    }
  },
  
  // 清空播放队列
  clearPlayQueue(state) {
    state.playQueue = []
    state.currentSongIndex = -1
  },
  
  // 设置当前播放索引
  setCurrentSongIndex(state, index) {
    state.currentSongIndex = index
  },
  
  // 设置播放模式
  setPlayMode(state, mode) {
    state.playMode = mode
  },
  
  // 设置我喜欢的歌曲
  setLikedSongs(state, songs) {
    state.likedSongs = songs
  },
  
  // 切换歌曲喜欢状态
  toggleLikedSong(state, songId) {
    const index = state.likedSongs.findIndex(song => song.id === songId)
    if (index > -1) {
      state.likedSongs.splice(index, 1)
    } else {
      const song = state.playQueue.find(song => song.id === songId)
      if (song) {
        state.likedSongs.push(song)
      }
    }
  },
  
  // 设置关注歌手
  setFollowedArtists(state, artists) {
    state.followedArtists = artists
  },
  
  // 切换歌手关注状态
  toggleFollowedArtist(state, artist) {
    const index = state.followedArtists.findIndex(a => a.name === artist.name)
    if (index > -1) {
      state.followedArtists.splice(index, 1)
    } else {
      state.followedArtists.push(artist)
    }
  },
  
  // 设置自定义歌单
  setDIYPlaylists(state, playlists) {
    state.diyPlaylists = playlists
  },
  
  // 添加自定义歌单
  addDIYPlaylist(state, playlist) {
    state.diyPlaylists.push(playlist)
  },
  
  // 删除自定义歌单
  removeDIYPlaylist(state, playlistId) {
    state.diyPlaylists = state.diyPlaylists.filter(playlist => playlist.id !== playlistId)
  },
  
  // 更新自定义歌单
  updateDIYPlaylist(state, playlist) {
    const index = state.diyPlaylists.findIndex(p => p.id === playlist.id)
    if (index > -1) {
      state.diyPlaylists[index] = playlist
    }
  },
  
  // 设置最近播放
  setLatestPlayed(state, songs) {
    state.latestPlayed = songs
  },
  
  // 添加最近播放歌曲
  addToLatestPlayed(state, song) {
    // 移除已存在的相同歌曲
    state.latestPlayed = state.latestPlayed.filter(s => s.id !== song.id)
    // 添加到开头
    state.latestPlayed.unshift(song)
    // 限制最近播放数量
    if (state.latestPlayed.length > 50) {
      state.latestPlayed = state.latestPlayed.slice(0, 50)
    }
  },
  
  // 设置本地歌曲
  setLocalSongs(state, songs) {
    state.localSongs = songs
  },
  
  // 设置搜索历史
  setSearchHistory(state, history) {
    state.searchHistory = history
  },
  
  // 添加搜索历史
  addSearchHistory(state, keyword) {
    // 移除已存在的相同关键词
    state.searchHistory = state.searchHistory.filter(item => item !== keyword)
    // 添加到开头
    state.searchHistory.unshift(keyword)
    // 限制搜索历史数量
    if (state.searchHistory.length > 10) {
      state.searchHistory = state.searchHistory.slice(0, 10)
    }
  },
  
  // 清空搜索历史
  clearSearchHistory(state) {
    state.searchHistory = []
  },
  
  // 设置搜索结果
  setSearchResults(state, results) {
    state.searchResults = results
  },
  
  // 添加搜索结果（加载更多）
  addSearchResults(state, results) {
    state.searchResults = [...state.searchResults, ...results]
  },
  
  // 设置搜索偏移量
  setSearchOffset(state, offset) {
    state.searchOffset = offset
  },
  
  // 设置加载更多标志
  setLoadingMore(state, loading) {
    state.loadingMore = loading
  },
  
  // 设置是否有更多结果
  setHasMore(state, hasMore) {
    state.hasMore = hasMore
  }
}

export default actions