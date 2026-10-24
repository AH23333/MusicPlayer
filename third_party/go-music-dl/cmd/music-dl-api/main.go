// music-dl-api 是一个独立的 JSON API 服务，作为 restruct-music-player 的
// 后端进程运行在 127.0.0.1:1989，提供搜索、歌词、歌单等能力。
// 兼容旧 music-dl-api.exe 的调用契约：
//
//	GET /                     就绪探测
//	GET /api/search?q=&sources=&page=&limit=   -> {songs:[], total, page, limit}
//	GET /api/lyric?id=&source=&name=&artist=   -> {lyric:"..."}
//	GET /api/playlist?id=&source=              -> {name, songs:[]}
//	GET /api/sources                           -> {sources:[], defaults:[]}
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
	qrcode "github.com/skip2/go-qrcode"
)

// sourceAliases 把渲染层/Meting 的源别名归一化为 music-lib 的内部源名。
var sourceAliases = map[string]string{
	"tencent":  "qq",
	"tx":       "qq",
	"qq":       "qq",
	"wy":       "netease",
	"netease":  "netease",
	"kg":       "kugou",
	"kugou":    "kugou",
	"kw":       "kuwo",
	"kuwo":     "kuwo",
	"mg":       "migu",
	"migu":     "migu",
	"bili":     "bilibili",
	"bilibili": "bilibili",
	"apple":    "apple",
	"fivesing": "fivesing",
	"jamendo":  "jamendo",
	"joox":     "joox",
	"qianqian": "qianqian",
	"soda":     "soda",
}

func normalizeSource(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	if mapped, ok := sourceAliases[s]; ok {
		return mapped
	}
	return s
}

// parseSources 同时支持逗号分隔与重复参数两种形式。
func parseSources(r *http.Request) []string {
	var raw []string
	if vals, ok := r.URL.Query()["sources"]; ok {
		raw = vals
	} else if v := strings.TrimSpace(r.URL.Query().Get("source")); v != "" {
		raw = []string{v}
	}
	seen := make(map[string]bool)
	var out []string
	for _, group := range raw {
		for _, item := range strings.Split(group, ",") {
			src := normalizeSource(item)
			if src == "" || seen[src] {
				continue
			}
			if core.GetSearchFunc(src) == nil && core.GetLyricFunc(src) == nil {
				continue
			}
			seen[src] = true
			out = append(out, src)
		}
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"service": "music-dl-api",
	})
}

func handleSources(w http.ResponseWriter, r *http.Request) {
	all := core.GetAllSourceNames()
	type capability struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Search      bool   `json:"search"`
		Playlist    bool   `json:"playlist"`
		Toplist     bool   `json:"toplist"`
		Recommend   bool   `json:"recommend"`
		Album       bool   `json:"album"`
		Parse       bool   `json:"parse"`
	}
	playlistNames := toSet(core.GetPlaylistSourceNames())
	toplistNames := toSet(core.GetTopListSourceNames())
	recommendNames := toSet(core.GetRecommendSourceNames())
	albumNames := toSet(core.GetAlbumSourceNames())
	caps := make([]capability, 0, len(all))
	for _, name := range all {
		caps = append(caps, capability{
			Name:        name,
			Description: core.GetSourceDescription(name),
			Search:      core.GetSearchFunc(name) != nil,
			Playlist:    playlistNames[name],
			Toplist:     toplistNames[name],
			Recommend:   recommendNames[name],
			Album:       albumNames[name],
			Parse:       core.GetParseFunc(name) != nil,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sources":  all,
		"defaults": core.GetDefaultSourceNames(),
		"caps":     caps,
	})
}

func toSet(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, v := range items {
		m[v] = true
	}
	return m
}

// requireSourceParam 归一化 source 参数并校验非空。
func requireSourceParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	src := normalizeSource(r.URL.Query().Get("source"))
	if src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing source",
		})
		return "", false
	}
	return src, true
}

func handleRecommend(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	fn := core.GetRecommendFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	playlists, err := fn()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range playlists {
		playlists[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"playlists": playlists,
		"total":     len(playlists),
	})
}

func handleTopLists(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	fn := core.GetTopListsFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	toplists, err := fn()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range toplists {
		toplists[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"toplists": toplists,
		"total":    len(toplists),
	})
}

func handleTopListSongs(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id",
		})
		return
	}
	fn := core.GetTopListSongsFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	songs, err := fn(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range songs {
		songs[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"songs": songs,
		"total": len(songs),
	})
}

// handlePlaylistCategories 返回指定源的歌单分类列表（歌单广场用）
func handlePlaylistCategories(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	fn := core.GetPlaylistCategoriesFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	categories, err := fn()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range categories {
		categories[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"categories": categories,
		"total":      len(categories),
	})
}

// handleCategoryPlaylists 返回指定源、指定分类下的歌单列表（歌单广场用）
func handleCategoryPlaylists(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	categoryID := strings.TrimSpace(r.URL.Query().Get("category_id"))
	page := 1
	if v := strings.TrimSpace(r.URL.Query().Get("page")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	limit := 60
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	fn := core.GetCategoryPlaylistsFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	playlists, err := fn(categoryID, page, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range playlists {
		playlists[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"playlists": playlists,
		"total":     len(playlists),
		"source":    src,
		"category":  categoryID,
		"page":      page,
	})
}

// qrLoginCookieString 把扫码结果中的 Cookie/Cookies 归一为 cookie 字符串
func qrLoginCookieString(result *model.QRLoginResult) string {
	if result == nil {
		return ""
	}
	if cookie := strings.TrimSpace(result.Cookie); cookie != "" {
		return cookie
	}
	if len(result.Cookies) == 0 {
		return ""
	}
	keys := make([]string, 0, len(result.Cookies))
	for k := range result.Cookies {
		if strings.TrimSpace(k) == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		v := strings.TrimSpace(result.Cookies[k])
		if v == "" {
			continue
		}
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, "; ")
}

func qrLoginCookieSource(source string) string {
	if source == "qq_wx" {
		return "qq"
	}
	return source
}

// handleQRCreate 创建扫码登录会话
func handleQRCreate(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	fn := core.GetQRLoginCreateFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	session, err := fn()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, session)
}

// handleQRCheck 轮询扫码状态；成功时持久化 cookie
func handleQRCheck(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing key",
		})
		return
	}
	fn := core.GetQRLoginCheckFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	result, err := fn(key)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	if result != nil && result.Status == model.QRLoginStatusSuccess {
		cookie := qrLoginCookieString(result)
		if cookie != "" {
			cookieSource := qrLoginCookieSource(src)
			result.Cookie = cookie
			core.CM.SetAll(map[string]string{cookieSource: cookie})
			core.CM.Save()
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// handleLoginStatus 返回指定源是否已登录（有 cookie）
func handleLoginStatus(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	cookie := core.CM.Get(qrLoginCookieSource(src))
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"source":    src,
		"logged_in": cookie != "",
	})
}

// handleLogout 清除指定源的登录 cookie
func handleLogout(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	core.CM.SetAll(map[string]string{qrLoginCookieSource(src): ""})
	core.CM.Save()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"source": src,
		"ok":     true,
	})
}

// handleUserPlaylists 返回已登录源中用户创建/收藏的歌单
func handleUserPlaylists(w http.ResponseWriter, r *http.Request) {
	src, ok := requireSourceParam(w, r)
	if !ok {
		return
	}
	page := 1
	if v := strings.TrimSpace(r.URL.Query().Get("page")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	limit := 100
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	fn := core.GetUserPlaylistsFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	playlists, err := fn(page, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range playlists {
		playlists[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"playlists": playlists,
		"total":     len(playlists),
	})
}

// handleQRImage 把任意文本（如扫码登录 URL）编码为 QR PNG 图片
func handleQRImage(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimSpace(r.URL.Query().Get("text"))
	if text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing text",
		})
		return
	}
	size := 280
	if v := strings.TrimSpace(r.URL.Query().Get("size")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 120 && n <= 720 {
			size = n
		}
	}
	png, err := qrcode.Encode(text, qrcode.Medium, size)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(png)
}

func handlePlaylistSearch(w http.ResponseWriter, r *http.Request) {
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))
	if keyword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing keyword",
		})
		return
	}
	sources := parseSources(r)
	if len(sources) == 0 {
		sources = core.GetPlaylistSourceNames()
	}
	var (
		mu        sync.Mutex
		wg        sync.WaitGroup
		playlists []model.Playlist
	)
	for _, src := range sources {
		fn := core.GetPlaylistSearchFunc(src)
		if fn == nil {
			continue
		}
		wg.Add(1)
		go func(s string, f core.SearchPlaylistFunc) {
			defer wg.Done()
			res, err := f(keyword)
			if err != nil {
				return
			}
			mu.Lock()
			for i := range res {
				res[i].Source = s
				playlists = append(playlists, res[i])
			}
			mu.Unlock()
		}(src, fn)
	}
	wg.Wait()
	sort.Slice(playlists, func(i, j int) bool {
		if playlists[i].Source != playlists[j].Source {
			return playlists[i].Source < playlists[j].Source
		}
		return playlists[i].Name < playlists[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"playlists": playlists,
		"total":     len(playlists),
		"keyword":   keyword,
	})
}

// ===== 换源播放（复用 go-music-dl web 端 switch_source 匹配算法）=====

type switchCandidate struct {
	song    model.Song
	score   float64
	durDiff int
}

const (
	switchMaxCandidatesPerSource     = 8
	switchSourceSearchTimeout        = 6 * time.Second
	switchHighConfidenceScore        = 0.98
	switchParallelValidationLimit    = 12
	switchParallelValidationParallel = 6
)

func isSwitchSourceAllowed(source, current string) bool {
	if source == "" || source == current {
		return false
	}
	if source == "soda" || source == "fivesing" || source == "local" {
		return false
	}
	return true
}

func switchCandidateSources(current string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0)
	add := func(s string) {
		if !isSwitchSourceAllowed(s, current) || seen[s] {
			return
		}
		if core.GetSearchFunc(s) == nil {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	for _, s := range core.GetDefaultSourceNames() {
		add(s)
	}
	for _, s := range core.GetAllSourceNames() {
		add(s)
	}
	return out
}

func searchWithTimeout(fn core.SearchFunc, query string) ([]model.Song, error) {
	type searchResult struct {
		songs []model.Song
		err   error
	}
	done := make(chan searchResult, 1)
	go func() {
		res, err := fn(query)
		done <- searchResult{songs: res, err: err}
	}()
	select {
	case res := <-done:
		return res.songs, res.err
	case <-time.After(switchSourceSearchTimeout):
		return nil, fmt.Errorf("search timeout")
	}
}

func searchSwitchCandidates(source string, fn core.SearchFunc, keyword, name, artist string, origDuration int) []switchCandidate {
	res, err := searchWithTimeout(fn, keyword)
	if (err != nil || len(res) == 0) && artist != "" {
		res, _ = searchWithTimeout(fn, name)
	}
	if len(res) == 0 {
		return nil
	}
	limit := len(res)
	if limit > switchMaxCandidatesPerSource {
		limit = switchMaxCandidatesPerSource
	}
	candidates := make([]switchCandidate, 0, limit)
	for i := 0; i < limit; i++ {
		cand := res[i]
		cand.Source = source
		score := core.CalcSongSimilarity(name, artist, cand.Name, cand.Artist)
		if score <= 0 {
			continue
		}
		durDiff := 0
		if origDuration > 0 && cand.Duration > 0 {
			durDiff = core.IntAbs(origDuration - cand.Duration)
			if !core.IsDurationClose(origDuration, cand.Duration) {
				continue
			}
		}
		candidates = append(candidates, switchCandidate{song: cand, score: score, durDiff: durDiff})
	}
	return candidates
}

func sortSwitchCandidates(candidates []switchCandidate) {
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].score == candidates[j].score {
			return candidates[i].durDiff < candidates[j].durDiff
		}
		return candidates[i].score > candidates[j].score
	})
}

func isHighConfidenceSwitchCandidate(candidate switchCandidate, origDuration int) bool {
	if candidate.score < switchHighConfidenceScore {
		return false
	}
	if origDuration > 0 && candidate.song.Duration > 0 && candidate.durDiff > 3 {
		return false
	}
	return true
}

func validateSwitchCandidates(candidates []switchCandidate) (switchCandidate, bool) {
	limit := len(candidates)
	if limit > switchParallelValidationLimit {
		limit = switchParallelValidationLimit
	}
	candidates = candidates[:limit]
	jobs := make(chan int, len(candidates))
	results := make(chan int, len(candidates))
	var wg sync.WaitGroup
	parallel := switchParallelValidationParallel
	if parallel > len(candidates) {
		parallel = len(candidates)
	}
	if parallel < 1 {
		parallel = 1
	}
	for worker := 0; worker < parallel; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				if core.ValidatePlayable(&candidates[index].song) {
					results <- index
				}
			}
		}()
	}
	for index := range candidates {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	close(results)
	for index := range results {
		return candidates[index], true
	}
	return switchCandidate{}, false
}

// resolveSongURL 解析歌曲真实可播地址并写回 song.URL
func resolveSongURL(song *model.Song) bool {
	if fn := core.GetDownloadFunc(song.Source); fn != nil {
		if urlStr, err := fn(song); err == nil && urlStr != "" {
			song.URL = urlStr
			return true
		}
	}
	return false
}

func handleSwitchSource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	name := strings.TrimSpace(q.Get("name"))
	artist := strings.TrimSpace(q.Get("artist"))
	current := normalizeSource(q.Get("current"))
	target := normalizeSource(q.Get("target"))
	duration, _ := strconv.Atoi(strings.TrimSpace(q.Get("duration")))
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing name",
		})
		return
	}

	keyword := name
	if artist != "" {
		keyword = name + " " + artist
	}

	var sources []string
	if target != "" {
		if !isSwitchSourceAllowed(target, current) {
			writeJSON(w, http.StatusNotFound, map[string]interface{}{
				"error": "target source not allowed",
			})
			return
		}
		sources = []string{target}
	} else {
		sources = switchCandidateSources(current)
	}
	if len(sources) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "no candidate sources",
		})
		return
	}

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		bySource = make(map[string][]switchCandidate)
		all      []switchCandidate
	)
	for _, src := range sources {
		fn := core.GetSearchFunc(src)
		if fn == nil {
			continue
		}
		wg.Add(1)
		go func(s string, f core.SearchFunc) {
			defer wg.Done()
			candidates := searchSwitchCandidates(s, f, keyword, name, artist, duration)
			if len(candidates) == 0 {
				return
			}
			mu.Lock()
			bySource[s] = candidates
			all = append(all, candidates...)
			mu.Unlock()
		}(src, fn)
	}
	wg.Wait()

	if len(all) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "no match",
		})
		return
	}

	// 优先：任一源内高置信度且可播放的候选
	for _, src := range sources {
		candidates := bySource[src]
		if len(candidates) == 0 {
			continue
		}
		sortSwitchCandidates(candidates)
		best := candidates[0]
		if isHighConfidenceSwitchCandidate(best, duration) && core.ValidatePlayable(&best.song) {
			if !resolveSongURL(&best.song) {
				continue
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"song": best.song, "score": best.score, "source": best.song.Source,
			})
			return
		}
	}

	// 兜底：全局排序后并行探测前 N 个
	sortSwitchCandidates(all)
	if selected, ok := validateSwitchCandidates(all); ok {
		if !resolveSongURL(&selected.song) {
			writeJSON(w, http.StatusNotFound, map[string]interface{}{
				"error": "no playable match",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"song": selected.song, "score": selected.score, "source": selected.song.Source,
		})
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]interface{}{
		"error": "no playable match",
	})
}

func handleParse(w http.ResponseWriter, r *http.Request) {
	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing url",
		})
		return
	}
	src := core.DetectSource(rawURL)
	if src == "" {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "无法识别链接来源",
		})
		return
	}
	if fn := core.GetParseFunc(src); fn != nil {
		if song, err := fn(rawURL); err == nil && song != nil {
			song.Source = src
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"type": "song", "source": src, "song": song,
			})
			return
		}
	}
	if fn := core.GetParsePlaylistFunc(src); fn != nil {
		if playlist, songs, err := fn(rawURL); err == nil {
			if playlist != nil {
				playlist.Source = src
			}
			for i := range songs {
				songs[i].Source = src
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"type": "playlist", "source": src, "playlist": playlist, "songs": songs, "total": len(songs),
			})
			return
		}
	}
	if fn := core.GetParseAlbumFunc(src); fn != nil {
		if album, songs, err := fn(rawURL); err == nil {
			if album != nil {
				album.Source = src
			}
			for i := range songs {
				songs[i].Source = src
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"type": "album", "source": src, "playlist": album, "songs": songs, "total": len(songs),
			})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]interface{}{
		"error": "解析失败: 暂不支持 " + src + " 平台的此链接类型",
	})
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))
	if keyword == "" {
		keyword = strings.TrimSpace(r.URL.Query().Get("keyword"))
	}
	if keyword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing keyword",
		})
		return
	}

	page, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page")))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	if limit < 1 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	sources := parseSources(r)
	if len(sources) == 0 {
		sources = core.GetDefaultSourceNames()
	}

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		results []model.Song
	)
	for _, src := range sources {
		fn := core.GetSearchFunc(src)
		if fn == nil {
			continue
		}
		wg.Add(1)
		go func(s string, f core.SearchFunc) {
			defer wg.Done()
			songs, err := f(keyword)
			if err != nil {
				return
			}
			mu.Lock()
			for i := range songs {
				songs[i].Source = s
				results = append(results, songs[i])
			}
			mu.Unlock()
		}(src, fn)
	}
	wg.Wait()

	// 按源名+歌名排序，保证分页结果稳定
	sort.Slice(results, func(i, j int) bool {
		if results[i].Source != results[j].Source {
			return results[i].Source < results[j].Source
		}
		return results[i].Name < results[j].Name
	})

	total := len(results)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"songs":    results[start:end],
		"total":    total,
		"page":     page,
		"limit":    limit,
		"keyword":  keyword,
		"sources":  sources,
		"has_more": end < total,
	})
}

func handleLyric(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	id := strings.TrimSpace(q.Get("id"))
	src := normalizeSource(q.Get("source"))
	if id == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id or source",
		})
		return
	}

	song := &model.Song{
		ID:     id,
		Source: src,
		Name:   strings.TrimSpace(q.Get("name")),
		Artist: strings.TrimSpace(q.Get("artist")),
		Album:  strings.TrimSpace(q.Get("album")),
	}

	lyric := ""
	if fn := core.GetLyricFunc(src); fn != nil {
		if lrc, err := fn(song); err == nil {
			lyric = lrc
		}
	}
	if strings.TrimSpace(lyric) == "" {
		lyric = "[00:00.00] 纯音乐 / 无歌词"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"lyric": lyric,
	})
}

// handleDownloadLyric 以 LRC 文本返回歌词（供播放器导出 .lrc 文件）
func handleDownloadLyric(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id := strings.TrimSpace(q.Get("id"))
	src := normalizeSource(q.Get("source"))
	if id == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id or source",
		})
		return
	}
	song := &model.Song{
		ID:     id,
		Source: src,
		Name:   strings.TrimSpace(q.Get("name")),
		Artist: strings.TrimSpace(q.Get("artist")),
		Album:  strings.TrimSpace(q.Get("album")),
	}
	fn := core.GetLyricFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	lyric, err := fn(song)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	if strings.TrimSpace(lyric) == "" {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "lyric not found",
		})
		return
	}
	name := song.Name
	if name == "" {
		name = id
	}
	artist := song.Artist
	filename := name + ".lrc"
	if artist != "" {
		filename = artist + " - " + name + ".lrc"
	}
	filename = strings.Map(func(r rune) rune {
		if r == '"' || r == '\\' || r == '/' || r < 0x20 {
			return -1
		}
		return r
	}, filename)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Write([]byte(lyric))
}

func handlePlaylist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	id := strings.TrimSpace(q.Get("id"))
	src := normalizeSource(q.Get("source"))
	if id == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id or source",
		})
		return
	}
	fn := core.GetPlaylistDetailFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	songs, err := fn(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range songs {
		songs[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"name":  "",
		"id":    id,
		"songs": songs,
		"total": len(songs),
	})
}

// ===== 歌手页：专辑搜索 + 专辑详情（复用 core.GetAlbumSearchFunc / GetAlbumDetailFunc）=====

func handleAlbumSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))
	if keyword == "" {
		keyword = strings.TrimSpace(r.URL.Query().Get("keyword"))
	}
	if keyword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing keyword",
		})
		return
	}
	sources := parseSources(r)
	if len(sources) == 0 {
		sources = core.GetAlbumSourceNames()
	}
	var (
		mu        sync.Mutex
		wg        sync.WaitGroup
		playlists []model.Playlist
	)
	for _, src := range sources {
		fn := core.GetAlbumSearchFunc(src)
		if fn == nil {
			continue
		}
		wg.Add(1)
		go func(s string, f core.SearchPlaylistFunc) {
			defer wg.Done()
			res, err := f(keyword)
			if err != nil {
				return
			}
			mu.Lock()
			for i := range res {
				res[i].Source = s
				playlists = append(playlists, res[i])
			}
			mu.Unlock()
		}(src, fn)
	}
	wg.Wait()
	sort.Slice(playlists, func(i, j int) bool {
		if playlists[i].Source != playlists[j].Source {
			return playlists[i].Source < playlists[j].Source
		}
		return playlists[i].Name < playlists[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"albums":  playlists,
		"total":   len(playlists),
		"keyword": keyword,
	})
}

func handleAlbum(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	id := strings.TrimSpace(q.Get("id"))
	src := normalizeSource(q.Get("source"))
	if id == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id or source",
		})
		return
	}
	fn := core.GetAlbumDetailFunc(src)
	if fn == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	songs, err := fn(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	for i := range songs {
		songs[i].Source = src
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"name":  strings.TrimSpace(q.Get("name")),
		"id":    id,
		"songs": songs,
		"total": len(songs),
	})
}

// ===== 元数据下载（复用 core.DownloadSongDataWithTemplate：源站最优音质 + ID3/FLAC 元数据/封面/歌词嵌入）=====

// ===== 下载队列 / 下载记录（复用 core 持久化队列与去重索引）=====

var downloadQueue *core.DownloadQueue

type queueSongPayload struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Name   string `json:"name"`
	Artist string `json:"artist"`
	Album  string `json:"album"`
	Cover  string `json:"cover"`
}

type queueEnqueueRequest struct {
	RequestID string             `json:"request_id"`
	Directory string             `json:"directory"`
	Embed     *bool              `json:"embed"`
	Songs     []queueSongPayload `json:"songs"`
}

// processQueueDownloadTask 是队列 worker 的处理器：去重校验 + 模板落盘 + 元数据嵌入，
// WebDAV 配置时同步上传（与 internal/web 行为一致）。
func processQueueDownloadTask(input core.DownloadTaskInput) (core.DownloadTaskResult, error) {
	index, err := core.LoadDownloadDedupSet()
	if err != nil {
		return core.DownloadTaskResult{}, err
	}
	song := input.Song
	result, err := core.DownloadWithDedupCheckWithTemplate(&song, input.Directory, input.Embed, input.Embed, input.FilenameTemplate, index)
	if err != nil {
		return core.DownloadTaskResult{}, err
	}
	outcome := core.DownloadTaskResult{Status: core.DownloadStatusSuccess, Path: result.SavedPath, Warning: result.Warning}
	if result.Skipped {
		outcome.Status = core.DownloadStatusSkipped
		return outcome, nil
	}
	settings := core.GetWebSettings()
	if core.WebDAVConfigured(settings) {
		if err := core.UploadSongToWebDAV(settings, result.Filename, result.Data); err != nil {
			outcome.Warning += " WebDAV: " + err.Error()
		}
	}
	return outcome, nil
}

func handleDownloadQueue(w http.ResponseWriter, r *http.Request) {
	if downloadQueue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"error": "download queue unavailable",
		})
		return
	}
	switch r.Method {
	case http.MethodGet:
		page, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page")))
		limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
		if page < 1 {
			page = 1
		}
		if limit < 1 {
			limit = 50
		}
		if limit > 200 {
			limit = 200
		}
		tasks, total, counts, err := downloadQueue.List(page, limit, strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"tasks":  tasks,
			"total":  total,
			"counts": counts,
			"page":   page,
			"limit":  limit,
		})
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		var req queueEnqueueRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid json body"})
			return
		}
		req.RequestID = strings.TrimSpace(req.RequestID)
		if req.RequestID == "" || len(req.RequestID) > 128 {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "missing or invalid request_id"})
			return
		}
		if len(req.Songs) == 0 || len(req.Songs) > 2000 {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "songs must contain 1-2000 items"})
			return
		}
		settings := core.GetWebSettings()
		directory := core.DownloadDirOrDefault(strings.TrimSpace(req.Directory))
		if strings.TrimSpace(req.Directory) == "" {
			directory = core.DownloadDirOrDefault(settings.DownloadDir)
		}
		embed := true
		if req.Embed != nil {
			embed = *req.Embed
		}
		inputs := make([]core.DownloadTaskInput, 0, len(req.Songs))
		for _, s := range req.Songs {
			src := normalizeSource(s.Source)
			if strings.TrimSpace(s.ID) == "" || src == "" || src == "local" {
				writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "song missing id/source or local source"})
				return
			}
			inputs = append(inputs, core.DownloadTaskInput{
				Song: model.Song{
					ID:     strings.TrimSpace(s.ID),
					Source: src,
					Name:   strings.TrimSpace(s.Name),
					Artist: strings.TrimSpace(s.Artist),
					Album:  strings.TrimSpace(s.Album),
					Cover:  strings.TrimSpace(s.Cover),
				},
				Directory:        directory,
				FilenameTemplate: settings.DownloadFilenameTemplate,
				Embed:            embed,
			})
		}
		added, err := downloadQueue.Enqueue(req.RequestID, inputs)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"added":    added,
			"existing": len(inputs) - added,
		})
	case http.MethodDelete:
		if err := downloadQueue.Clear(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleDownloadQueueAction 支持单任务 retry / cancel / remove。
func handleDownloadQueueAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if downloadQueue == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"error": "download queue unavailable",
		})
		return
	}
	id, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("id")), 10, 32)
	if err != nil || id == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid task id"})
		return
	}
	action := strings.TrimSpace(r.URL.Query().Get("action"))
	switch action {
	case "retry":
		err = downloadQueue.Retry(uint(id))
	case "cancel":
		err = downloadQueue.Cancel(uint(id))
	case "remove":
		err = downloadQueue.Remove(uint(id))
	default:
		writeJSON(w, http.StatusNotFound, map[string]interface{}{"error": "unknown action: " + action})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]interface{}{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok"})
}

func handleDownloadRecords(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		page, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page")))
		pageSize, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page_size")))
		if page < 1 {
			page = 1
		}
		if pageSize < 1 {
			pageSize = 20
		}
		if pageSize > 100 {
			pageSize = 100
		}
		records, total, err := core.GetDownloadRecordPage(page, pageSize)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
			return
		}
		totalPages := 1
		if total > 0 {
			totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"records":     records,
			"page":        page,
			"page_size":   pageSize,
			"total":       total,
			"total_pages": totalPages,
		})
	case http.MethodDelete:
		if err := core.ClearDownloadRecords(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	id := strings.TrimSpace(q.Get("id"))
	src := normalizeSource(q.Get("source"))
	if id == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": "missing id or source",
		})
		return
	}
	if core.GetDownloadFunc(src) == nil {
		writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": "source not supported: " + src,
		})
		return
	}
	song := &model.Song{
		ID:     id,
		Source: src,
		Name:   strings.TrimSpace(q.Get("name")),
		Artist: strings.TrimSpace(q.Get("artist")),
		Album:  strings.TrimSpace(q.Get("album")),
		Cover:  strings.TrimSpace(q.Get("cover")),
	}
	result, err := core.DownloadSongDataWithTemplate(song, true, true, core.DefaultDownloadFilenameTemplate)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", result.ContentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Data)))
	w.Header().Set("X-Audio-Ext", result.Ext)
	w.Header().Set("X-Filename", result.Filename)
	if result.Warning != "" {
		w.Header().Set("X-MusicDL-Warning", result.Warning)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Data)
}

// handleCoverProxy 代理防盗链封面：本地播放器 <img> 直连源站可能 403，经服务端带 UA/Referer 抓取
func handleCoverProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	u := strings.TrimSpace(r.URL.Query().Get("url"))
	if u == "" || !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "missing or invalid url"})
		return
	}
	data, contentType, err := core.FetchBytesWithMime(u, strings.TrimSpace(r.URL.Query().Get("source")))
	if err != nil || len(data) == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "fetch cover failed"})
		return
	}
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=21600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// handlePrecheck 批量下载预检：统计待下载列表中有多少首已下载过（将被去重跳过）
func handlePrecheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	var req struct {
		Songs []struct {
			Name   string `json:"name"`
			Artist string `json:"artist"`
		} `json:"songs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid json body"})
		return
	}
	if len(req.Songs) > 20000 {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "too many songs"})
		return
	}
	for _, s := range req.Songs {
		if len(s.Name) > 500 || len(s.Artist) > 500 {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "song name/artist too long"})
			return
		}
	}
	dedupSet, err := core.LoadDownloadDedupSet()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	skipCount := 0
	for _, s := range req.Songs {
		song := &model.Song{Name: s.Name, Artist: s.Artist}
		if core.IsSongStillDownloaded(song, dedupSet, core.GetWebSettings().DownloadDir) {
			skipCount++
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total":   len(req.Songs),
		"skipped": skipCount,
	})
}

// handleCookies GET 返回全部已存 Cookie（按源），POST 覆盖写入并持久化（手动导入登录态用）
func handleCookies(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, core.CM.GetAll())
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "invalid cookies payload"})
			return
		}
		core.CM.SetAll(req)
		core.CM.Save()
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func main() {
	port := flag.Int("port", 1989, "HTTP 监听端口")
	flag.Parse()
	if v := strings.TrimSpace(os.Getenv("MUSIC_DL_API_PORT")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p < 65536 {
			*port = p
		}
	}

	core.CM.Load()

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRoot)
	mux.HandleFunc("/api/search", handleSearch)
	mux.HandleFunc("/search", handleSearch)
	mux.HandleFunc("/api/lyric", handleLyric)
	mux.HandleFunc("/lyric", handleLyric)
	mux.HandleFunc("/api/download_lyric", handleDownloadLyric)
	mux.HandleFunc("/api/playlist", handlePlaylist)
	mux.HandleFunc("/api/sources", handleSources)
	mux.HandleFunc("/api/recommend", handleRecommend)
	mux.HandleFunc("/api/playlist_categories", handlePlaylistCategories)
	mux.HandleFunc("/api/category_playlists", handleCategoryPlaylists)
	mux.HandleFunc("/api/qr_create", handleQRCreate)
	mux.HandleFunc("/api/qr_check", handleQRCheck)
	mux.HandleFunc("/api/qr_image", handleQRImage)
	mux.HandleFunc("/api/login_status", handleLoginStatus)
	mux.HandleFunc("/api/logout", handleLogout)
	mux.HandleFunc("/api/user_playlists", handleUserPlaylists)
	mux.HandleFunc("/api/toplists", handleTopLists)
	mux.HandleFunc("/api/toplist_songs", handleTopListSongs)
	mux.HandleFunc("/api/playlist_search", handlePlaylistSearch)
	mux.HandleFunc("/api/parse", handleParse)
	mux.HandleFunc("/api/switch_source", handleSwitchSource)
	mux.HandleFunc("/api/album_search", handleAlbumSearch)
	mux.HandleFunc("/api/album", handleAlbum)
	mux.HandleFunc("/api/download", handleDownload)
	mux.HandleFunc("/cover_proxy", handleCoverProxy)
	mux.HandleFunc("/api/downloads/precheck", handlePrecheck)
	mux.HandleFunc("/api/cookies", handleCookies)
	mux.HandleFunc("/api/download_queue", handleDownloadQueue)
	mux.HandleFunc("/api/download_queue_action", handleDownloadQueueAction)
	mux.HandleFunc("/api/download_records", handleDownloadRecords)

	// 启动持久化下载队列 worker（单 worker 保证 FIFO，崩溃后自动恢复 waiting 任务）
	if q, queueErr := core.OpenDownloadQueue(); queueErr != nil {
		log.Printf("download queue unavailable: %v", queueErr)
	} else {
		downloadQueue = q
		queueCtx, queueCancel := context.WithCancel(context.Background())
		defer queueCancel()
		if queueErr = downloadQueue.Start(queueCtx, processQueueDownloadTask); queueErr != nil {
			log.Printf("download queue start: %v", queueErr)
		}
	}

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(*port))
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 300 * time.Second,
	}

	fmt.Printf("music-dl-api listening on %s\n", addr)
	log.Printf("music-dl-api listening on %s", addr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
