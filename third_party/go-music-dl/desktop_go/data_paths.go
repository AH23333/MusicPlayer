package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const desktopAppDirName = "music-dl"

// prepareDesktopDataDir 让桌面版不依赖启动时的工作目录。
// Finder/LaunchServices 双击启动时 cwd 通常是只读的 "/"，若继续使用
// 默认相对路径 data/settings.db，会直接 panic。这里把工作目录固定到
// 用户配置目录，并为数据库和 Cookie 设置绝对路径；显式配置的环境变量优先。
func prepareDesktopDataDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return prepareDesktopDataDirAt(filepath.Join(configDir, desktopAppDirName))
}

func prepareDesktopDataDirAt(dataDir string) (string, error) {
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" {
		return "", fmt.Errorf("desktop data directory is empty")
	}

	launchDir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve launch directory: %w", err)
	}
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return "", fmt.Errorf("resolve desktop data directory: %w", err)
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return "", fmt.Errorf("create desktop data directory %q: %w", dataDir, err)
	}

	defaultDataDir := filepath.Join(dataDir, "data")
	if err := configurePathEnv("MUSIC_DL_CONFIG_DB", filepath.Join(defaultDataDir, "settings.db"), launchDir); err != nil {
		return "", err
	}
	if err := configurePathEnv("MUSIC_DL_COOKIE_FILE", filepath.Join(defaultDataDir, "cookies.json"), launchDir); err != nil {
		return "", err
	}
	if err := resolveOptionalPathEnv("MUSIC_DL_FAVORITES_DB", launchDir); err != nil {
		return "", err
	}
	if err := os.Chdir(dataDir); err != nil {
		return "", fmt.Errorf("enter desktop data directory %q: %w", dataDir, err)
	}
	return dataDir, nil
}

func configurePathEnv(name, defaultPath, launchDir string) error {
	path := strings.TrimSpace(os.Getenv(name))
	if path == "" {
		path = defaultPath
	} else if !filepath.IsAbs(path) {
		path = filepath.Join(launchDir, path)
	}
	if err := os.Setenv(name, filepath.Clean(path)); err != nil {
		return fmt.Errorf("set %s: %w", name, err)
	}
	return nil
}

func resolveOptionalPathEnv(name, launchDir string) error {
	path := strings.TrimSpace(os.Getenv(name))
	if path == "" || filepath.IsAbs(path) {
		return nil
	}
	if err := os.Setenv(name, filepath.Clean(filepath.Join(launchDir, path))); err != nil {
		return fmt.Errorf("set %s: %w", name, err)
	}
	return nil
}
