// 用 Electron 离屏渲染将 assets/logo.svg 栅格化为 PNG / ICO 图标资源。
// 运行：npx electron scripts/generate-icons.js
const { app, BrowserWindow, nativeImage } = require("electron")
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const SVG_PATH = path.join(ROOT, "assets", "logo.svg")
const PNG_PATH = path.join(ROOT, "assets", "icon.png")
const ICO_PATH = path.join(ROOT, "assets", "icon.ico")

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const RENDER_SIZE = 1024

function buildIco(pngBySize) {
  // 现代多尺寸 ICO：ICONDIRENTY 内嵌 PNG 数据
  const count = ICO_SIZES.length
  const entries = []
  let offset = 6 + 16 * count
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let i = 0
  for (const size of ICO_SIZES) {
    const png = pngBySize[size]
    const w = size >= 256 ? 0 : size
    const h = size >= 256 ? 0 : size
    dir.writeUInt8(w, i * 16 + 0)
    dir.writeUInt8(h, i * 16 + 1)
    dir.writeUInt8(0, i * 16 + 2)
    dir.writeUInt8(0, i * 16 + 3)
    dir.writeUInt16LE(1, i * 16 + 4)
    dir.writeUInt16LE(32, i * 16 + 6)
    dir.writeUInt32LE(png.length, i * 16 + 8)
    dir.writeUInt32LE(offset, i * 16 + 12)
    entries.push(png)
    offset += png.length
    i++
  }
  return Buffer.concat([header, dir, ...entries])
}

async function main() {
  const svg = fs.readFileSync(SVG_PATH, "utf8")
  const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent">
    <div style="width:${RENDER_SIZE}px;height:${RENDER_SIZE}px">${svg}</div>
  </body></html>`
  const htmlPath = path.join(ROOT, "assets", ".logo-render.html")
  fs.writeFileSync(htmlPath, html, "utf8")

  const win = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  })
  await win.loadFile(htmlPath)
  // 等待一帧确保 SVG 渲染完成
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: RENDER_SIZE, height: RENDER_SIZE })
  win.destroy()
  fs.unlinkSync(htmlPath)
  if (image.isEmpty()) throw new Error("capturePage returned empty image")

  const big = image.resize({ width: 512, height: 512 })
  fs.writeFileSync(PNG_PATH, big.toPNG())

  const pngBySize = {}
  for (const size of ICO_SIZES) {
    const img = image.resize({ width: size, height: size })
    pngBySize[size] = img.toPNG()
  }
  fs.writeFileSync(ICO_PATH, buildIco(pngBySize))

  console.log(`OK icon.png(512) + icon.ico(${ICO_SIZES.join("/")}) written to assets/`)
  app.exit(0)
}

app.whenReady().then(main).catch((err) => {
  console.error(err)
  app.exit(1)
})
