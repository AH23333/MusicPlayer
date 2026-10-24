//go:build android

package main

import (
	"log"
	"sync"

	"gioui.org/app"
	"git.wow.st/gmp/jni"
)

const (
	androidR          = 30
	androidT          = 33
	storageRequestID  = 1001
	notificationReqID = 1002
	permissionGranted = 0

	readExternalStorage  = "android.permission.READ_EXTERNAL_STORAGE"
	writeExternalStorage = "android.permission.WRITE_EXTERNAL_STORAGE"
	postNotifications    = "android.permission.POST_NOTIFICATIONS"
)

var (
	playbackServiceMu      sync.Mutex
	playbackServiceContext jni.Object
	playbackServiceStarted bool
)

func (a *desktopApp) requestStoragePermission(evt app.ViewEvent) {
	if a.storagePermissionOnce {
		return
	}
	androidEvt, ok := evt.(app.AndroidViewEvent)
	if !ok || androidEvt.View == 0 {
		return
	}

	a.storagePermissionOnce = true
	view := jni.Object(androidEvt.View)
	go a.window.Run(func() {
		if err := requestStoragePermissionFromView(view); err != nil {
			log.Printf("request storage permission: %v", err)
		}
		if err := initPlaybackServiceFromView(view); err != nil {
			log.Printf("init playback service: %v", err)
		}
	})
}

func requestStoragePermissionFromView(view jni.Object) error {
	return jni.Do(jni.JVMFor(app.JavaVM()), func(env jni.Env) error {
		activity, err := activityFromView(env, view)
		if err != nil {
			return err
		}

		if androidSDK(env) >= androidR {
			return requestAllFilesAccess(env, activity)
		}
		return requestLegacyStorage(env, activity)
	})
}

func requestNotificationPermission(env jni.Env, activity jni.Object) error {
	if androidSDK(env) < androidT || hasPermission(env, activity, postNotifications) {
		return nil
	}

	stringClass := jni.FindClass(env, "java/lang/String")
	permissions := jni.NewObjectArray(env, 1, stringClass, 0)
	if err := jni.SetObjectArrayElement(env, permissions, 0, jni.Object(jni.JavaString(env, postNotifications))); err != nil {
		return err
	}
	activityClass := jni.GetObjectClass(env, activity)
	return jni.CallVoidMethod(
		env,
		activity,
		jni.GetMethodID(env, activityClass, "requestPermissions", "([Ljava/lang/String;I)V"),
		jni.Value(permissions),
		jni.Value(notificationReqID),
	)
}

func activityFromView(env jni.Env, view jni.Object) (jni.Object, error) {
	viewClass := jni.GetObjectClass(env, view)
	return jni.CallObjectMethod(env, view, jni.GetMethodID(env, viewClass, "getContext", "()Landroid/content/Context;"))
}

func androidSDK(env jni.Env) int32 {
	version := jni.FindClass(env, "android/os/Build$VERSION")
	return jni.GetStaticIntField(env, version, jni.GetStaticFieldID(env, version, "SDK_INT", "I"))
}

func requestAllFilesAccess(env jni.Env, activity jni.Object) error {
	environment := jni.FindClass(env, "android/os/Environment")
	isManager := jni.GetStaticMethodID(env, environment, "isExternalStorageManager", "()Z")
	ok, err := jni.CallStaticBooleanMethod(env, environment, isManager)
	if err != nil || ok {
		return err
	}

	intentClass := jni.FindClass(env, "android/content/Intent")
	intent, err := jni.NewObject(env, intentClass, jni.GetMethodID(env, intentClass, "<init>", "()V"))
	if err != nil {
		return err
	}
	if _, err := jni.CallObjectMethod(env, intent, jni.GetMethodID(env, intentClass, "setAction", "(Ljava/lang/String;)Landroid/content/Intent;"), jni.Value(jni.JavaString(env, "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION"))); err != nil {
		return err
	}

	uriClass := jni.FindClass(env, "android/net/Uri")
	packageName, err := jni.CallObjectMethod(env, activity, jni.GetMethodID(env, jni.GetObjectClass(env, activity), "getPackageName", "()Ljava/lang/String;"))
	if err != nil {
		return err
	}
	uri, err := jni.CallStaticObjectMethod(
		env,
		uriClass,
		jni.GetStaticMethodID(env, uriClass, "fromParts", "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Landroid/net/Uri;"),
		jni.Value(jni.JavaString(env, "package")),
		jni.Value(packageName),
		0,
	)
	if err != nil {
		return err
	}
	if _, err := jni.CallObjectMethod(env, intent, jni.GetMethodID(env, intentClass, "setData", "(Landroid/net/Uri;)Landroid/content/Intent;"), jni.Value(uri)); err != nil {
		return err
	}
	return startActivity(env, activity, intent)
}

func requestLegacyStorage(env jni.Env, activity jni.Object) error {
	if androidSDK(env) < 23 || hasPermission(env, activity, readExternalStorage) && hasPermission(env, activity, writeExternalStorage) {
		return nil
	}

	stringClass := jni.FindClass(env, "java/lang/String")
	permissions := jni.NewObjectArray(env, 2, stringClass, 0)
	if err := jni.SetObjectArrayElement(env, permissions, 0, jni.Object(jni.JavaString(env, readExternalStorage))); err != nil {
		return err
	}
	if err := jni.SetObjectArrayElement(env, permissions, 1, jni.Object(jni.JavaString(env, writeExternalStorage))); err != nil {
		return err
	}
	activityClass := jni.GetObjectClass(env, activity)
	return jni.CallVoidMethod(
		env,
		activity,
		jni.GetMethodID(env, activityClass, "requestPermissions", "([Ljava/lang/String;I)V"),
		jni.Value(permissions),
		jni.Value(storageRequestID),
	)
}

func hasPermission(env jni.Env, activity jni.Object, permission string) bool {
	activityClass := jni.GetObjectClass(env, activity)
	result, err := jni.CallIntMethod(
		env,
		activity,
		jni.GetMethodID(env, activityClass, "checkSelfPermission", "(Ljava/lang/String;)I"),
		jni.Value(jni.JavaString(env, permission)),
	)
	return err == nil && result == permissionGranted
}

func startActivity(env jni.Env, activity, intent jni.Object) error {
	activityClass := jni.GetObjectClass(env, activity)
	return jni.CallVoidMethod(
		env,
		activity,
		jni.GetMethodID(env, activityClass, "startActivity", "(Landroid/content/Intent;)V"),
		jni.Value(intent),
	)
}

func initPlaybackServiceFromView(view jni.Object) error {
	return jni.Do(jni.JVMFor(app.JavaVM()), func(env jni.Env) error {
		activity, err := activityFromView(env, view)
		if err != nil {
			return err
		}

		playbackServiceMu.Lock()
		if playbackServiceContext != 0 {
			jni.DeleteGlobalRef(env, playbackServiceContext)
		}
		playbackServiceContext = jni.NewGlobalRef(env, activity)
		playbackServiceMu.Unlock()
		return nil
	})
}

func (a *desktopApp) setPlaybackWakeLock(hold bool) {
	a.window.Run(func() {
		if hold {
			if err := requestNotificationPermissionForPlayback(); err != nil {
				log.Printf("request notification permission: %v", err)
			}
		}
		if err := setPlaybackForegroundService(hold); err != nil {
			log.Printf("set playback foreground service %v: %v", hold, err)
		}
	})
}

func (a *desktopApp) updatePlaybackPlatform(state string) {
	switch state {
	case "playing":
		playbackServiceMu.Lock()
		serviceReady := playbackServiceContext != 0
		serviceStarted := playbackServiceStarted
		playbackServiceMu.Unlock()
		if !serviceReady {
			// The first ViewEvent setup may still be pending. Serialize this
			// uncommon early-start path with the existing Gio initialization.
			a.setPlaybackWakeLock(true)
		} else if serviceStarted {
			// Auto-advance emits "ended" and then "playing" while the Gio
			// window may already be stopped. The foreground service owns the
			// CPU wake lock while playback is active.
		} else {
			// Start while the media event is still recent. Waiting for another
			// Gio frame can let Android classify the app as backgrounded and
			// reject a media-playback foreground service on Android 12+.
			if err := setPlaybackForegroundService(true); err != nil {
				log.Printf("start playback foreground service: %v", err)
			}
			a.window.Run(func() {
				if err := requestNotificationPermissionForPlayback(); err != nil {
					log.Printf("request notification permission: %v", err)
				}
			})
		}
		if err := updatePlaybackServiceInfo(a.playbackMetadata, true); err != nil {
			log.Printf("update playing media session: %v", err)
		}
	case "paused":
		if err := updatePlaybackServiceInfo(a.playbackMetadata, false); err != nil {
			log.Printf("update paused media session: %v", err)
		}
	case "released":
		if err := setPlaybackForegroundService(false); err != nil {
			log.Printf("stop playback foreground service: %v", err)
		}
	}
}

func (a *desktopApp) updatePlaybackMetadataPlatform() {
	if err := updatePlaybackServiceInfo(a.playbackMetadata, a.playbackActive); err != nil {
		log.Printf("update media session metadata: %v", err)
	}
}

func (a *desktopApp) stopPlaybackPlatform() {
	if err := setPlaybackForegroundService(false); err != nil {
		log.Printf("stop playback foreground service on close: %v", err)
	}
}

func requestNotificationPermissionForPlayback() error {
	return jni.Do(jni.JVMFor(app.JavaVM()), func(env jni.Env) error {
		playbackServiceMu.Lock()
		context := playbackServiceContext
		playbackServiceMu.Unlock()
		if context == 0 {
			return nil
		}
		return requestNotificationPermission(env, context)
	})
}

func setPlaybackForegroundService(hold bool) error {
	return jni.Do(jni.JVMFor(app.JavaVM()), func(env jni.Env) error {
		playbackServiceMu.Lock()
		context := playbackServiceContext
		started := playbackServiceStarted
		playbackServiceMu.Unlock()
		if context == 0 || hold == started {
			return nil
		}

		if hold {
			if err := startPlaybackForegroundService(env, context); err != nil {
				return err
			}
		} else if err := stopPlaybackForegroundService(env, context); err != nil {
			return err
		}

		playbackServiceMu.Lock()
		playbackServiceStarted = hold
		playbackServiceMu.Unlock()
		return nil
	})
}

func startPlaybackForegroundService(env jni.Env, context jni.Object) error {
	serviceClass, err := loadMusicDLJavaClass(env, context, "org.gioui.MusicDLPlaybackService")
	if err != nil {
		return err
	}
	start := jni.GetStaticMethodID(env, serviceClass, "startPlayback", "(Landroid/content/Context;)V")
	return jni.CallStaticVoidMethod(env, serviceClass, start, jni.Value(context))
}

func stopPlaybackForegroundService(env jni.Env, context jni.Object) error {
	serviceClass, err := loadMusicDLJavaClass(env, context, "org.gioui.MusicDLPlaybackService")
	if err != nil {
		return err
	}
	stop := jni.GetStaticMethodID(env, serviceClass, "stopPlayback", "(Landroid/content/Context;)V")
	return jni.CallStaticVoidMethod(env, serviceClass, stop, jni.Value(context))
}

func updatePlaybackServiceInfo(metadata playbackMetadata, playing bool) error {
	return jni.Do(jni.JVMFor(app.JavaVM()), func(env jni.Env) error {
		playbackServiceMu.Lock()
		context := playbackServiceContext
		playbackServiceMu.Unlock()
		if context == 0 {
			return nil
		}

		title := metadata.Title
		if title == "" {
			title = "MusicDL"
		}
		playingValue := uint64(0)
		if playing {
			playingValue = 1
		}
		serviceClass, err := loadMusicDLJavaClass(env, context, "org.gioui.MusicDLPlaybackService")
		if err != nil {
			return err
		}
		update := jni.GetStaticMethodID(
			env,
			serviceClass,
			"updatePlayback",
			"(Landroid/content/Context;ZLjava/lang/String;Ljava/lang/String;Ljava/lang/String;JJ)V",
		)
		return jni.CallStaticVoidMethod(
			env,
			serviceClass,
			update,
			jni.Value(context),
			jni.Value(playingValue),
			jni.Value(jni.JavaString(env, title)),
			jni.Value(jni.JavaString(env, metadata.Artist)),
			jni.Value(jni.JavaString(env, metadata.Album)),
			jni.Value(uint64(metadata.PositionMS)),
			jni.Value(uint64(metadata.DurationMS)),
		)
	})
}
