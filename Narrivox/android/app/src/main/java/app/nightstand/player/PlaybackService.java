package app.nightstand.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.media.app.NotificationCompat.DecoratedMediaCustomViewStyle;

/**
 * Foreground media session so a story keeps playing off-screen and the lock
 * screen shows a player.
 */
public class PlaybackService extends Service {
    static final String CHANNEL_ID = "narrivox-playback";
    static final int NOTIFICATION_ID = 41;

    private static final String ACTION_PLAY = "narrivox.play";
    private static final String ACTION_PAUSE = "narrivox.pause";
    private static final String ACTION_BACK = "narrivox.back";
    private static final String ACTION_FORWARD = "narrivox.forward";

    interface ControlSink {
        void onControl(String action);
    }

    static final class Snapshot {
        String title = "Narrivox";
        String artist = "";
        String chapter = "A story is playing";
        String cover = "";
        boolean playing;
        int positionMs;
        int durationMs;
    }

    private static PlaybackService instance;
    private static ControlSink sink;
    private static Snapshot pending = new Snapshot();

    private final Handler main = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat session;
    private Bitmap art;
    private String artKey = "";
    private boolean foreground;

    static void setSink(ControlSink next) {
        sink = next;
    }

    static void publish(
        String title,
        String artist,
        String chapter,
        boolean playing,
        int positionMs,
        int durationMs,
        String cover
    ) {
        Snapshot next = new Snapshot();
        next.title = title == null || title.isEmpty() ? "Narrivox" : title;
        next.artist = artist == null ? "" : artist;
        next.chapter = chapter == null || chapter.isEmpty() ? next.title : chapter;
        next.cover = cover == null ? "" : cover;
        next.playing = playing;
        next.positionMs = Math.max(0, positionMs);
        next.durationMs = Math.max(0, durationMs);
        pending = next;
        PlaybackService service = instance;
        if (service != null) service.main.post(service::applyPending);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Now playing",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Lock screen controls while a story is playing");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);

        session = new MediaSessionCompat(this, "Narrivox");
        session.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                dispatch("play");
            }

            @Override
            public void onPause() {
                dispatch("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatch("forward");
            }

            @Override
            public void onSkipToPrevious() {
                dispatch("back");
            }
        });
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        session.setSessionActivity(activityIntent(open, 0));
        session.setActive(true);

        PowerManager power = getSystemService(PowerManager.class);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "narrivox:playback");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(4 * 60 * 60 * 1000L);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PLAY.equals(action)) dispatch("play");
            else if (ACTION_PAUSE.equals(action)) dispatch("pause");
            else if (ACTION_BACK.equals(action)) dispatch("back");
            else if (ACTION_FORWARD.equals(action)) dispatch("forward");
        }
        applyPending();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        art = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void applyPending() {
        Snapshot state = pending;
        if (session == null) return;
        try {
            loadArt(state.cover, state.title);
            int position = state.positionMs;
            if (state.durationMs > 0 && position >= state.durationMs) position = state.durationMs - 1;
            // Speed 0 means "paused" to Android and it sends pause right back,
            // which stops the story a moment after it starts.
            float speed = state.playing ? 1f : 0f;
            long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
            PlaybackStateCompat playback = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                    state.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    position,
                    speed
                )
                .build();
            session.setPlaybackState(playback);
            MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, state.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Narrivox")
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, state.title)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, state.chapter)
                .putString(
                    MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION,
                    state.artist.isEmpty() ? "Narrivox" : state.artist
                )
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, Math.max(0, state.durationMs));
            if (art != null && !art.isRecycled()) {
                meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
                meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
            }
            session.setMetadata(meta.build());
            // Do not request audio focus here. The page already holds it for the
            // story, and taking it makes Android pause playback immediately.
            show(state);
        } catch (RuntimeException ignored) {
            // A bad media update must not take the process down at a chapter boundary.
        }
    }

    private void show(Snapshot state) {
        Notification notification = build(state);
        if (!foreground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    );
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                foreground = true;
            } catch (Exception error) {
                stopSelf();
            }
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification);
    }

    private Notification build(Snapshot state) {
        NotificationCompat.Action back = new NotificationCompat.Action.Builder(
            controlIcon("back"),
            "Back 15 seconds",
            serviceIntent(ACTION_BACK, 1)
        ).build();
        NotificationCompat.Action toggle = state.playing
            ? new NotificationCompat.Action.Builder(controlIcon("pause"), "Pause", serviceIntent(ACTION_PAUSE, 2)).build()
            : new NotificationCompat.Action.Builder(controlIcon("play"), "Play", serviceIntent(ACTION_PLAY, 2)).build();
        NotificationCompat.Action forward = new NotificationCompat.Action.Builder(
            controlIcon("forward"),
            "Forward 30 seconds",
            serviceIntent(ACTION_FORWARD, 3)
        ).build();
        RemoteViews content = new RemoteViews(getPackageName(), R.layout.notification_player);
        content.setTextViewText(R.id.notif_title, state.title);
        content.setTextViewText(R.id.notif_chapter, state.chapter);
        content.setTextViewText(R.id.notif_author, state.artist.isEmpty() ? "Narrivox" : state.artist);
        int progress = state.durationMs > 0
            ? Math.min(1000, (int) ((state.positionMs * 1000L) / state.durationMs))
            : 0;
        content.setProgressBar(R.id.notif_progress, 1000, progress, false);
        if (art != null && !art.isRecycled()) content.setImageViewBitmap(R.id.notif_cover, art);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(state.title)
            .setContentText(state.chapter)
            .setSubText(state.artist.isEmpty() ? "Narrivox" : state.artist)
            .setSmallIcon(R.drawable.ic_stat_n)
            .setColor(getColor(R.color.raised))
            .setColorized(true)
            .setContentIntent(activityIntent(openIntent(), 4))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(state.playing)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setCustomContentView(content)
            .setCustomBigContentView(content)
            .addAction(back)
            .addAction(toggle)
            .addAction(forward)
            .setStyle(
                new DecoratedMediaCustomViewStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build();
    }

    private Intent openIntent() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return open;
    }

    private PendingIntent activityIntent(Intent intent, int request) {
        return PendingIntent.getActivity(
            this,
            request,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private PendingIntent serviceIntent(String action, int request) {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
            this,
            request,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private IconCompat iconBack;
    private IconCompat iconPlay;
    private IconCompat iconPause;
    private IconCompat iconForward;

    private IconCompat controlIcon(String kind) {
        if ("back".equals(kind) && iconBack != null) return iconBack;
        if ("play".equals(kind) && iconPlay != null) return iconPlay;
        if ("pause".equals(kind) && iconPause != null) return iconPause;
        if ("forward".equals(kind) && iconForward != null) return iconForward;
        IconCompat icon = IconCompat.createWithBitmap(paintControl(kind));
        if ("back".equals(kind)) iconBack = icon;
        else if ("play".equals(kind)) iconPlay = icon;
        else if ("pause".equals(kind)) iconPause = icon;
        else iconForward = icon;
        return icon;
    }

    private Bitmap paintControl(String kind) {
        int size = 128;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        boolean play = "play".equals(kind) || "pause".equals(kind);
        paint.setColor(play ? 0xFFE39A3C : 0xFF2A241E);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f - 4, paint);
        paint.setColor(play ? 0xFF1C1308 : 0xFFF6EFE6);
        if ("play".equals(kind)) {
            Path path = new Path();
            path.moveTo(size * 0.40f, size * 0.30f);
            path.lineTo(size * 0.72f, size * 0.50f);
            path.lineTo(size * 0.40f, size * 0.70f);
            path.close();
            canvas.drawPath(path, paint);
            return bitmap;
        }
        if ("pause".equals(kind)) {
            canvas.drawRoundRect(size * 0.34f, size * 0.30f, size * 0.46f, size * 0.70f, 6, 6, paint);
            canvas.drawRoundRect(size * 0.54f, size * 0.30f, size * 0.66f, size * 0.70f, 6, 6, paint);
            return bitmap;
        }
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        paint.setTextSize(size * 0.30f);
        Paint.FontMetrics metrics = paint.getFontMetrics();
        float y = size / 2f - (metrics.ascent + metrics.descent) / 2f;
        canvas.drawText("back".equals(kind) ? "−15" : "+30", size / 2f, y, paint);
        return bitmap;
    }

    private void loadArt(String cover, String title) {
        String key = (cover == null ? "" : cover) + "\n" + (title == null ? "" : title);
        if (key.equals(artKey)) return;
        artKey = key;
        String safeCover = cover == null ? "" : cover;
        String safeTitle = title == null ? "" : title;
        new Thread(() -> {
            Bitmap raw = decodeCover(safeCover);
            Bitmap framed = frame(raw, safeTitle);
            if (raw != null && raw != framed) raw.recycle();
            main.post(() -> {
                art = framed;
                applyPending();
            });
        }, "narrivox-art").start();
    }

    private Bitmap decodeCover(String cover) {
        if (cover.isEmpty() || cover.contains("..")) return null;
        try {
            if (cover.startsWith("/")) {
                return BitmapFactory.decodeStream(getAssets().open("public" + cover));
            }
            if (cover.startsWith("http://") || cover.startsWith("https://")) {
                java.net.HttpURLConnection connection =
                    (java.net.HttpURLConnection) new java.net.URL(cover).openConnection();
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(8000);
                connection.setInstanceFollowRedirects(true);
                try (java.io.InputStream input = connection.getInputStream()) {
                    return BitmapFactory.decodeStream(input);
                } finally {
                    connection.disconnect();
                }
            }
            if (cover.startsWith("data:image")) {
                int comma = cover.indexOf(',');
                if (comma < 0) return null;
                byte[] bytes = Base64.decode(cover.substring(comma + 1), Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private Bitmap frame(Bitmap cover, String title) {
        int width = 720;
        int height = 960;
        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(0xFF14110E);
        canvas.drawRect(0, 0, width, height, paint);
        paint.setColor(0x33E39A3C);
        canvas.drawCircle(width / 2f, 80, 280, paint);
        if (cover != null && !cover.isRecycled()) {
            float inset = 72;
            float maxW = width - inset * 2;
            float maxH = height - inset * 2 - 36;
            float scale = Math.min(maxW / cover.getWidth(), maxH / cover.getHeight());
            float dw = cover.getWidth() * scale;
            float dh = cover.getHeight() * scale;
            float left = (width - dw) / 2f;
            float top = (height - dh) / 2f - 12;
            paint.setColor(0xFFE39A3C);
            canvas.drawRect(left - 8, top - 8, left + dw + 8, top + dh + 8, paint);
            canvas.drawBitmap(cover, null, new android.graphics.RectF(left, top, left + dw, top + dh), paint);
        } else {
            paint.setColor(0xFFE39A3C);
            paint.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(280);
            canvas.drawText("N", width / 2f, height * 0.46f, paint);
            paint.setColor(0xFFF6EFE6);
            paint.setTextSize(40);
            drawLines(canvas, paint, title == null || title.isEmpty() ? "Narrivox" : title, width / 2f, height * 0.62f, width - 120);
        }
        paint.setColor(0xFFE39A3C);
        canvas.drawRect(0, height - 16, width, height, paint);
        return out;
    }

    private void drawLines(Canvas canvas, Paint paint, String text, float x, float y, float maxWidth) {
        String[] words = text.split("\\s+");
        String line = "";
        float leading = paint.getTextSize() * 1.25f;
        int drawn = 0;
        for (String word : words) {
            String next = line.isEmpty() ? word : line + " " + word;
            if (paint.measureText(next) > maxWidth && !line.isEmpty()) {
                canvas.drawText(line, x, y, paint);
                y += leading;
                line = word;
                drawn += 1;
                if (drawn == 3) return;
            } else {
                line = next;
            }
        }
        if (!line.isEmpty() && drawn < 3) canvas.drawText(line, x, y, paint);
    }

    private void dispatch(String action) {
        ControlSink target = sink;
        if (target != null) target.onControl(action);
    }
}
