const { app, shell } = require("electron")

// GitHub相关配置
const GITHUB_REPO = "AH23333/MusicPlayer"
const CURRENT_VERSION = app.getVersion()

// 获取最新版本信息（使用GitHub Releases RSS feed）
async function getLatestVersion() {
  try {
    const feedUrl = `https://github.com/${GITHUB_REPO}/releases.atom`
    const response = await fetch(feedUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()

    // 使用简单的字符串匹配提取最新版本号
    const versionMatch = text.match(/v?(\d+\.\d+\.\d+)/)
    if (versionMatch) {
      return versionMatch[1]
    }

    // 如果没有找到版本号，返回默认版本
    return "1.0.0"
  } catch (err) {
    console.error(`获取最新版本失败：${err.message}`)
    return "1.0.0"
  }
}

// 检查更新
async function checkForUpdates() {
  try {
    const latestVersion = await getLatestVersion()
    const currentVersion = CURRENT_VERSION

    if (latestVersion) {
      // 简单的版本比较
      const hasUpdate = latestVersion !== currentVersion
      return {
        success: true,
        hasUpdate: hasUpdate,
        currentVersion: currentVersion,
        latestVersion: latestVersion,
        message: hasUpdate ? "发现新版本" : "当前已是最新版本",
        openGitHub: true,
      }
    } else {
      // 如果获取版本失败，仍然允许用户前往GitHub
      return {
        success: true,
        hasUpdate: true,
        message: "检查更新",
        openGitHub: true,
      }
    }
  } catch (err) {
    console.error(`检查更新失败：${err.message}`)
    return {
      success: true,
      hasUpdate: true,
      message: "检查更新",
      openGitHub: true,
    }
  }
}

// 打开下载页面
async function openDownloadPage(url) {
  if (url) {
    await shell.openExternal(url)
    return { success: true }
  }
  // 如果没有提供URL，打开GitHub releases页面
  await shell.openExternal(`https://github.com/${GITHUB_REPO}/releases`)
  return { success: true }
}

module.exports = {
  checkForUpdates,
  openDownloadPage
}