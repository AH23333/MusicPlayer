package web

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestGzipMiddlewareCompressesTextResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(gzipMiddleware())
	router.GET("/html", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, strings.Repeat("music-", 4096))
	})
	router.GET("/json", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"text": strings.Repeat("music", 4096)})
	})

	for _, path := range []string{"/html", "/json"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			request.Header.Set("Accept-Encoding", "br, gzip")
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", recorder.Code)
			}
			if got := recorder.Header().Get("Content-Encoding"); got != "gzip" {
				t.Fatalf("Content-Encoding = %q, want gzip", got)
			}
			if got := recorder.Header().Get("Content-Length"); got != "" {
				t.Fatalf("Content-Length = %q, want empty for compressed response", got)
			}
			if got := recorder.Header().Get("Vary"); !strings.Contains(got, "Accept-Encoding") {
				t.Fatalf("Vary = %q, want Accept-Encoding", got)
			}

			reader, err := gzip.NewReader(recorder.Body)
			if err != nil {
				t.Fatalf("gzip.NewReader: %v", err)
			}
			body, readErr := io.ReadAll(reader)
			closeErr := reader.Close()
			if readErr != nil {
				t.Fatalf("read gzip body: %v", readErr)
			}
			if closeErr != nil {
				t.Fatalf("close gzip reader: %v", closeErr)
			}
			if !strings.Contains(string(body), "music") {
				t.Fatalf("decoded body missing payload: %q", string(body[:min(len(body), 80)]))
			}
		})
	}
}

func TestGzipMiddlewareSkipsNonTextRangeAndDownloads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(gzipMiddleware())
	router.GET("/audio", func(c *gin.Context) {
		c.Data(http.StatusOK, "audio/mpeg", []byte("audio-bytes"))
	})
	router.GET("/range", func(c *gin.Context) {
		c.Header("Content-Type", "text/html")
		c.String(http.StatusPartialContent, "range-bytes")
	})
	router.GET("/download", func(c *gin.Context) {
		c.Header("Content-Type", "text/plain")
		c.Header("Content-Disposition", `attachment; filename="song.lrc"`)
		c.String(http.StatusOK, "download-bytes")
	})
	router.GET("/plain", func(c *gin.Context) {
		c.String(http.StatusOK, "plain-bytes")
	})
	router.GET("/partial", func(c *gin.Context) {
		c.Header("Content-Type", "text/plain")
		c.Header("Content-Range", "bytes 0-4/10")
		c.String(http.StatusPartialContent, "range-bytes")
	})

	tests := []struct {
		name       string
		path       string
		accept     string
		rangeValue string
		wantBody   string
	}{
		{name: "audio", path: "/audio", accept: "gzip", wantBody: "audio-bytes"},
		{name: "range", path: "/range", accept: "gzip", rangeValue: "bytes=0-4", wantBody: "range-bytes"},
		{name: "download", path: "/download", accept: "gzip", wantBody: "download-bytes"},
		{name: "partial content", path: "/partial", accept: "gzip", wantBody: "range-bytes"},
		{name: "client disabled gzip", path: "/plain", accept: "gzip;q=0", wantBody: "plain-bytes"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			request.Header.Set("Accept-Encoding", test.accept)
			if test.rangeValue != "" {
				request.Header.Set("Range", test.rangeValue)
			}
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			if got := recorder.Header().Get("Content-Encoding"); got != "" {
				t.Fatalf("Content-Encoding = %q, want empty", got)
			}
			if got := recorder.Body.String(); got != test.wantBody {
				t.Fatalf("body = %q, want %q", got, test.wantBody)
			}
		})
	}
}

func TestGzipMiddlewareLeavesPanicResponseToRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(gin.Recovery(), gzipMiddleware())
	router.GET("/panic", func(*gin.Context) {
		panic("test panic")
	})

	request := httptest.NewRequest(http.MethodGet, "/panic", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want empty panic response", got)
	}
}

func TestAcceptsGzipHonorsExplicitRefusal(t *testing.T) {
	tests := []struct {
		header string
		want   bool
	}{
		{header: "gzip", want: true},
		{header: "br, gzip;q=0.5", want: true},
		{header: "*;q=0.8", want: true},
		{header: "gzip;q=0", want: false},
		{header: "*;q=1, gzip;q=0", want: false},
		{header: "br", want: false},
	}

	for _, test := range tests {
		if got := acceptsGzip(test.header); got != test.want {
			t.Fatalf("acceptsGzip(%q) = %v, want %v", test.header, got, test.want)
		}
	}
}
