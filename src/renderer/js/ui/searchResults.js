// 搜索结果 UI 模块
class SearchResultsModule {
  constructor() {
    this.store = null;
    this.player = null;
    this.liked = null;
    this.playlist = null;
    this.resultsElement = null;
  }

  init(store, player, liked, playlist) {
    this.store = store;
    this.player = player;
    this.liked = liked;
    this.playlist = playlist;
    this.resultsElement = document.querySelector('.search-results');
    this.bindEvents();
    this.subscribeToStore();
  }

  // 渲染搜索结果
  render() {
    if (!this.resultsElement) return;

    const state = this.store.getState();
    const results = state.searchResults;
    const isLoading = state.isSearching;
    const hasMore = state.hasMoreResults;

    if (isLoading && results.length === 0) {
      this.resultsElement.innerHTML = `
        <div class="loading-state text-center py-10">
          <div class="spinner border-4 border-gray-200 border-t-primary rounded-full w-8 h-8 animate-spin mx-auto"></div>
          <p class="mt-2 text-gray-500">搜索中...</p>
        </div>
      `;
      return;
    }

    if (results.length === 0) {
      this.resultsElement.innerHTML = `
        <div class="empty-state text-center py-10">
          <i class="bi bi-search text-4xl text-gray-300"></i>
          <p class="mt-2 text-gray-500">暂无搜索结果</p>
        </div>
      `;
      return;
    }

    this.resultsElement.innerHTML = `
      <div class="search-results-list">
        ${results.map((song, index) => {
          const isLiked = state.likedSongs.some(s => s.id === song.id);
          return `
            <div class="song-item" data-index="${index}" data-id="${song.id}">
              <div class="song-index w-8 text-center">${index + 1}</div>
              <div class="song-info flex-1">
                <div class="song-name">${song.name}</div>
                <div class="song-artist text-sm text-gray-500">${song.artist}</div>
              </div>
              <div class="song-duration w-16 text-right text-sm text-gray-500">
                ${song.duration || ''}
              </div>
              <div class="song-actions">
                <button class="action-btn like-btn ${isLiked ? 'liked' : ''}">
                  <i class="bi ${isLiked ? 'bi-heart-fill text-red-500' : 'bi-heart'}"></i>
                </button>
                <button class="action-btn add-btn">
                  <i class="bi bi-plus"></i>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${hasMore ? `
        <div class="load-more text-center py-4">
          <button class="btn btn-outline load-more-btn">
            加载更多
          </button>
        </div>
      ` : ''}
    `;

    // 绑定歌曲项事件
    this.bindSongItemEvents();

    // 绑定加载更多按钮事件
    const loadMoreBtn = this.resultsElement.querySelector('.load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.loadMore();
      });
    }
  }

  // 绑定歌曲项事件
  bindSongItemEvents() {
    const songItems = this.resultsElement.querySelectorAll('.song-item');
    songItems.forEach(item => {
      // 双击播放
      item.addEventListener('dblclick', () => {
        const index = parseInt(item.dataset.index);
        this.playSong(index);
      });

      // 点击喜欢按钮
      const likeBtn = item.querySelector('.like-btn');
      if (likeBtn) {
        likeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const songId = item.dataset.id;
          const song = this.store.getState().searchResults.find(s => s.id === songId);
          if (song) {
            this.liked.toggleLike(song);
          }
        });
      }

      // 点击添加按钮
      const addBtn = item.querySelector('.add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const songId = item.dataset.id;
          const song = this.store.getState().searchResults.find(s => s.id === songId);
          if (song) {
            this.playlist.addToPlaylist(song);
          }
        });
      }
    });
  }

  // 加载更多结果
  loadMore() {
    // 触发加载更多操作
    // 这里可以通过 store 或直接调用 search 模块的方法
    console.log('加载更多搜索结果');
  }

  // 播放指定歌曲
  playSong(index) {
    const song = this.store.getState().searchResults[index];
    if (song) {
      // 清空当前播放列表
      this.playlist.clearPlaylist();
      // 添加当前歌曲
      this.playlist.addToPlaylist(song);
      // 播放
      this.player.playSong(0);
    }
  }

  // 绑定事件
  bindEvents() {
    // 可以添加其他事件绑定
  }

  // 订阅 store 变化
  subscribeToStore() {
    this.store.subscribe(() => {
      this.render();
    });
  }
}

const searchResults = new SearchResultsModule();
export default searchResults;