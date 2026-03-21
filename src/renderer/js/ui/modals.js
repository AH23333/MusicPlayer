// 模态框管理模块
class ModalsModule {
  constructor() {
    this.store = null;
    this.diyPlaylists = null;
    this.modalElement = null;
    this.currentModal = null;
  }

  init(store, diyPlaylists) {
    this.store = store;
    this.diyPlaylists = diyPlaylists;
    this.modalElement = document.querySelector('.modal');
    this.bindEvents();
  }

  // 打开模态框
  open(type, data = {}) {
    if (!this.modalElement) return;

    this.currentModal = type;
    this.renderModal(type, data);
    this.modalElement.classList.remove('hidden');
  }

  // 关闭模态框
  close() {
    if (this.modalElement) {
      this.modalElement.classList.add('hidden');
      this.currentModal = null;
    }
  }

  // 渲染模态框
  renderModal(type, data) {
    if (!this.modalElement) return;

    switch (type) {
      case 'createPlaylist':
        this.renderCreatePlaylistModal();
        break;
      case 'editPlaylist':
        this.renderEditPlaylistModal(data);
        break;
      case 'deletePlaylist':
        this.renderDeletePlaylistModal(data);
        break;
      case 'deleteSong':
        this.renderDeleteSongModal(data);
        break;
      case 'update':
        this.renderUpdateModal(data);
        break;
      default:
        break;
    }
  }

  // 渲染创建歌单模态框
  renderCreatePlaylistModal() {
    this.modalElement.innerHTML = `
      <div class="modal-content">
        <div class="modal-header flex items-center justify-between">
          <h3 class="modal-title">创建歌单</h3>
          <button class="modal-close-btn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body p-4">
          <div class="form-group">
            <label for="playlist-name" class="form-label">歌单名称</label>
            <input type="text" id="playlist-name" class="form-input" placeholder="请输入歌单名称">
          </div>
          <div class="form-group mt-3">
            <label for="playlist-desc" class="form-label">歌单描述</label>
            <textarea id="playlist-desc" class="form-textarea" placeholder="请输入歌单描述" rows="3"></textarea>
          </div>
        </div>
        <div class="modal-footer flex justify-end p-4">
          <button class="btn btn-outline mr-2 cancel-btn">取消</button>
          <button class="btn btn-primary confirm-btn">创建</button>
        </div>
      </div>
    `;

    // 绑定事件
    this.bindCreatePlaylistEvents();
  }

  // 绑定创建歌单事件
  bindCreatePlaylistEvents() {
    const closeBtn = this.modalElement.querySelector('.modal-close-btn');
    const cancelBtn = this.modalElement.querySelector('.cancel-btn');
    const confirmBtn = this.modalElement.querySelector('.confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const name = document.getElementById('playlist-name').value.trim();
        const description = document.getElementById('playlist-desc').value.trim();

        if (name) {
          this.diyPlaylists.createPlaylist(name, description);
          this.close();
        }
      });
    }
  }

  // 渲染编辑歌单模态框
  renderEditPlaylistModal(playlist) {
    this.modalElement.innerHTML = `
      <div class="modal-content">
        <div class="modal-header flex items-center justify-between">
          <h3 class="modal-title">编辑歌单</h3>
          <button class="modal-close-btn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body p-4">
          <div class="form-group">
            <label for="edit-playlist-name" class="form-label">歌单名称</label>
            <input type="text" id="edit-playlist-name" class="form-input" value="${playlist.name}">
          </div>
          <div class="form-group mt-3">
            <label for="edit-playlist-desc" class="form-label">歌单描述</label>
            <textarea id="edit-playlist-desc" class="form-textarea" rows="3">${playlist.description || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer flex justify-end p-4">
          <button class="btn btn-outline mr-2 cancel-btn">取消</button>
          <button class="btn btn-primary confirm-btn">保存</button>
        </div>
      </div>
    `;

    // 绑定事件
    this.bindEditPlaylistEvents(playlist);
  }

  // 绑定编辑歌单事件
  bindEditPlaylistEvents(playlist) {
    const closeBtn = this.modalElement.querySelector('.modal-close-btn');
    const cancelBtn = this.modalElement.querySelector('.cancel-btn');
    const confirmBtn = this.modalElement.querySelector('.confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const name = document.getElementById('edit-playlist-name').value.trim();
        const description = document.getElementById('edit-playlist-desc').value.trim();

        if (name) {
          this.diyPlaylists.updatePlaylist(playlist.id, name, description);
          this.close();
        }
      });
    }
  }

  // 渲染删除歌单模态框
  renderDeletePlaylistModal(playlist) {
    this.modalElement.innerHTML = `
      <div class="modal-content">
        <div class="modal-header flex items-center justify-between">
          <h3 class="modal-title">删除歌单</h3>
          <button class="modal-close-btn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body p-4">
          <p>确定要删除歌单 "${playlist.name}" 吗？</p>
          <p class="text-sm text-gray-500 mt-2">删除后将无法恢复。</p>
        </div>
        <div class="modal-footer flex justify-end p-4">
          <button class="btn btn-outline mr-2 cancel-btn">取消</button>
          <button class="btn btn-danger confirm-btn">删除</button>
        </div>
      </div>
    `;

    // 绑定事件
    this.bindDeletePlaylistEvents(playlist);
  }

  // 绑定删除歌单事件
  bindDeletePlaylistEvents(playlist) {
    const closeBtn = this.modalElement.querySelector('.modal-close-btn');
    const cancelBtn = this.modalElement.querySelector('.cancel-btn');
    const confirmBtn = this.modalElement.querySelector('.confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.diyPlaylists.deletePlaylist(playlist.id);
        this.close();
      });
    }
  }

  // 渲染删除歌曲模态框
  renderDeleteSongModal(song) {
    this.modalElement.innerHTML = `
      <div class="modal-content">
        <div class="modal-header flex items-center justify-between">
          <h3 class="modal-title">删除歌曲</h3>
          <button class="modal-close-btn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body p-4">
          <p>确定要从播放列表中删除歌曲 "${song.name}" 吗？</p>
        </div>
        <div class="modal-footer flex justify-end p-4">
          <button class="btn btn-outline mr-2 cancel-btn">取消</button>
          <button class="btn btn-danger confirm-btn">删除</button>
        </div>
      </div>
    `;

    // 绑定事件
    this.bindDeleteSongEvents(song);
  }

  // 绑定删除歌曲事件
  bindDeleteSongEvents(song) {
    const closeBtn = this.modalElement.querySelector('.modal-close-btn');
    const cancelBtn = this.modalElement.querySelector('.cancel-btn');
    const confirmBtn = this.modalElement.querySelector('.confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        // 这里可以调用播放列表模块的删除方法
        console.log('删除歌曲:', song.name);
        this.close();
      });
    }
  }

  // 渲染更新提示模态框
  renderUpdateModal(updateInfo) {
    this.modalElement.innerHTML = `
      <div class="modal-content">
        <div class="modal-header flex items-center justify-between">
          <h3 class="modal-title">更新提示</h3>
          <button class="modal-close-btn">
            <i class="bi bi-x"></i>
          </button>
        </div>
        <div class="modal-body p-4">
          <p>发现新版本: ${updateInfo.version}</p>
          <p class="text-sm text-gray-500 mt-2">${updateInfo.description || '有新版本可用'}</p>
        </div>
        <div class="modal-footer flex justify-end p-4">
          <button class="btn btn-outline mr-2 cancel-btn">稍后再说</button>
          <button class="btn btn-primary confirm-btn">前往下载</button>
        </div>
      </div>
    `;

    // 绑定事件
    this.bindUpdateEvents(updateInfo);
  }

  // 绑定更新事件
  bindUpdateEvents(updateInfo) {
    const closeBtn = this.modalElement.querySelector('.modal-close-btn');
    const cancelBtn = this.modalElement.querySelector('.cancel-btn');
    const confirmBtn = this.modalElement.querySelector('.confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        // 这里可以打开下载链接
        if (updateInfo.url) {
          window.open(updateInfo.url);
        }
        this.close();
      });
    }
  }

  // 绑定事件
  bindEvents() {
    // 点击模态框背景关闭
    if (this.modalElement) {
      this.modalElement.addEventListener('click', (e) => {
        if (e.target === this.modalElement) {
          this.close();
        }
      });
    }
  }
}

const modals = new ModalsModule();
export default modals;