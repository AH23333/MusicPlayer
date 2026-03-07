// ========== 仅浏览器环境下的兼容补丁 ==========
if (typeof window !== 'undefined') {
  // 模拟 require 函数
  window.require = function(moduleName) {
    if (moduleName === 'axios') return window.axios;
    // logger 等模块返回空对象（避免调用出错）
    return { info: ()=>{}, warn: ()=>{}, error: ()=>{} };
  };
  // 创建 exports 对象，后续代码会向它添加属性
  window.exports = {};
  // 声明 exports 变量，使其指向 window.exports
  var exports = window.exports;
}
// =========================================================================

const axios = require("axios");
const logger = require("./logger");

// API配置
exports.API_CONFIGS = {
  neteaseSearch: { url: "https://163api.qijieya.cn/cloudsearch" },
  metingFallback: { url: "https://api.qijieya.cn/meting/" },
  neteaseSongDetail: { url: "https://163api.qijieya.cn/song/detail" },
  neteaseLyric: { url: "https://163api.qijieya.cn/lyric/new" },
  neteaseAudioUrl: { url: "https://api.qijieya.cn/meting/" },
};

// CORS代理请求（本地开发请使用这个）
// exports.fetchViaProxy = async (targetUrl) => {
//   logger.info(`发起请求：${targetUrl}`);
//   let text;

//   // 直连请求
//   try {
//     logger.info(`尝试直连请求：${targetUrl}`);
//     const response = await axios.get(targetUrl, {
//       headers: {
//         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
//         Referer: "https://music.163.com/",
//         Origin: "https://music.163.com/",
//       },
//       timeout: 10000,
//     });
//     if (response.status !== 200) throw new Error(`直连失败，状态码：${response.status}`);
//     text = JSON.stringify(response.data);
//     logger.info(`直连请求成功，返回数据长度：${text.length}`);
//     return JSON.parse(text);
//   } catch (directErr) {
//     // 代理请求
//     logger.warn(`直连失败（原因：${directErr.message}），尝试CORS代理`);
//     try {
//       const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
//       logger.info(`代理请求地址：${proxyUrl}`);
//       const proxyRes = await axios.get(proxyUrl, { timeout: 15000 });
//       if (proxyRes.status !== 200) throw new Error(`代理失败，状态码：${proxyRes.status}`);
//       text = proxyRes.data;
//       const result = typeof text === "string" ? JSON.parse(text) : text;
//       logger.info(`代理请求成功，返回数据长度：${JSON.stringify(result).length}`);
//       return result;
//     } catch (proxyErr) {
//       logger.error(`直连+代理都失败：${proxyErr.message}，目标地址：${targetUrl}`);
//       return null;
//     }
//   }
// };

//为了适配浏览器网页部署而使用的修改的函数，请注意本地开发不要（不建议）使用这个
exports.fetchViaProxy = async (targetUrl) => {
  logger.info(`发起请求：${targetUrl}`);
  
  // 定义多个代理地址（按优先级排序）
  const proxies = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://thingproxy.freeboard.io/fetch/'
  ];

  // 依次尝试每个代理
  for (const proxy of proxies) {
    try {
      const proxyUrl = proxy + encodeURIComponent(targetUrl);
      logger.info(`尝试代理请求：${proxyUrl}`);
      const response = await axios.get(proxyUrl, { timeout: 15000 });
      if (response.status === 200) {
        const result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        logger.info(`代理请求成功，数据长度：${JSON.stringify(result).length}`);
        return result;
      }
    } catch (err) {
      logger.warn(`代理 ${proxy} 失败：${err.message}`);
      continue; // 尝试下一个代理
    }
  }

  logger.error(`所有代理均失败，目标地址：${targetUrl}`);
  return null;
};

// 格式化函数
exports.formatArtists = (artists) => {
  return (artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter(Boolean)
    .join("/") || "未知歌手";
};

exports.mapNeteaseSongToTrack = (song) => {
  if (!song || !song.id) return null;
  return {
    id: song.id.toString(),
    songId: song.id.toString(),
    name: song.name?.trim() ?? "未知歌曲",
    artist: exports.formatArtists(song.ar),
    album: song.al?.name?.trim() ?? "未知专辑",
    coverUrl: song.al?.picUrl?.replaceAll("http:", "https:") ?? "",
    duration: song.dt ?? 0,
    url: `${exports.API_CONFIGS.neteaseAudioUrl.url}?type=url&id=${song.id}`,
  };
};

// 歌词解析
const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)$/;
const METADATA_KEYWORDS = ["歌词贡献者", "翻译贡献者", "作词", "作曲", "编曲"];
const metadataKeywordRegex = new RegExp(
  `^(${METADATA_KEYWORDS.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:：]`,
  "iu",
);

exports.extractCleanLyrics = (content) => {
  if (!content) return { clean: "", metadata: [] };
  const metadataSet = new Set();
  const bodyLines = [];

  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.match(TIMESTAMP_REGEX)) {
      const match = trimmed.match(TIMESTAMP_REGEX);
      const content = match[4].trim();
      if (metadataKeywordRegex.test(content)) {
        metadataSet.add(content);
        return;
      }
    }
    bodyLines.push(line);
  });

  return {
    clean: bodyLines.join("\n").trim(),
    metadata: Array.from(metadataSet),
  };
};

// 获取歌词
exports.fetchLyricsById = async (songId) => {
  if (!songId) return null;
  const lyricUrl = `${exports.API_CONFIGS.neteaseLyric.url}?id=${songId}`;
  const lyricData = await exports.fetchViaProxy(lyricUrl);

  if (!lyricData || (lyricData.code !== undefined && lyricData.code !== 200)) return null;

  const rawLrc = lyricData.lrc?.lyric;
  const rawTlrc = lyricData.tlyric?.lyric;
  const rawYrc = lyricData.yrc?.lyric;

  const { clean: cleanLrc, metadata } = rawLrc
    ? exports.extractCleanLyrics(rawLrc)
    : { clean: "", metadata: [] };
  const { clean: cleanTlrc } = rawTlrc
    ? exports.extractCleanLyrics(rawTlrc)
    : { clean: "" };

  if ( lyricData.transUser?.nickname )
    metadata.unshift(`翻译贡献者: ${lyricData.transUser.nickname}`);
  if ( lyricData.lyricUser?.nickname )
    metadata.unshift(`歌词贡献者: ${lyricData.lyricUser.nickname}`);

  return {
    lrc: cleanLrc || rawLrc || "",
    tlrc: cleanTlrc || rawTlrc || "",
    metadata: metadata,
  };
};

// ========== 浏览器环境挂载到 window.utils ==========
if (typeof window !== 'undefined') {
  window.utils = exports;
}