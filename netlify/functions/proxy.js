exports.handler = async (event) => {
  // 处理预检请求（OPTIONS）
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Referer',
      },
      body: '',
    };
  }

  try {
    // 从路径中提取目标 URL（例如 /.netlify/functions/proxy/https://api.qijieya.cn/...）
    const targetUrl = decodeURIComponent(event.path.replace('/.netlify/functions/proxy/', ''));
    
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing or invalid target URL' }),
      };
    }

    // 转发请求
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
      },
      body: event.body ? event.body : undefined,
    });

    const body = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
      body,
    };
  } catch (error) {
    console.error('Proxy error:', error); // 日志输出，方便调试
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};