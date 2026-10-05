package app.nightstand.player;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.WebView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;

/** One-level read of a folder the user picked. Subfolders are not opened. */
final class FolderImport {
    static final int REQUEST = 9041;
    private static final int CHUNK = 128 * 1024;

    private final Activity activity;
    private final WebViewProvider webViewProvider;
    private final Object lock = new Object();
    private final List<Item> items = new ArrayList<>();
    private String folderName = "";
    private Uri tree;

    interface WebViewProvider {
        WebView webView();
    }

    private static final class Item {
        final String name;
        final File cache;
        final long size;

        Item(String name, File cache, long size) {
            this.name = name;
            this.cache = cache;
            this.size = size;
        }
    }

    FolderImport(Activity activity, WebViewProvider webViewProvider) {
        this.activity = activity;
        this.webViewProvider = webViewProvider;
    }

    void launch() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        activity.startActivityForResult(intent, REQUEST);
    }

    void onResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            notifyPicked(false);
            return;
        }
        Uri picked = data.getData();
        int flags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        try {
            activity.getContentResolver().takePersistableUriPermission(picked, flags);
        } catch (SecurityException ignored) {
            // The temporary grant is enough to copy the files now.
        }
        new Thread(() -> {
            try {
                load(picked);
                notifyPicked(true);
            } catch (Exception ignored) {
                release();
                notifyPicked(false);
            }
        }, "narrivox-folder").start();
    }

    int count() {
        synchronized (lock) {
            return items.size();
        }
    }

    String folderName() {
        synchronized (lock) {
            return folderName == null ? "" : folderName;
        }
    }

    String name(int index) {
        synchronized (lock) {
            if (index < 0 || index >= items.size()) return "";
            return items.get(index).name;
        }
    }

    String size(int index) {
        synchronized (lock) {
            if (index < 0 || index >= items.size()) return "0";
            return Long.toString(items.get(index).size);
        }
    }

    String chunk(int index, int offset, int length) {
        Item item;
        synchronized (lock) {
            if (index < 0 || index >= items.size() || offset < 0 || length <= 0) return "";
            item = items.get(index);
        }
        int amount = (int) Math.min(Math.min(length, CHUNK), item.size - offset);
        if (amount <= 0) return "";
        byte[] buffer = new byte[amount];
        try (RandomAccessFile file = new RandomAccessFile(item.cache, "r")) {
            file.seek(offset);
            int read = file.read(buffer);
            if (read <= 0) return "";
            if (read < buffer.length) {
                byte[] exact = new byte[read];
                System.arraycopy(buffer, 0, exact, 0, read);
                buffer = exact;
            }
            return Base64.encodeToString(buffer, Base64.NO_WRAP);
        } catch (Exception ignored) {
            return "";
        }
    }

    void release() {
        Uri previous;
        List<Item> previousItems;
        synchronized (lock) {
            previous = tree;
            previousItems = new ArrayList<>(items);
            items.clear();
            tree = null;
            folderName = "";
        }
        if (previous != null) {
            try {
                activity.getContentResolver().releasePersistableUriPermission(previous, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Already released, or the grant was only temporary.
            }
        }
        for (Item item : previousItems) {
            if (item.cache != null) item.cache.delete();
        }
        File directory = new File(activity.getCacheDir(), "folder-import");
        File[] leftovers = directory.listFiles();
        if (leftovers != null) {
            for (File leftover : leftovers) leftover.delete();
        }
    }

    private void load(Uri picked) throws Exception {
        release();
        String name = displayName(picked);
        if (name == null || name.isEmpty()) name = "Audiobook";
        List<Item> loaded = copyAudio(picked);
        synchronized (lock) {
            tree = picked;
            folderName = name;
            items.clear();
            items.addAll(loaded);
        }
    }

    private String displayName(Uri picked) {
        Uri document = DocumentsContract.buildDocumentUriUsingTree(picked, DocumentsContract.getTreeDocumentId(picked));
        try (Cursor cursor = activity.getContentResolver().query(
            document,
            new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
            return "";
        }
        return "";
    }

    private List<Item> copyAudio(Uri picked) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(picked, DocumentsContract.getTreeDocumentId(picked));
        List<String[]> rows = new ArrayList<>();
        try (Cursor cursor = activity.getContentResolver().query(
            children,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            },
            null,
            null,
            null
        )) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String mime = cursor.getString(2);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                    String display = cursor.getString(1);
                    if (!isAudio(display, mime)) continue;
                    rows.add(new String[] { cursor.getString(0), display });
                }
            }
        }
        File directory = new File(activity.getCacheDir(), "folder-import");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("cache");
        List<Item> loaded = new ArrayList<>();
        int done = 0;
        for (String[] row : rows) {
            Uri document = DocumentsContract.buildDocumentUriUsingTree(picked, row[0]);
            File cache = new File(directory, done + ".bin");
            long size = copy(document, cache);
            loaded.add(new Item(row[1], cache, size));
            done += 1;
            notifyProgress(done, rows.size());
        }
        return loaded;
    }

    private long copy(Uri document, File cache) throws Exception {
        try (InputStream input = activity.getContentResolver().openInputStream(document);
             FileOutputStream output = new FileOutputStream(cache)) {
            if (input == null) throw new IllegalStateException("unreadable");
            byte[] buffer = new byte[65536];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
                total += read;
            }
            return total;
        }
    }

    private static boolean isAudio(String name, String mime) {
        if (mime != null && mime.startsWith("audio/")) return true;
        if (name == null) return false;
        String lower = name.toLowerCase();
        return lower.endsWith(".mp3")
            || lower.endsWith(".m4a")
            || lower.endsWith(".m4b")
            || lower.endsWith(".aac")
            || lower.endsWith(".wav")
            || lower.endsWith(".ogg")
            || lower.endsWith(".flac")
            || lower.endsWith(".mp4")
            || lower.endsWith(".mpeg");
    }

    private void notifyProgress(int done, int total) {
        eval("window.__narrivoxFolderProgress&&window.__narrivoxFolderProgress(" + done + "," + total + ")");
    }

    private void notifyPicked(boolean ok) {
        eval("window.__narrivoxFolderPicked&&window.__narrivoxFolderPicked(" + ok + ")");
    }

    private void eval(String script) {
        activity.runOnUiThread(() -> {
            WebView webView = webViewProvider.webView();
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }
}
