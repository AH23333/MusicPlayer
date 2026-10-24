package web

import (
	"bufio"
	"compress/gzip"
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

func gzipMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !shouldCompressRequest(c.Request) {
			c.Next()
			return
		}

		writer := &gzipResponseWriter{
			ResponseWriter: c.Writer,
			requestContext: c.Request.Context(),
			status:         http.StatusOK,
		}
		c.Writer = writer
		defer func() {
			if recovered := recover(); recovered != nil {
				if writer.wroteHeader {
					writer.closeGzip()
				} else {
					c.Writer = writer.ResponseWriter
				}
				panic(recovered)
			}
			writer.finish()
		}()
		c.Next()
	}
}

func shouldCompressRequest(r *http.Request) bool {
	if r.Method == http.MethodHead || r.Header.Get("Range") != "" {
		return false
	}
	if r.Header.Get("Upgrade") != "" ||
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return false
	}
	if strings.Contains(strings.ToLower(r.Header.Get("Cache-Control")), "no-transform") {
		return false
	}
	return acceptsGzip(r.Header.Get("Accept-Encoding"))
}

func acceptsGzip(header string) bool {
	gzipQuality := -1.0
	wildcardQuality := -1.0
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if len(fields) == 0 {
			continue
		}

		name := strings.ToLower(strings.TrimSpace(fields[0]))
		if name != "gzip" && name != "*" {
			continue
		}

		quality := 1.0
		for _, parameter := range fields[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				quality = parsed
			}
		}

		if name == "gzip" {
			gzipQuality = quality
		} else {
			wildcardQuality = quality
		}
	}

	if gzipQuality >= 0 {
		return gzipQuality > 0
	}
	return wildcardQuality > 0
}

func isCompressibleResponse(header http.Header, status int) bool {
	if status < http.StatusOK ||
		status == http.StatusNoContent ||
		status == http.StatusPartialContent ||
		status == http.StatusNotModified {
		return false
	}
	if header.Get("Content-Range") != "" {
		return false
	}
	if header.Get("Content-Encoding") != "" {
		return false
	}
	if strings.Contains(strings.ToLower(header.Get("Content-Disposition")), "attachment") {
		return false
	}
	if strings.Contains(strings.ToLower(header.Get("Cache-Control")), "no-transform") {
		return false
	}

	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(header.Get("Content-Type"), ";", 2)[0]))
	switch contentType {
	case "text/html",
		"text/css",
		"text/plain",
		"text/xml",
		"text/javascript",
		"application/javascript",
		"application/json",
		"application/xml",
		"application/rss+xml",
		"application/atom+xml",
		"application/manifest+json",
		"image/svg+xml":
		return true
	default:
		return false
	}
}

type gzipResponseWriter struct {
	gin.ResponseWriter
	requestContext  context.Context
	status          int
	wroteHeader     bool
	compressed      bool
	closed          bool
	gzipWriter      *gzip.Writer
	closeNotify     chan bool
	closeNotifyOnce sync.Once
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
}

func (w *gzipResponseWriter) WriteHeaderNow() {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true

	if isCompressibleResponse(w.Header(), w.status) {
		w.compressed = true
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Del("Content-Length")
		addVaryAcceptEncoding(w.Header())
		w.gzipWriter = gzip.NewWriter(w.ResponseWriter)
	}
	w.ResponseWriter.WriteHeader(w.status)
	w.ResponseWriter.WriteHeaderNow()
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	w.WriteHeaderNow()
	if w.compressed {
		return w.gzipWriter.Write(data)
	}
	return w.ResponseWriter.Write(data)
}

func (w *gzipResponseWriter) WriteString(data string) (int, error) {
	w.WriteHeaderNow()
	if w.compressed {
		return w.gzipWriter.Write([]byte(data))
	}
	return w.ResponseWriter.WriteString(data)
}

func (w *gzipResponseWriter) Flush() {
	w.WriteHeaderNow()
	if w.gzipWriter != nil {
		_ = w.gzipWriter.Flush()
	}
	w.ResponseWriter.Flush()
}

func (w *gzipResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *gzipResponseWriter) CloseNotify() <-chan bool {
	w.closeNotifyOnce.Do(func() {
		if w.requestContext == nil || w.requestContext.Done() == nil {
			return
		}
		w.closeNotify = make(chan bool)
		go func() {
			<-w.requestContext.Done()
			close(w.closeNotify)
		}()
	})
	return w.closeNotify
}

func (w *gzipResponseWriter) Push(target string, options *http.PushOptions) error {
	if pusher, ok := w.ResponseWriter.(http.Pusher); ok {
		return pusher.Push(target, options)
	}
	return http.ErrNotSupported
}

func (w *gzipResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *gzipResponseWriter) Status() int {
	if !w.wroteHeader {
		return w.status
	}
	return w.ResponseWriter.Status()
}

func (w *gzipResponseWriter) Written() bool {
	return w.wroteHeader || w.ResponseWriter.Written()
}

func (w *gzipResponseWriter) finish() {
	w.WriteHeaderNow()
	w.closeGzip()
}

func (w *gzipResponseWriter) closeGzip() {
	if w.gzipWriter == nil || w.closed {
		return
	}
	w.closed = true
	_ = w.gzipWriter.Close()
}

func addVaryAcceptEncoding(header http.Header) {
	for _, value := range header.Values("Vary") {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "Accept-Encoding") {
				return
			}
		}
	}
	header.Add("Vary", "Accept-Encoding")
}
