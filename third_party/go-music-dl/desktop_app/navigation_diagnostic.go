package main

import (
	"encoding/base64"
	"fmt"
	"html"
)

func navigationDiagnosticDataURL(target string, attempts int, lastState, platform, arch, goVersion string) string {
	if lastState == "" {
		lastState = "not received"
	}
	page := fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MusicDL WebView diagnostics</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a}
main{box-sizing:border-box;width:min(92vw,620px);padding:28px;border:1px solid #dbe4ee;border-radius:20px;background:#fff;box-shadow:0 20px 55px rgba(15,23,42,.12)}
h1{margin:0 0 10px;font-size:24px}
p{line-height:1.6}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 14px;margin:20px 0}
dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}
code{font-size:13px}
a{display:inline-block;margin-top:18px;padding:11px 18px;border-radius:10px;background:#059669;color:#fff;text-decoration:none;font-weight:700}
@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}main{background:#172033;border-color:#334155}dt{color:#93c5fd}}
</style>
</head>
<body>
<main>
<h1>WebView 启动诊断</h1>
<p>应用外壳已尝试打开页面，但没有收到 WebView 桥接确认。已停止自动重载，避免界面永久白屏或反复刷新。</p>
<dl>
<dt>目标地址</dt><dd><code>%s</code></dd>
<dt>尝试次数</dt><dd>%d</dd>
<dt>最后状态</dt><dd><code>%s</code></dd>
<dt>运行环境</dt><dd>%s/%s</dd>
<dt>Go runtime</dt><dd><code>%s</code></dd>
</dl>
<p>若这是 iOS，请把此页面截图和系统“分析数据”中的对应崩溃报告一起附到 issue。重新尝试会开启新一轮有限重试。</p>
<a href="%s">重新尝试 / Retry</a>
</main>
</body>
</html>`,
		html.EscapeString(target),
		attempts,
		html.EscapeString(lastState),
		html.EscapeString(platform),
		html.EscapeString(arch),
		html.EscapeString(goVersion),
		html.EscapeString(target),
	)
	return "data:text/html;charset=utf-8;base64," + base64.StdEncoding.EncodeToString([]byte(page))
}
