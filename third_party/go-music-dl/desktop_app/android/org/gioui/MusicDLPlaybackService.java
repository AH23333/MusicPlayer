package org.gioui;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.WebView;
import android.webkit.ValueCallback;

import org.json.JSONObject;
import org.json.JSONTokener;

public final class MusicDLPlaybackService extends Service {
    private static final String CHANNEL_ID = "music_dl_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final int REQUEST_OPEN_APP = 10;
    private static final int REQUEST_PREVIOUS = 11;
    private static final int REQUEST_PLAY_PAUSE = 12;
    private static final int REQUEST_NEXT = 13;
    private static final int REQUEST_STOP = 14;
    private static final long PLAYBACK_REFRESH_MS = 1000;

    private static final String ACTION_START = "org.gioui.MusicDLPlaybackService.START";
    private static final String ACTION_PREVIOUS = "org.gioui.MusicDLPlaybackService.PREVIOUS";
    private static final String ACTION_PLAY = "org.gioui.MusicDLPlaybackService.PLAY";
    private static final String ACTION_PAUSE = "org.gioui.MusicDLPlaybackService.PAUSE";
    private static final String ACTION_NEXT = "org.gioui.MusicDLPlaybackService.NEXT";
    private static final String ACTION_STOP = "org.gioui.MusicDLPlaybackService.STOP";

    private static final Object LOCK = new Object();
    private static MusicDLPlaybackService instance;
    private static boolean pendingPlaying;
    private static String pendingTitle = "MusicDL";
    private static String pendingArtist = "";
    private static String pendingAlbum = "";
    private static long pendingPositionMs;
    private static long pendingDurationMs;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable playbackRefresh = new Runnable() {
        @Override
        public void run() {
            refreshScheduled = false;
            if (!foregroundStarted) {
                return;
            }
            refreshPlaybackFromWebView();
            schedulePlaybackRefresh();
        }
    };
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private boolean foregroundStarted;
    private boolean refreshScheduled;
    private boolean playing;
    private String title = "MusicDL";
    private String artist = "";
    private String album = "";
    private long positionMs;
    private long durationMs;
    private String lastNotificationKey = "";
    private Bitmap appIcon;

    public static void startPlayback(Context context) {
        synchronized (LOCK) {
            pendingPlaying = true;
        }
        Intent intent = new Intent(context, MusicDLPlaybackService.class);
        intent.setAction(ACTION_START);
        startPlaybackService(context, intent);
    }

    public static void updatePlayback(
            Context context,
            boolean nowPlaying,
            String nextTitle,
            String nextArtist,
            String nextAlbum,
            long nextPositionMs,
            long nextDurationMs) {
        MusicDLPlaybackService service;
        synchronized (LOCK) {
            pendingPlaying = nowPlaying;
            pendingTitle = safeText(nextTitle, "MusicDL");
            pendingArtist = safeText(nextArtist, "");
            pendingAlbum = safeText(nextAlbum, "");
            pendingPositionMs = Math.max(0, nextPositionMs);
            pendingDurationMs = Math.max(0, nextDurationMs);
            service = instance;
        }
        if (service != null) {
            service.applyPlayback(
                    nowPlaying,
                    safeText(nextTitle, "MusicDL"),
                    safeText(nextArtist, ""),
                    safeText(nextAlbum, ""),
                    Math.max(0, nextPositionMs),
                    Math.max(0, nextDurationMs));
        }
    }

    public static void updateFromWebView(
            String nextTitle,
            String nextArtist,
            String nextAlbum,
            long nextPositionMs,
            long nextDurationMs,
            boolean nowPlaying) {
        MusicDLPlaybackService service;
        synchronized (LOCK) {
            pendingPlaying = nowPlaying;
            pendingTitle = safeText(nextTitle, "MusicDL");
            pendingArtist = safeText(nextArtist, "");
            pendingAlbum = safeText(nextAlbum, "");
            pendingPositionMs = Math.max(0, nextPositionMs);
            pendingDurationMs = Math.max(0, nextDurationMs);
            service = instance;
        }
        if (service != null) {
            service.applyPlayback(
                    nowPlaying,
                    safeText(nextTitle, "MusicDL"),
                    safeText(nextArtist, ""),
                    safeText(nextAlbum, ""),
                    Math.max(0, nextPositionMs),
                    Math.max(0, nextDurationMs));
        }
    }

    public static void stopPlayback(Context context) {
        synchronized (LOCK) {
            pendingPlaying = false;
        }
        context.stopService(new Intent(context, MusicDLPlaybackService.class));
    }

    private static void startPlaybackService(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    private static String safeText(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) {
            return fallback;
        }
        return value.trim();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        synchronized (LOCK) {
            instance = this;
        }
        createNotificationChannel();
        createMediaSession();
        PowerManager powerManager =
                (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "music-dl:playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createNotificationChannel();
        ensureForeground();

        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_PREVIOUS.equals(action)) {
            dispatchPlaybackAction("previous", 0);
        } else if (ACTION_PLAY.equals(action)) {
            dispatchPlaybackAction("play", 0);
        } else if (ACTION_PAUSE.equals(action)) {
            dispatchPlaybackAction("pause", 0);
        } else if (ACTION_NEXT.equals(action)) {
            dispatchPlaybackAction("next", 0);
        } else if (ACTION_STOP.equals(action)) {
            dispatchPlaybackAction("stop", 0);
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    stopSelf();
                }
            }, 400);
        } else {
            applyPendingPlayback();
        }
        return START_NOT_STICKY;
    }

    private void applyPendingPlayback() {
        boolean nextPlaying;
        String nextTitle;
        String nextArtist;
        String nextAlbum;
        long nextPositionMs;
        long nextDurationMs;
        synchronized (LOCK) {
            nextPlaying = pendingPlaying;
            nextTitle = pendingTitle;
            nextArtist = pendingArtist;
            nextAlbum = pendingAlbum;
            nextPositionMs = pendingPositionMs;
            nextDurationMs = pendingDurationMs;
        }
        applyPlayback(
                nextPlaying,
                nextTitle,
                nextArtist,
                nextAlbum,
                nextPositionMs,
                nextDurationMs);
    }

    private void applyPlayback(
            final boolean nextPlaying,
            final String nextTitle,
            final String nextArtist,
            final String nextAlbum,
            final long nextPositionMs,
            final long nextDurationMs) {
        Runnable update = new Runnable() {
            @Override
            public void run() {
                playing = nextPlaying;
                title = nextTitle;
                artist = nextArtist;
                album = nextAlbum;
                positionMs = nextPositionMs;
                durationMs = nextDurationMs;
                updateWakeLock();
                updateMediaSession();
                updateForegroundNotification();
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            update.run();
        } else {
            mainHandler.post(update);
        }
    }

    private void createMediaSession() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }
        mediaSession = new MediaSession(this, "MusicDLPlayback");
        mediaSession.setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                dispatchPlaybackAction("play", 0);
            }

            @Override
            public void onPause() {
                dispatchPlaybackAction("pause", 0);
            }

            @Override
            public void onStop() {
                dispatchPlaybackAction("stop", 0);
            }

            @Override
            public void onSkipToPrevious() {
                dispatchPlaybackAction("previous", 0);
            }

            @Override
            public void onSkipToNext() {
                dispatchPlaybackAction("next", 0);
            }

            @Override
            public void onSeekTo(long position) {
                dispatchPlaybackAction("seek", position);
            }
        });
        mediaSession.setSessionActivity(openAppPendingIntent());
        mediaSession.setActive(true);
        schedulePlaybackRefresh();
    }

    private void schedulePlaybackRefresh() {
        if (refreshScheduled || !foregroundStarted) {
            return;
        }
        refreshScheduled = true;
        mainHandler.postDelayed(playbackRefresh, PLAYBACK_REFRESH_MS);
    }

    private void refreshPlaybackFromWebView() {
        final WebView webView = MusicDLWebViewSupport.getPlaybackWebView();
        if (webView == null) {
            return;
        }
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (playing) {
                    // Gio stops its render loop when the activity is not
                    // visible. Resume the WebView renderer as well as its
                    // timers so APlayer can advance its queue and report
                    // progress in the background.
                    webView.onResume();
                    webView.resumeTimers();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        webView.setRendererPriorityPolicy(
                                WebView.RENDERER_PRIORITY_IMPORTANT,
                                false);
                    }
                }
                webView.evaluateJavascript(
                        "(function(){try{var p=window.ap;"
                                + "if(!p||!p.audio||!p.list||!Array.isArray(p.list.audios))"
                                + "return '';var a=p.list.audios[p.list.index]||{};"
                                + "var d=Number(p.audio.duration);var t=Number(p.audio.currentTime);"
                                + "return JSON.stringify({title:String(a.name||'MusicDL'),"
                                + "artist:String(a.artist||''),album:String(a.album||''),"
                                + "positionMs:Number.isFinite(t)?Math.max(0,Math.round(t*1000)):0,"
                                + "durationMs:Number.isFinite(d)?Math.max(0,Math.round(d*1000)):0,"
                                + "playing:!p.audio.paused&&!p.audio.ended});"
                                + "}catch(e){return '';}})()",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                applyWebViewPlaybackInfo(value);
                            }
                        });
            }
        });
    }

    private void applyWebViewPlaybackInfo(String encoded) {
        if (encoded == null || encoded.isEmpty() || "null".equals(encoded)) {
            return;
        }
        try {
            Object decoded = new JSONTokener(encoded).nextValue();
            JSONObject data;
            if (decoded instanceof JSONObject) {
                data = (JSONObject) decoded;
            } else if (decoded instanceof String && !((String) decoded).isEmpty()) {
                data = new JSONObject((String) decoded);
            } else {
                return;
            }
            applyPlayback(
                    data.optBoolean("playing", playing),
                    safeText(data.optString("title"), "MusicDL"),
                    safeText(data.optString("artist"), ""),
                    safeText(data.optString("album"), ""),
                    Math.max(0, data.optLong("positionMs", positionMs)),
                    Math.max(0, data.optLong("durationMs", durationMs)));
        } catch (Exception ignored) {
            // The WebView can briefly return an empty value during navigation.
        }
    }

    private void updateWakeLock() {
        if (wakeLock == null) {
            return;
        }
        if (playing && !wakeLock.isHeld()) {
            wakeLock.acquire();
        } else if (!playing && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void updateMediaSession() {
        if (mediaSession == null) {
            return;
        }
        long clampedPosition = durationMs > 0
                ? Math.min(positionMs, durationMs)
                : positionMs;
        MediaMetadata metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
                .build();
        mediaSession.setMetadata(metadata);

        int playbackState = playing
                ? PlaybackState.STATE_PLAYING
                : PlaybackState.STATE_PAUSED;
        long actions = PlaybackState.ACTION_PLAY |
                PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE |
                PlaybackState.ACTION_STOP |
                PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                PlaybackState.ACTION_SKIP_TO_NEXT |
                PlaybackState.ACTION_SEEK_TO;
        mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(
                        playbackState,
                        clampedPosition,
                        playing ? 1.0f : 0.0f)
                .build());
        mediaSession.setActive(true);
    }

    private void ensureForeground() {
        if (foregroundStarted) {
            return;
        }
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        foregroundStarted = true;
        lastNotificationKey = notificationKey();
        schedulePlaybackRefresh();
    }

    private void updateForegroundNotification() {
        ensureForeground();
        String key = notificationKey();
        if (!key.equals(lastNotificationKey)) {
            lastNotificationKey = key;
            NotificationManager manager =
                    (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private String notificationKey() {
        return title + "\n" + artist + "\n" + album + "\n" + playing;
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        builder.setSmallIcon(android.R.drawable.ic_media_play);
        Bitmap largeIcon = applicationIcon();
        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }
        builder.setContentTitle(title)
                .setContentText(artist.isEmpty() ? album : artist)
                .setContentIntent(openAppPendingIntent())
                .setDeleteIntent(servicePendingIntent(
                        ACTION_STOP,
                        REQUEST_STOP,
                        PendingIntent.FLAG_UPDATE_CURRENT))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(
                    Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setCategory(Notification.CATEGORY_TRANSPORT)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);
        } else {
            builder.setCategory(Notification.CATEGORY_SERVICE);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            builder.addAction(new Notification.Action.Builder(
                    android.R.drawable.ic_media_previous,
                    "Previous",
                    servicePendingIntent(
                            ACTION_PREVIOUS,
                            REQUEST_PREVIOUS,
                            PendingIntent.FLAG_UPDATE_CURRENT)).build());
            builder.addAction(new Notification.Action.Builder(
                    playing
                            ? android.R.drawable.ic_media_pause
                            : android.R.drawable.ic_media_play,
                    playing ? "Pause" : "Play",
                    servicePendingIntent(
                            playing ? ACTION_PAUSE : ACTION_PLAY,
                            REQUEST_PLAY_PAUSE,
                            PendingIntent.FLAG_UPDATE_CURRENT)).build());
            builder.addAction(new Notification.Action.Builder(
                    android.R.drawable.ic_media_next,
                    "Next",
                    servicePendingIntent(
                            ACTION_NEXT,
                            REQUEST_NEXT,
                            PendingIntent.FLAG_UPDATE_CURRENT)).build());
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Notification.MediaStyle style = new Notification.MediaStyle()
                    .setShowActionsInCompactView(0, 1, 2);
            if (mediaSession != null) {
                style.setMediaSession(mediaSession.getSessionToken());
            }
            builder.setStyle(style);
        }
        return builder.build();
    }

    private PendingIntent openAppPendingIntent() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent();
        }
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                this,
                REQUEST_OPEN_APP,
                launchIntent,
                pendingIntentFlags(PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private PendingIntent servicePendingIntent(String action, int requestCode, int flags) {
        Intent intent = new Intent(this, MusicDLPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                pendingIntentFlags(flags));
    }

    private static int pendingIntentFlags(int flags) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private Bitmap applicationIcon() {
        if (appIcon == null) {
            try {
                appIcon = BitmapFactory.decodeResource(
                        getResources(),
                        getApplicationInfo().icon);
            } catch (RuntimeException ignored) {
            }
        }
        return appIcon;
    }

    private void dispatchPlaybackAction(final String action, final long value) {
        final WebView webView = MusicDLWebViewSupport.getPlaybackWebView();
        if (webView == null) {
            return;
        }
        final String script;
        if ("seek".equals(action)) {
            script = "(function(){try{return !!(window.musicDlTaskbarControl&&"
                    + "window.musicDlTaskbarControl('seek'," + Math.max(0, value)
                    + "));}catch(e){return false;}})()";
        } else {
            script = "(function(){try{return !!(window.musicDlTaskbarControl&&"
                    + "window.musicDlTaskbarControl('" + action
                    + "'));}catch(e){return false;}})()";
        }
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(playbackRefresh);
        refreshScheduled = false;
        synchronized (LOCK) {
            if (instance == this) {
                instance = null;
            }
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        foregroundStarted = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Playback",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Background music playback controls");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
    }
}
