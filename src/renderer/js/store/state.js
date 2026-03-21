// 初始状态定义
const initialState = {
  // 播放队列
  playQueue: [],
  // 当前播放索引
  currentSongIndex: -1,
  // 播放模式
  playMode: "order", // order, reverse, singleLoop, listLoop, shuffle
  // 我喜欢的歌曲
  likedSongs: [],
  // 关注歌手
  followedArtists: [],
  // 自定义歌单
  diyPlaylists: [],
  // 最近播放
  latestPlayed: [],
  // 本地歌曲
  localSongs: [],
  // 搜索历史
  searchHistory: [],
  // 搜索结果
  searchResults: [],
  // 搜索偏移量
  searchOffset: 0,
  // 加载更多标志
  loadingMore: false,
  // 是否有更多结果
  hasMore: true
}

export default initialState