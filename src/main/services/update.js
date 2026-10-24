const { app, shell } = require("electron")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { spawn } = require("child_process")
const { Readable } = require("stream")
const { pipeline } = require("stream/promises")

// GitHub相关配置
const GITHUB_REPO = "AH23333/MusicPlayer"
const CURRENT_VERSION = app.getVersion()

// 一键更新时必须保留的用户数据（与 scripts/sync-to-packaged.ps1 的排除清单保持一致）
const USER_DATA_FILES = [
  "MyFavorite.json",
  "Latest.json",
  "FollowedArtists.json",
  "DIYSongList.json",
  "PlayList.json",
  "SearchHistory.json",
  "log.txt",
]
const USER_DATA_DIRS = ["DIYSongListPage", "ImportLocalSongs"]

let downloadAbort = null

// ========== 版本比较 ==========
function parseVersion(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

// ========== 获取最新版本信息 ==========
// GitHub API：获取最新 Release（含 assets，用于一键更新）
async function getLatestRelease() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        "User-Agent": "MusicPlayer-Updater",
        Accept: "application/vnd.github+json",
      },
    }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!data || !data.tag_name) throw new Error("响应缺少版本标签")
  return data
}

// 从 assets 中挑选便携版 zip（当前发布形态：MusicPlayer-win32-x64-vX.Y.Z.zip）
function pickZipAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const zips = assets.filter(
    (a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".zip")
  )
  if (!zips.length) return null
  return (
    zips.find((a) => /win32/i.test(a.name) && /x64/i.test(a.name)) ||
    zips.find((a) => /win/i.test(a.name)) ||
    zips[0]
  )
}

// 兜底：Releases RSS feed（API 限流/不可用时仅比较版本号，不提供一键更新）
async function getLatestVersionFromAtom() {
  const feedUrl = `https://github.com/${GITHUB_REPO}/releases.atom`
  const response = await fetch(feedUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  const versionMatch = text.match(/v?(\d+\.\d+\.\d+)/)
  return versionMatch ? versionMatch[1] : null
}

// 检查更新
async function checkForUpdates() {
  const currentVersion = CURRENT_VERSION
  try {
    const release = await getLatestRelease()
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "")
    const asset = pickZipAsset(release)
    const hasUpdate = isNewerVersion(latestVersion, currentVersion)
    return {
      success: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      message: hasUpdate ? "发现新版本" : "当前已是最新版本",
      openGitHub: !asset,
      downloadUrl: hasUpdate && asset ? asset.browser_download_url : null,
      assetName: asset ? asset.name : null,
      assetSize: asset ? asset.size : null,
      assetDigest:
        asset &&
        typeof asset.digest === "string" &&
        asset.digest.startsWith("sha256:")
          ? asset.digest.slice(7)
          : null,
      releaseUrl:
        release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    }
  } catch (err) {
    console.error(`获取最新版本失败：${err.message}`)
    try {
      const latestVersion = await getLatestVersionFromAtom()
      const hasUpdate = isNewerVersion(latestVersion, currentVersion)
      return {
        success: true,
        hasUpdate,
        currentVersion,
        latestVersion,
        message: hasUpdate ? "发现新版本（未能获取下载信息）" : "当前已是最新版本",
        openGitHub: hasUpdate,
        downloadUrl: null,
        assetName: null,
        assetSize: null,
        assetDigest: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
      }
    } catch (atomErr) {
      return {
        success: false,
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
        message: "检查更新失败，请稍后重试或前往 GitHub 查看",
        openGitHub: true,
        downloadUrl: null,
        assetName: null,
        assetSize: null,
        assetDigest: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
      }
    }
  }
}

// ========== 一键更新：下载 ==========
function updateTempDir() {
  const dir = path.join(app.getPath("temp"), "MusicPlayerUpdate")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 流式下载更新包到临时目录（支持取消与 sha256 校验），onProgress({received,total,percent})
async function downloadUpdate(url, expectedSha256, onProgress) {
  if (
    !url ||
    typeof url !== "string" ||
    !url.startsWith(`https://github.com/${GITHUB_REPO}/releases/`)
  ) {
    return { success: false, error: "无效的下载地址" }
  }
  if (downloadAbort) downloadAbort.abort()
  const controller = new AbortController()
  downloadAbort = controller

  let fileName = "update.zip"
  try {
    fileName = path.basename(new URL(url).pathname) || "update.zip"
  } catch (e) {}
  const destPath = path.join(updateTempDir(), fileName)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MusicPlayer-Updater" },
    })
    if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
    const total = Number(res.headers.get("content-length")) || 0
    const nodeStream = Readable.fromWeb(res.body)
    let received = 0
    let lastNotify = 0
    nodeStream.on("data", (chunk) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastNotify >= 200 && onProgress) {
        lastNotify = now
        onProgress({
          received,
          total,
          percent: total > 0 ? Math.floor((received / total) * 100) : -1,
        })
      }
    })
    const out = fs.createWriteStream(destPath)
    await pipeline(nodeStream, out)
    if (controller.signal.aborted) throw new Error("已取消下载")

    // sha256 校验（GitHub API 提供 digest 时）
    if (expectedSha256) {
      const actual = await new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256")
        fs.createReadStream(destPath)
          .on("data", (d) => hash.update(d))
          .on("end", () => resolve(hash.digest("hex")))
          .on("error", reject)
      })
      if (actual !== String(expectedSha256).toLowerCase()) {
        try {
          fs.unlinkSync(destPath)
        } catch (e) {}
        return { success: false, error: "安装包校验失败，请重试" }
      }
    }
    if (onProgress) onProgress({ received, total, percent: 100 })
    return { success: true, filePath: destPath, size: received }
  } catch (err) {
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
    } catch (e) {}
    const cancelled =
      controller.signal.aborted ||
      (err && (err.name === "AbortError" || err.message === "已取消下载"))
    return {
      success: false,
      cancelled: !!cancelled,
      error: cancelled ? "已取消下载" : (err && err.message) || "下载失败",
    }
  } finally {
    if (downloadAbort === controller) downloadAbort = null
  }
}

function cancelUpdate() {
  if (downloadAbort) downloadAbort.abort()
  return { success: true }
}

// ========== 一键更新：解压 ==========
// 解压更新包，返回包含 MusicPlayer.exe 的新版应用根目录
function prepareUpdate(zipPath) {
  return new Promise((resolve) => {
    if (!zipPath || typeof zipPath !== "string" || !fs.existsSync(zipPath)) {
      resolve({ success: false, error: "更新包不存在" })
      return
    }
    const resolved = path.resolve(zipPath)
    const tempRoot = updateTempDir()
    if (!resolved.startsWith(tempRoot)) {
      resolve({ success: false, error: "无效的更新包路径" })
      return
    }
    const extractDir = path.join(tempRoot, "extracted")
    try {
      fs.rmSync(extractDir, { recursive: true, force: true })
    } catch (e) {}
    fs.mkdirSync(extractDir, { recursive: true })

    // 系统自带 tar.exe（Win10 1803+）支持解压 zip，无需额外依赖
    const tar = spawn("tar", ["-xf", resolved, "-C", extractDir], {
      windowsHide: true,
    })
    let stderr = ""
    tar.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    tar.on("error", (err) => {
      resolve({ success: false, error: `解压失败：${err.message}` })
    })
    tar.on("close", (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `解压失败：${stderr.trim() || `exit ${code}`}`,
        })
        return
      }
      // 定位包含 MusicPlayer.exe 的目录（zip 内为 MusicPlayer-win32-x64/）
      let newRoot = fs.existsSync(path.join(extractDir, "MusicPlayer.exe"))
        ? extractDir
        : null
      if (!newRoot) {
        try {
          for (const name of fs.readdirSync(extractDir)) {
            const sub = path.join(extractDir, name)
            if (
              fs.statSync(sub).isDirectory() &&
              fs.existsSync(path.join(sub, "MusicPlayer.exe"))
            ) {
              newRoot = sub
              break
            }
          }
        } catch (e) {}
      }
      if (!newRoot) {
        resolve({ success: false, error: "更新包结构异常：未找到 MusicPlayer.exe" })
        return
      }
      resolve({ success: true, newRoot })
    })
  })
}

// ========== 一键更新：应用更新 ==========
// 生成并启动更新脚本：等待应用退出 → 覆盖程序文件（保留用户数据）→ 重启应用
function installUpdate(newRoot) {
  return new Promise((resolve) => {
    if (!app.isPackaged) {
      resolve({ success: false, error: "开发模式不支持一键更新，请手动替换文件" })
      return
    }
    if (
      !newRoot ||
      typeof newRoot !== "string" ||
      !fs.existsSync(path.join(path.resolve(newRoot), "MusicPlayer.exe"))
    ) {
      resolve({ success: false, error: "无效的更新目录" })
      return
    }
    const newRootResolved = path.resolve(newRoot)
    const tempRoot = updateTempDir()
    if (!newRootResolved.startsWith(path.join(tempRoot, "extracted"))) {
      resolve({ success: false, error: "无效的更新目录" })
      return
    }

    const appRoot = path.dirname(process.execPath)
    const scriptPath = path.join(tempRoot, "apply-update.cmd")
    const logPath = path.join(tempRoot, "update.log")
    const pid = process.pid
    const exePath = path.join(appRoot, "MusicPlayer.exe")
    const xf = USER_DATA_FILES.map((f) => `"${f}"`).join(" ")
    const xd = USER_DATA_DIRS.map((d) => `"${d}"`).join(" ")

    const lines = [
      "@echo off",
      "chcp 65001 >nul",
      "title MusicPlayer Update",
      // 等待应用进程退出（最多 30 秒；timeout.exe 在隐藏窗口下不可靠，改用 PowerShell）
      `powershell -NoProfile -Command "$d=30; while($d -gt 0 -and (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)){ Start-Sleep -Seconds 1; $d-- }" >nul 2>&1`,
      // 确保后台 API 进程退出，避免文件占用
      "taskkill /F /IM music-dl-api.exe >nul 2>&1",
      // 覆盖程序文件，排除用户数据文件与目录（robocopy 退出码 0-7 为成功）
      `robocopy "${newRootResolved}" "${appRoot}" /E /XF ${xf} /XD ${xd} /R:3 /W:2 /NFL /NDL /NJH /NJS /NP >>"${logPath}" 2>&1`,
      "set rc=%errorlevel%",
      // 清理解压产物
      `rd /s /q "${path.join(tempRoot, "extracted")}" >nul 2>&1`,
      // 成功则重启应用
      `if %rc% leq 7 start "" "${exePath}"`,
      "exit /b %rc%",
    ]
    fs.writeFileSync(scriptPath, lines.join("\r\n"), "utf8")

    const child = spawn("cmd.exe", ["/c", scriptPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
    resolve({ success: true })
    setTimeout(() => {
      try {
        app.quit()
      } catch (e) {}
    }, 500)
  })
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
  openDownloadPage,
  downloadUpdate,
  cancelUpdate,
  prepareUpdate,
  installUpdate,
}
