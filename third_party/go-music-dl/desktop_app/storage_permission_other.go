//go:build !android

package main

import "gioui.org/app"

func (a *desktopApp) requestStoragePermission(app.ViewEvent) {}

func (a *desktopApp) setPlaybackWakeLock(bool) {}

func (a *desktopApp) updatePlaybackPlatform(string) {}

func (a *desktopApp) updatePlaybackMetadataPlatform() {}

func (a *desktopApp) stopPlaybackPlatform() {}
