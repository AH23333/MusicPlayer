# MusicPlayer

个人项目，AI生成，仅供学习娱乐，不可商用

## 项目功能

- 🔍 音乐搜索功能
- ❤️ 我喜欢的歌曲
- 📚 最近播放
- 💾 本地和下载
  - 支持导入本地音频文件（mp3、wav、flac、m4a）
  - 自动提取歌曲信息
  - 支持删除本地歌曲
- 🎵 自建歌单
- 🎛️ 多种播放模式（顺序、倒序、单曲循环、列表循环、随机）
- 📝 歌词显示
- 🌙 深色/浅色模式切换

## 项目特色

- 无登录权限，无需注册即可使用
- 无需配置数据库，所有数据均存储在本地文件中
- 离线播放
- 跨平台支持（Windows、macOS、Linux）

## 技术栈

- Electron - 跨平台桌面应用框架
- Tailwind CSS - 实用优先的CSS框架
- JavaScript - 应用逻辑实现
- axios - 网络请求库（用于搜索音乐、获取歌词）

## 从零开始配置步骤

### 1. 安装Node.js

首先确保你的系统已安装Node.js（建议使用LTS版本）。

### 2. 清理现有依赖（如果需要）

如果当前node\_modules存在则需要重新安装：

```bash
# 删除现有的node_modules文件夹（如果有的话）
# Linux/Mac系统
rm -rf node_modules
# Windows系统
rmdir /s node_modules
```

### 3. 安装项目依赖

```bash
# 在项目根目录下安装所有依赖（包括开发依赖）
npm install
```

### 4. 运行和构建命令

项目提供了以下主要脚本命令：

```bash
# 启动开发模式
npm start

# 打包应用（生成未签名的应用包）
npm run package

# 构建可执行文件（生成.exe安装包）
npm run make
```

### 5. 本地信息管理

- 支持导入多种音频格式：mp3、wav、flac、m4a
- 导入的歌曲会自动提取信息并显示在"本地和下载"页面
- 删除歌曲会从本地文件系统删除对应的文件
- 本地歌曲存储在项目根目录的 `ImportLocalSongs` 文件夹中
- 自定义歌单封面存储在项目根目录的 `DIYSongListPage` 文件夹中
- 搜索历史会存储在 `SearchHistory.json` 文件中
- 自建歌单数据存储在 `DIYSongList.json` 文件中
- “我喜欢的歌曲”数据存储在 `MyFavorite.json` 文件中
- “最近播放”数据存储在 `Latest.json` 文件中
- 播放列表数据存储在 `PlayList.json` 文件中

## 注意事项

- 本项目仅供学习和娱乐使用，不可商用
- 歌曲搜索功能依赖于网络API，可能会受到网络环境影响
- 本地歌曲导入功能仅支持音频文件，不支持其他格式

## 项目结构

- `main.js` - Electron主进程代码
- `renderer.js` - 渲染进程代码
- `preload.js` - 预加载脚本
- `index.html` - 主界面
- `style.css` - 样式文件
- `utils.js` - 工具函数
- `ImportLocalSongs/` - 本地歌曲存储目录
- `DIYSongListPage/` - 自建歌单封面存储目录
- `MyFavorite.json` - 我喜欢的歌曲数据
- `Latest.json` - 最近播放数据
- `DIYSongList.json` - 自建歌单数据
- `SearchHistory.json` - 搜索历史数据
- `PlayList.json` - 播放列表数据
- `package.json` - 项目配置文件

## 贡献指南

- 欢迎提交Pull Request改进项目
- 请确保代码符合项目的编码规范
- 提交前请先创建一个Issue描述您的更改内容
- 每个Pull Request应该只包含一个功能或修复
- 请在Pull Request描述中详细说明您的更改内容
- 确保所有测试都通过
- 欢迎提供测试用例

## 开发指南

- 由于项目作者太菜，在进行网页端部署时对项目进行了巨多修改，导致本地开发者难以对本项目二次开发
- 故在进行二次开发前，请仔细参考以下条目对项目结构进行删改，以便于开发
- 以下为适配本地开发的更改明细：
- 删除renderer.js文件头部的“浏览器环境兼容补丁”部分
- 删除utils.js文件头部的“仅浏览器环境下的兼容补丁”部分；使用已被注释掉的CORS代理请求函数exports.fetchViaProxy，删除第二个exports.fetchViaProxy函数；删除utils.js文件尾部的“浏览器环境挂载”部分
- 删除index.html文件头部的“启动提示浮窗”div块
- 删除index.html文件尾部的

```
  <script src="https://unpkg.com/axios@1.6.8/dist/axios.min.js"></script>
  <script src="./utils.js"></script>
  <script>
    // 关闭浮窗逻辑
    document.getElementById('dismiss-startup').addEventListener('click', function() {
      const overlay = document.getElementById('startup-overlay');
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 300); // 等待过渡动画结束
    });
  </script>
```

- 未完待续\~

## 参考项目

- [aura-music](https://github.com/dingyi222666/aura-music.git)
- [Meting](https://github.com/metowolf/Meting.git)

# 更新日志

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
