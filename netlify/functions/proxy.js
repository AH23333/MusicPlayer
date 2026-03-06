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
    // ✅ 核心修改：从query参数获取目标URL（解决?&参数丢失问题）
    const { url } = event.queryStringParameters || {};
    
    // 校验URL
    if (!url || !url.startsWith('http')) {
      return {
        statusCode: 400,
        headers: { 
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          error: 'Missing or invalid "url" parameter',
          tip: '请通过 ?url=xxx 传递目标API地址' 
        }),
      };
    }

    // 解码URL（处理中文/特殊字符）
    const targetUrl = decodeURIComponent(url);

    // 转发请求到目标API
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
        'Content-Type': 'application/json',
      },
      body: event.httpMethod === 'POST' ? event.body : undefined,
    });

    // 获取响应内容并返回
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
    console.error('Proxy 错误详情:', error);
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: '代理请求失败', 
        message: error.message 
      }),
    };
  }
};