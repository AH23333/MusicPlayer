exports.handler = async function(event, context) {
  const url = new URL(event.rawUrl);
  // 从路径中提取目标 URL（去掉函数路径部分）
  const targetUrl = url.pathname.replace('/.netlify/functions/proxy', '') + url.search;

  if (!targetUrl) {
    return {
      statusCode: 400,
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
      body: error.message,
    };
  }
};