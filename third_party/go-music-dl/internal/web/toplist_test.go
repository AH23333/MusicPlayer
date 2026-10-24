package web

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

func TestRenderTopListsPanelUsesAjaxNavigation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.SetHTMLTemplate(newTestTemplate(t))
	router.GET(RoutePrefix+"/toplists", func(c *gin.Context) {
		c.Set("TopListSources", []topListPageSource{
			buildTopListPageSource("netease", []model.TopList{
				{
					ID:              "19723756",
					Name:            "飙升榜",
					Cover:           "https://example.com/soaring.jpg",
					Description:     "云音乐中每天热度上升最快的100首单曲，每日更新。",
					UpdateFrequency: "刚刚更新",
					TrackCount:      100,
					PlayCount:       6511300096,
					Source:          "netease",
				},
				{
					ID:              "2884035",
					Name:            "云音乐新歌榜",
					Cover:           "https://example.com/new.jpg",
					UpdateFrequency: "每天更新",
					TrackCount:      0,
					Source:          "netease",
				},
			}),
		})
		renderIndex(c, nil, nil, "", []string{"netease"}, "", "playlist", "", "", "", false, "", nil)
	})

	req := httptest.NewRequest(http.MethodGet, RoutePrefix+"/toplists", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	body := rec.Body.String()
	for _, want := range []string{
		"排行榜",
		"飙升榜",
		"刚刚更新",
		"65.1亿",
		"/toplist_songs?",
		"toplist_id=19723756",
		"navigateTo(this.href)",
		`data-toplist-supported="true"`,
		"goToTopLists()",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("rendered toplists page missing %q: %s", want, body)
		}
	}
	if strings.Contains(body, `onclick="location.href=`) {
		t.Fatalf("toplist cards should use ajax navigation: %s", body)
	}
	if strings.Contains(body, `fa-music"></i> 0 首`) {
		t.Fatalf("toplist cards should hide empty track counts: %s", body)
	}
}

func TestRenderTopListCurrentBar(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.SetHTMLTemplate(newTestTemplate(t))
	router.GET(RoutePrefix+"/toplist_songs", func(c *gin.Context) {
		c.Set("TopListCurrent", topListCurrent{
			Source:          "netease",
			SourceName:      "网易云音乐",
			TopListID:       "3778678",
			TopListName:     "热歌榜",
			UpdateFrequency: "每天更新",
		})
		renderIndex(c, []model.Song{
			{ID: "287398", Name: "我不难过", Artist: "孙燕姿", Source: "netease"},
		}, nil, "", []string{"netease"}, "", "playlist", "", "", "", false, "", nil)
	})

	req := httptest.NewRequest(http.MethodGet, RoutePrefix+"/toplist_songs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	body := rec.Body.String()
	for _, want := range []string{"当前榜单", "网易云音乐", "热歌榜", "每天更新", "返回排行榜", "/toplists"} {
		if !strings.Contains(body, want) {
			t.Fatalf("rendered toplist songs page missing %q: %s", want, body)
		}
	}
}

func TestTopListSourcesFromQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/?sources=qq&sources=netease&sources=netease", nil)
	if got, want := topListSourcesFromQuery(c), []string{"qq", "netease"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("topListSourcesFromQuery() = %v, want %v", got, want)
	}

	c, _ = gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if got, want := topListSourcesFromQuery(c), core.GetTopListSourceNames(); !reflect.DeepEqual(got, want) {
		t.Fatalf("topListSourcesFromQuery() = %v, want %v", got, want)
	}
}

func TestTopListSongsRouteRejectsUnsupportedSource(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.SetHTMLTemplate(newTestTemplate(t))
	group := router.Group(RoutePrefix)
	RegisterMusicRoutes(group, group)

	req := httptest.NewRequest(http.MethodGet, RoutePrefix+"/toplist_songs?source=qianqian&toplist_id=123", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "该源不支持排行榜") {
		t.Fatalf("unsupported source should render error message: %s", rec.Body.String())
	}
}

func TestFormatTopListPlayCount(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{in: 0, want: ""},
		{in: 999, want: "999"},
		{in: 12345, want: "1.2万"},
		{in: 6511300096, want: "65.1亿"},
	}
	for _, tc := range cases {
		if got := formatTopListPlayCount(tc.in); got != tc.want {
			t.Fatalf("formatTopListPlayCount(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
