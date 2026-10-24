//go:build android

package main

import (
	"fmt"

	"git.wow.st/gmp/jni"
)

func loadMusicDLJavaClass(env jni.Env, context jni.Object, name string) (jni.Class, error) {
	if context == 0 {
		return 0, fmt.Errorf("load %s: context is nil", name)
	}
	loader := jni.ClassLoaderFor(env, context)
	if loader == 0 {
		return 0, fmt.Errorf("load %s: class loader is nil", name)
	}
	return jni.LoadClass(env, loader, name)
}
