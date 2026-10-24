package core

import (
	"os"
	"strings"

	"github.com/guohuiyuan/music-lib/soda"
)

// 汽水（LunaPC）会员曲目的整曲流只认 App 端逐请求签名（x-helios / x-medusa）。
//
// 默认走「本机签名器」：music-lib/soda 进程内调官方客户端自带的 bdms.node
// （node -e 内置垫片，随用随起，不需要任何常驻服务），装过汽水客户端即生效。
// 只有在设置里填了签名服务地址时才改用远程签名服务（例如 sodam 的公共实例
// 或自建实例），远程配置对用的是同一套 libresoda / libmssdk 协议。
const (
	// ExampleSodaSignerURL 是 sodam 内置的公共签名服务，仅作示例；默认不使用。
	ExampleSodaSignerURL = "http://103.236.75.83:8899/sign"
	// ExampleSodaSignerToken 是该公共实例的 token。
	ExampleSodaSignerToken = "b356ad402bc31ee9e5a99cfdbf41eaa39961a562251c3359"
)

// SodaSignerConfig 返回当前生效的汽水远程签名器配置：环境变量优先于界面设置；
// 地址为空表示不用远程签名服务（此时由本机签名器接管，没有本机客户端才会退化成试听）。
func SodaSignerConfig() (string, string) {
	if url := strings.TrimSpace(os.Getenv(soda.SignerEnvURL)); url != "" {
		return url, strings.TrimSpace(os.Getenv(soda.SignerEnvToken))
	}
	settings := GetWebSettings()
	return strings.TrimSpace(settings.SodaSignerURL), strings.TrimSpace(settings.SodaSignerToken)
}

// SodaClientDir 返回当前生效的汽水音乐客户端安装目录。
// QISHUI_CLIENT_DIR 优先于界面设置；空值表示由 music-lib 自动探测默认安装位置。
func SodaClientDir() string {
	if dir := strings.TrimSpace(os.Getenv(soda.LocalSignerEnvClientDir)); dir != "" {
		return normalizeSodaClientDir(dir)
	}
	return normalizeSodaClientDir(GetWebSettings().SodaClientDir)
}

func sodaLocalSignerOptions() soda.LocalSignerOptions {
	return soda.LocalSignerOptions{ClientDir: SodaClientDir()}
}

// LocalSodaSignerAvailable 本机是否能用「官方客户端 bdms.node」签名（装了客户端+有 JS 运行时）。
func LocalSodaSignerAvailable() bool {
	return soda.LocalSignerAvailableWithOptions(sodaLocalSignerOptions())
}

// NewSodaClient 统一构造汽水客户端：保存在配置库里的 Cookie + 本机/远程签名器。
func NewSodaClient(cookie string) *soda.Soda {
	signerURL, signerToken := SodaSignerConfig()
	// soda.New 默认就会带上本机签名器，这里显式声明一次便于阅读；
	// 配了远程地址则显式指定远程（优先级高于本机）。
	if strings.TrimSpace(signerURL) == "" {
		return soda.NewWithOptions(cookie, soda.WithLocalSigner(sodaLocalSignerOptions()))
	}
	return soda.NewWithSigner(cookie, signerURL, signerToken)
}
