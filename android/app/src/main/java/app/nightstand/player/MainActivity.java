package app.nightstand.player;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean askedNotifications = false;

    public static class PlaybackBridge {
        private final MainActivity activity;

        PlaybackBridge(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void setPlaying(boolean on) {
            activity.runOnUiThread(() -> activity.onPlayingChanged(on));
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new PlaybackBridge(this), "NightstandNative");
        }
    }

    void onPlayingChanged(boolean on) {
        if (on) {
            askNotifications();
            Intent service = new Intent(this, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(service);
            } else {
                startService(service);
            }
        } else {
            stopService(new Intent(this, PlaybackService.class));
        }
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
