package core

import (
	"os"
	"path/filepath"
	"testing"
)

// 汽水签名器配置来源：环境变量 > 设置库。
// 默认（设置库为空）不指向任何远程签名服务，而是走 music-lib 内置的「本机签名器」：
// 随用随起调用官方客户端自带的 bdms.node 生成 x-helios / x-medusa，不需要常驻服务。
func TestSodaSignerConfigAndClientWiring(t *testing.T) {
	baseDir := t.TempDir()
	t.Setenv("MUSIC_DL_CONFIG_DB", filepath.Join(baseDir, "data", "settings.db"))
	t.Setenv("MUSIC_DL_COOKIE_FILE", filepath.Join(baseDir, "data", "cookies.json"))
	t.Setenv("QISHUI_SIGNER_URL", "")
	t.Setenv("QISHUI_SIGNER_TOKEN", "")
	t.Setenv("QISHUI_LOCAL_SIGNER", "")
	resetConfigStateForTest()
	t.Cleanup(resetConfigStateForTest)

	url, token := SodaSignerConfig()
	if url != "" || token != "" {
		t.Fatalf("default signer config should be empty: got %q / %q", url, token)
	}
	// 未配置远程签名器时，客户端是否带签名取决于本机签名器（官方客户端 + JS 运行时）是否可用。
	localAvailable := LocalSodaSignerAvailable()
	if client := NewSodaClient("cookie"); client.HasSigner() != localAvailable {
		t.Fatalf("client signer state mismatch: has=%v localAvailable=%v", client.HasSigner(), localAvailable)
	}

	// 保存自建签名服务地址后，客户端应显式带上远程签名器（优先级高于本机签名器）。
	if err := SaveWebSettings(WebSettings{
		SodaSignerURL:   "http://127.0.0.1:8899/sign",
		SodaSignerToken: "self-hosted",
	}); err != nil {
		t.Fatalf("save self-hosted soda signer: %v", err)
	}
	url, token = SodaSignerConfig()
	if url != "http://127.0.0.1:8899/sign" || token != "self-hosted" {
		t.Fatalf("self-hosted signer mismatch: got %q / %q", url, token)
	}
	if client := NewSodaClient("cookie"); !client.HasSigner() {
		t.Fatalf("client should carry self-hosted signer")
	}

	// 清空地址 = 回到本机签名器，而不是关闭整曲取流。
	if err := SaveWebSettings(WebSettings{SodaSignerURL: "", SodaSignerToken: ""}); err != nil {
		t.Fatalf("clear soda signer: %v", err)
	}
	if url, _ := SodaSignerConfig(); url != "" {
		t.Fatalf("signer url should be cleared: got %q", url)
	}

	// 环境变量优先于设置库。
	t.Setenv("QISHUI_SIGNER_URL", "http://127.0.0.1:7777/sign")
	t.Setenv("QISHUI_SIGNER_TOKEN", "env-token")
	url, token = SodaSignerConfig()
	if url != "http://127.0.0.1:7777/sign" || token != "env-token" {
		t.Fatalf("env signer should win: got %q / %q", url, token)
	}
}

func TestSodaClientDirConfigAndLocalSignerWiring(t *testing.T) {
	baseDir := t.TempDir()
	t.Setenv("MUSIC_DL_CONFIG_DB", filepath.Join(baseDir, "data", "settings.db"))
	t.Setenv("MUSIC_DL_COOKIE_FILE", filepath.Join(baseDir, "data", "cookies.json"))
	t.Setenv("QISHUI_SIGNER_URL", "")
	t.Setenv("QISHUI_SIGNER_TOKEN", "")
	t.Setenv("QISHUI_LOCAL_SIGNER", "1")
	t.Setenv("QISHUI_CLIENT_DIR", "")
	t.Setenv("QISHUI_BDMS_PATH", "")
	resetConfigStateForTest()
	t.Cleanup(resetConfigStateForTest)

	clientDir := filepath.Join(baseDir, "custom-soda", "3.1.0")
	bdmsPath := filepath.Join(clientDir, "resources", "app.asar.unpacked", "bdms.node")
	if err := os.MkdirAll(filepath.Dir(bdmsPath), 0o755); err != nil {
		t.Fatalf("create custom client resources: %v", err)
	}
	if err := os.WriteFile(bdmsPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("write custom bdms.node: %v", err)
	}
	runtimePath := filepath.Join(baseDir, "node")
	if err := os.WriteFile(runtimePath, []byte("test"), 0o755); err != nil {
		t.Fatalf("write custom runtime: %v", err)
	}
	t.Setenv("QISHUI_NODE", runtimePath)

	if err := SaveWebSettings(WebSettings{
		SodaClientDir: "  \"" + clientDir + "\"  ",
	}); err != nil {
		t.Fatalf("save soda client dir: %v", err)
	}
	if got := SodaClientDir(); got != filepath.Clean(clientDir) {
		t.Fatalf("SodaClientDir = %q, want %q", got, filepath.Clean(clientDir))
	}
	if !LocalSodaSignerAvailable() {
		t.Fatal("custom soda client dir should make local signer available")
	}
	if client := NewSodaClient("cookie"); !client.HasLocalSigner() {
		t.Fatal("soda client should use the configured local signer")
	}

	missingDir := filepath.Join(baseDir, "missing")
	t.Setenv("QISHUI_CLIENT_DIR", missingDir)
	if got := SodaClientDir(); got != filepath.Clean(missingDir) {
		t.Fatalf("environment soda client dir should win: got %q", got)
	}
	if LocalSodaSignerAvailable() {
		t.Fatal("missing environment soda client dir should disable local signer")
	}
}
