package app.nightstand.player;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

/**
 * The system pauses a hidden WebView, which freezes the story. Lock-screen
 * and shade buttons then do nothing until the app is opened again. While a
 * book is on the shelf player, this view stays resumed.
 */
public class StoryWebView extends CapacitorWebView {
    static volatile boolean keepPageAlive = false;

    public StoryWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (keepPageAlive && visibility != View.VISIBLE) {
            super.onWindowVisibilityChanged(View.VISIBLE);
            return;
        }
        super.onWindowVisibilityChanged(visibility);
    }

    @Override
    public void onPause() {
        if (keepPageAlive) {
            super.onResume();
            resumeTimers();
            return;
        }
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        resumeTimers();
    }
}
