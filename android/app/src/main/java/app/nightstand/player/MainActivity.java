package app.nightstand.player;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static volatile boolean externalUi = false;

    private boolean askedNotifications = false;
    private boolean storyOpen = false;
    private FolderImport folderImport;
    private LibraryLocation libraryLocation;

    public static class PlaybackBridge {
        private final MainActivity activity;

        PlaybackBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void setPlaying(boolean on) {
            activity.runOnUiThread(() -> activity.onPlayingChanged(on));
        }

        @JavascriptInterface
        public void updatePlayback(
            String title,
            String artist,
            String chapter,
            boolean playing,
            int positionMs,
            int durationMs,
            String cover
        ) {
            activity.runOnUiThread(
                () -> activity.onPlaybackUpdated(title, artist, chapter, playing, positionMs, durationMs, cover)
            );
        }

        @JavascriptInterface
        public void backgroundApp() {
            activity.runOnUiThread(() -> activity.moveTaskToBack(true));
        }

        @JavascriptInterface
        public void exitApp() {
            activity.runOnUiThread(() -> activity.moveTaskToBack(true));
        }

        @JavascriptInterface
        public void pickBookFolder() {
            activity.runOnUiThread(() -> {
                externalUi = true;
                activity.folderImport.launch();
            });
        }

        @JavascriptInterface
        public int folderAudioCount() {
            return activity.folderImport.count();
        }

        @JavascriptInterface
        public String folderName() {
            return activity.folderImport.folderName();
        }

        @JavascriptInterface
        public String folderAudioName(int index) {
            return activity.folderImport.name(index);
        }

        @JavascriptInterface
        public String folderAudioSize(int index) {
            return activity.folderImport.size(index);
        }

        @JavascriptInterface
        public String folderAudioChunk(int index, int offset, int length) {
            return activity.folderImport.chunk(index, offset, length);
        }

        @JavascriptInterface
        public void releaseFolderImport() {
            activity.folderImport.release();
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        folderImport = new FolderImport(this, () -> getBridge() == null ? null : getBridge().getWebView());
        libraryLocation = new LibraryLocation(this, () -> getBridge() == null ? null : getBridge().getWebView());
        PlaybackService.setSink(action -> deliverControl(action));
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new PlaybackBridge(this), "NightstandNative");
            getBridge().getWebView().addJavascriptInterface(new AppVault(this), "NarrivoxVault");
            getBridge().getWebView().addJavascriptInterface(libraryLocation, "NarrivoxLibrary");
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){if(window.__narrivoxBack){window.__narrivoxBack();return true;}return false;})()",
                    value -> {
                        if (!"true".equals(value)) {
                            runOnUiThread(() -> finish());
                        }
                    }
                );
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FolderImport.REQUEST) {
            externalUi = false;
            folderImport.onResult(resultCode, data);
            return;
        }
        if (requestCode == LibraryLocation.REQUEST) {
            externalUi = false;
            libraryLocation.onResult(resultCode, data);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onPause() {
        super.onPause();
        keepStoryAwake();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepStoryAwake();
    }

    private void keepStoryAwake() {
        if (!storyOpen || externalUi) return;
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        webView.onResume();
        webView.resumeTimers();
    }

    private void deliverControl(String action) {
        if (!"play".equals(action) && !"pause".equals(action) && !"back".equals(action) && !"forward".equals(action)) {
            return;
        }
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        webView.post(() -> {
            keepStoryAwake();
            String js = "(function(){if(window.__narrivoxLock){window.__narrivoxLock('"
                + action
                + "');return 'ok';}return 'miss';})()";
            webView.evaluateJavascript(js, value -> {
                if (value != null && value.contains("miss")) {
                    webView.postDelayed(() -> {
                        keepStoryAwake();
                        webView.evaluateJavascript(js, null);
                    }, 180);
                }
            });
        });
    }

    @Override
    public void onDestroy() {
        PlaybackService.setSink(null);
        stopService(new Intent(this, PlaybackService.class));
        super.onDestroy();
    }

    void onPlaybackUpdated(
        String title,
        String artist,
        String chapter,
        boolean playing,
        int positionMs,
        int durationMs,
        String cover
    ) {
        boolean active = title != null && !title.isEmpty();
        storyOpen = active;
        if (!active) {
            stopService(new Intent(this, PlaybackService.class));
            return;
        }
        keepStoryAwake();
        if (playing) askNotifications();
        Intent service = new Intent(this, PlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service);
        else startService(service);
        PlaybackService.publish(title, artist, chapter, playing, positionMs, durationMs, cover);
    }

    void onPlayingChanged(boolean on) {
        if (on) askNotifications();
    }

    private void askNotifications() {
        if (askedNotifications || Build.VERSION.SDK_INT < 33) return;
        askedNotifications = true;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                41
            );
        }
    }
}
