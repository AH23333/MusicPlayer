const fs = require("fs").promises
const path = require("path")

// 项目根目录
const ROOT_DIR = path.join(__dirname, "..", "..", "..")

// 读取 JSON 文件
async function readJSON(fileName) {
  const filePath = path.join(ROOT_DIR, fileName)
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    return JSON.parse(content) || []
  } catch (err) {
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
    } catch (writeErr) {
      console.error(`创建${fileName}失败：${writeErr.message}`)
    }
    return []
  }
}

// 写入 JSON 文件
async function writeJSON(fileName, data) {
  const filePath = path.join(ROOT_DIR, fileName)
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
    return true
  } catch (err) {
    console.error(`保存${fileName}失败：${err.message}`)
    return false
  }
}

// 检查文件是否存在
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (err) {
    return false
  }
}

module.exports = {
  readJSON,
  writeJSON,
  fileExists,
  ROOT_DIR
}