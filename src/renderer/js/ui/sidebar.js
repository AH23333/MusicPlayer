// 侧边栏 UI 模块
class SidebarModule {
  constructor() {
    this.store = null;
    this.playlistDetail = null;
    this.sidebarElement = null;
  }

  init(store, playlistDetail) {
    this.store = store;
    this.playlistDetail = playlistDetail;
    this.sidebarElement = document.querySelector('.sidebar');
    this.render();
    this.bindEvents();
    this.subscribeToStore();
  }

  // 渲染侧边栏
  render() {
    if (!this.sidebarElement) return;

    const state = this.store.getState();
    
    // 渲染用户信息区
    this.renderUserInfo();
    
    // 渲染功能按钮
    this.renderFunctionButtons();
    
    // 渲染自定义歌单
    this.renderDIYPlaylists(state.diyPlaylists);
  }

  // 渲染用户信息区
  renderUserInfo() {
    const userInfo = this.sidebarElement.querySelector('.user-info');
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="avatar w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center">
          <i class="bi bi-person text-2xl text-gray-500"></i>
        </div>
        <div class="user-details">
          <h3 class="user-name text-lg font-semibold">用户</h3>
          <p class="user-desc text-sm text-gray-500">欢迎使用音乐播放器</p>
        </div>
      `;
    }
  }

  // 渲染功能按钮
  renderFunctionButtons() {
    const functionButtons = this.sidebarElement.querySelector('.function-buttons');
    if (functionButtons) {
      functionButtons.innerHTML = `
        <div class="sidebar-item" data-type="followed">
          <i class="bi bi-person-check"></i>
          <span>关注歌手</span>
        </div>
        <div class="sidebar-item" data-type="liked">
          <i class="bi bi-heart"></i>
          <span>我喜欢</span>
          <span class="badge">${this.store.getState().likedSongs.length}</span>
        </div>
        <div class="sidebar-item" data-type="recent">
          <i class="bi bi-clock-history"></i>
          <span>最近播放</span>
        </div>
        <div class="sidebar-item" data-type="local">
          <i class="bi bi-folder"></i>
          <span>本地歌曲</span>
        </div>
      `;
    }
  }

  // 渲染自定义歌单
  renderDIYPlaylists(playlists) {
    const playlistSection = this.sidebarElement.querySelector('.playlist-section');
    if (playlistSection) {
      const playlistList = playlistSection.querySelector('.playlist-list');
      if (playlistList) {
        playlistList.innerHTML = playlists.map(playlist => `
          <div class="sidebar-item playlist-item" data-id="${playlist.id}">
            <i class="bi bi-music-note-list"></i>
            <span>${playlist.name}</span>
            <span class="badge">${playlist.songs.length}</span>
          </div>
        `).join('');
      }
    }
  }

  // 绑定事件
  bindEvents() {
    if (!this.sidebarElement) return;

    // 功能按钮点击事件
    this.sidebarElement.addEventListener('click', (e) => {
      const sidebarItem = e.target.closest('.sidebar-item');
      if (sidebarItem) {
        // 移除所有选中状态
        document.querySelectorAll('.sidebar-item').forEach(item => {
          item.classList.remove('active');
        });
        // 添加当前选中状态
        sidebarItem.classList.add('active');

        // 处理不同类型的点击
        if (sidebarItem.dataset.type) {
          this.handleFunctionButtonClick(sidebarItem.dataset.type);
        } else if (sidebarItem.dataset.id) {
          this.handlePlaylistClick(sidebarItem.dataset.id);
        }
      }
    });
  }

  // 处理功能按钮点击
  handleFunctionButtonClick(type) {
    const state = this.store.getState();
    let playlist = null;

    switch (type) {
      case 'followed':
        playlist = {
          id: 'followed',
          name: '关注歌手',
          songs: state.followedArtists.flatMap(artist => artist.songs || [])
        };
        break;
      case 'liked':
        playlist = {
          id: 'liked',
          name: '我喜欢',
          songs: state.likedSongs
        };
        break;
      case 'recent':
        playlist = {
          id: 'recent',
          name: '最近播放',
          songs: state.latestPlayed
        };
        break;
      case 'local':
        playlist = {
          id: 'local',
          name: '本地歌曲',
          songs: state.localSongs
        };
        break;
    }

    if (playlist) {
      this.playlistDetail.show(playlist);
    }
  }

  // 处理歌单点击
  handlePlaylistClick(playlistId) {
    const playlist = this.store.getState().diyPlaylists.find(p => p.id === playlistId);
    if (playlist) {
      this.playlistDetail.show(playlist);
    }
  }

  // 订阅 store 变化
  subscribeToStore() {
    this.store.subscribe(() => {
      this.render();
    });
  }
}

const sidebar = new SidebarModule();
export default sidebar;