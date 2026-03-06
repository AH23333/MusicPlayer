exports.handler = async function(event, context) {
  // 处理预检请求（OPTIONS）
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Referer, Origin',
      },
      body: '',
    };
  }

  const url = new URL(event.rawUrl);
  // 提取目标URL：去掉函数路径部分
  const targetUrl = url.pathname.replace('/.netlify/functions/proxy', '') + url.search;

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Missing target URL'
    };
  }

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        ...event.headers,
        'User-Agent': 'Mozilla/5.0',
      },
      body: event.body ? event.body : undefined,
    });

    const body = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
      body,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: error.message,
    };
  }
};