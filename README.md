# MusicPlayer

个人项目，AI生成，仅供学习娱乐，不可商用

## 📋 项目功能

### 核心功能

- 🔍 **音乐搜索**：支持在线搜索音乐
- 🎶 **关注歌手**：一键关注喜爱的歌手
- ❤️ **我喜欢的歌曲**：收藏喜爱的音乐
- 📚 **最近播放**：记录最近播放的歌曲
- 💾 **本地和下载**：支持导入导出本地音频文件
  - 支持多种音频格式：mp3、wav、flac、m4a
  - 自动提取歌曲信息
  - 支持删除本地歌曲
- 🎵 **自建歌单**：创建和管理个人歌单
- 🎛️ **多种播放模式**：顺序、倒序、单曲循环、列表循环、随机
- 📝 **歌词显示**：实时歌词同步显示
- 🌙 **深色/浅色模式**：根据系统或手动切换
- 🔧 **数据导入导出**：支持个人数据的备份与恢复

## ✨ 项目特色

- **无需登录**：无登录权限，无需注册即可使用
- **本地存储**：无需配置数据库，所有数据均存储在本地文件中
- **离线播放**：支持离线状态下播放本地歌曲
- **跨平台**：支持 Windows、macOS、Linux

## 🛠️ 技术栈

- **Electron**：跨平台桌面应用框架
- **Tailwind CSS**：实用优先的CSS框架
- **JavaScript**：应用逻辑实现
- **axios**：网络请求库（用于搜索音乐、获取歌词）

## 🚀 快速开始

### 1. 环境准备

确保你的系统已安装 Node.js（建议使用 LTS 版本）。

### 2. 安装依赖

```bash
# 克隆仓库
git clone git@github.com:AH23333/MusicPlayer.git
cd MusicPlayer

# 安装依赖
npm install
```

### 3. 运行和构建

```bash
# 启动开发模式
npm start

# 打包应用（生成未签名的应用包）
npm run package

# 构建可执行文件（生成安装包）
npm run make
```

## 📁 项目结构

```
src/
├── main/                           # Electron 主进程
│   ├── main.js                     # 窗口创建、生命周期管理
│   ├── ipcHandlers.js              # IPC 通信处理器
│   ├── preload.js                  # 预加载脚本，安全暴露 API
│   └── services/                   # 主进程服务
│       ├── storage.js              # 文件读写服务
│       ├── update.js               # 更新检查与处理
│       └── logger.js               # 日志服务
│
├── renderer/                       # 渲染进程（前端）
│   ├── index.html                  # 主界面 HTML
│   ├── styles/                     # 样式文件
│   │   └── style.css               # 全局样式
│   ├── js/                         # 前端逻辑
│   │   ├── app.js                  # 应用入口
│   │   ├── store/                  # 状态管理
│   │   │   ├── index.js            # 状态存储
│   │   │   ├── state.js            # 初始状态
│   │   │   └── actions.js          # 状态变更函数
│   │   ├── modules/                # 功能模块
│   │   │   ├── player.js           # 音频播放核心
│   │   │   ├── playlist.js         # 播放列表管理
│   │   │   ├── search.js           # 搜索功能
│   │   │   ├── liked.js            # 我喜欢管理
│   │   │   ├── recent.js           # 最近播放管理
│   │   │   ├── local.js            # 本地歌曲管理
│   │   │   ├── followed.js         # 关注歌手管理
│   │   │   ├── diyPlaylists.js     # 自建歌单管理
│   │   │   └── lyrics.js           # 歌词管理
│   │   ├── ui/                     # UI 组件
│   │   │   ├── sidebar.js          # 侧边栏
│   │   │   ├── playlistDetail.js   # 歌单详情
│   │   │   ├── searchResults.js    # 搜索结果
│   │   │   ├── playerControls.js   # 播放控件
│   │   │   ├── lyricsInterface.js  # 歌词界面
│   │   │   ├── playlistFloat.js    # 播放列表浮窗
│   │   │   ├── modals.js           # 模态框
│   │   │   └── toast.js            # 全局提示
│   │   ├── services/               # 前端服务
│   │   │   ├── api.js              # API 调用
│   │   │   └── storage.js          # 数据持久化
│   │   └── utils/                  # 工具函数
│   │       ├── helpers.js          # 通用工具
│   │       └── dom.js              # DOM 操作
│   └── assets/                     # 静态资源
│
├── config/                         # 配置文件
│   ├── forge.config.js             # Electron Forge 配置
│   ├── tailwind.config.js          # Tailwind 配置
│   └── postcss.config.js           # PostCSS 配置
│
├── package.json                    # 项目配置
└── README.md                       # 项目说明
```

## 💾 本地数据管理

- **本地歌曲**：存储在 `ImportLocalSongs` 文件夹
- **歌单封面**：存储在 `DIYSongListPage` 文件夹
- **搜索历史**：存储在 `SearchHistory.json` 文件
- **自建歌单**：存储在 `DIYSongList.json` 文件
- **我喜欢的歌曲**：存储在 `MyFavorite.json` 文件
- **最近播放**：存储在 `Latest.json` 文件
- **播放列表**：存储在 `PlayList.json` 文件
- **关注歌手**：存储在 `FollowedArtists.json` 文件

## ⚠️ 注意事项

- 本项目仅供学习和娱乐使用，不可商用
- 歌曲搜索功能依赖于网络 API，可能会受到网络环境影响
- 本地歌曲导入功能仅支持音频文件，不支持其他格式

## 🤝 贡献指南

1. **创建 Issue**：描述您的功能建议或问题
2. **Fork 仓库**：创建您的个人分支
3. **开发**：实现功能或修复问题
4. **提交 PR**：详细说明您的更改内容

## 🔄 开发指南

### 二次开发注意事项

- 项目已进行重构，代码结构更加清晰
- 如需在网页端部署，可能需要进行额外的适配，本重构版本不再提供网页兼容
- 开发前请确保安装了所有依赖

## 📚 参考项目

- [aura-music](https://github.com/dingyi222666/aura-music.git)
- [Meting](https://github.com/metowolf/Meting.git)

# 📝 更新日志

## 2026.3.14

- 修复了歌曲导入功能
- 优化了歌曲功能按钮的位置
- 优化了鼠标单击歌曲高亮卡顿的问题
- 优化了播放列表高亮当前正在播放歌曲的问题
- 增加了更多右键功能
- 增加了关注歌手功能
- 增加了歌单导入导出功能
- 增加了用户信息导入导出功能
- 增加了歌词界面在页面过窄时自动调整的功能

## 2026.3.18

- 经过多方测试，当前搜索功能使用的API已失效，正在寻找平替
- 如果找不到就只能漫长的等待了

## 2026.3.19

- 发现是优先使用的API已失效，启用备用API
- 修复了返回数据解析错误导致无法显示歌曲的问题
- 修复了自动打开控制台的问题

## 2026.3.20

- 增加了版本更新功能

## 2026.3.21

- 修复了一些交互及显示问题