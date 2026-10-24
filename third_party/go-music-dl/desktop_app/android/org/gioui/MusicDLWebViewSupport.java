package org.gioui;

import android.view.View;
import android.view.ViewGroup;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

public final class MusicDLWebViewSupport {
    private static final int MAX_FOCUS_ATTEMPTS = 24;
    private static final long FOCUS_RETRY_DELAY_MS = 250;
    private static WebView playbackWebView;

    private MusicDLWebViewSupport() {}

    public static void focusWebViewWhenReady(View root) {
        focusWebViewWhenReady(root, MAX_FOCUS_ATTEMPTS);
    }

    private static void focusWebViewWhenReady(final View root, final int attemptsLeft) {
        View activityRoot = root.getRootView();
        WebView webView = findWebView(activityRoot);
        if (webView == null && activityRoot != root) {
            webView = findWebView(root);
        }
        if (webView != null) {
            // The foreground playback service needs the Java wrapper to stay
            // reachable while the activity is stopped. Chromium's native media
            // pipeline can keep playing without it, but JavaScript timers and
            // the bridge then stop updating.
            playbackWebView = webView;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
                // APlayer advances the queue itself after a track ends. Do not
                // let WebView reject that programmatic play when the Activity
                // is already in the background.
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
            webView.addJavascriptInterface(
                    new NativePlaybackBridge(),
                    "MusicDLNativePlayback");
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            if (webView.requestFocus()) {
                return;
            }
        }
        if (attemptsLeft <= 0) {
            return;
        }
        root.postDelayed(new Runnable() {
            @Override
            public void run() {
                focusWebViewWhenReady(root, attemptsLeft - 1);
            }
        }, FOCUS_RETRY_DELAY_MS);
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) {
            return (WebView) view;
        }
        if (!(view instanceof ViewGroup)) {
            return null;
        }
        ViewGroup group = (ViewGroup) view;
        for (int index = 0; index < group.getChildCount(); index++) {
            WebView match = findWebView(group.getChildAt(index));
            if (match != null) {
                return match;
            }
        }
        return null;
    }

    static WebView getPlaybackWebView() {
        return playbackWebView;
    }

    private static final class NativePlaybackBridge {
        @JavascriptInterface
        public void updatePlayback(
                String title,
                String artist,
                String album,
                long positionMs,
                long durationMs,
                boolean playing) {
            MusicDLPlaybackService.updateFromWebView(
                    title,
                    artist,
                    album,
                    positionMs,
                    durationMs,
                    playing);
        }
    }
}
