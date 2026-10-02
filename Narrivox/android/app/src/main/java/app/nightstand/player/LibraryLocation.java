package app.nightstand.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** A folder the user picked for the library. The grant survives an update. */
public final class LibraryLocation {
    static final int REQUEST = 9042;
    private static final String PREFS = "narrivox-library";
    private static final String KEY_URI = "tree";
    private static final int CHUNK = 128 * 1024;

    private final Activity activity;
    private final WebViewProvider webViewProvider;
    private final SharedPreferences prefs;
    private Uri active;
    private Uri pending;

    interface WebViewProvider {
        WebView webView();
    }

    LibraryLocation(Activity activity, WebViewProvider webViewProvider) {
        this.activity = activity;
        this.webViewProvider = webViewProvider;
        prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(KEY_URI, "");
        if (saved != null && !saved.isEmpty()) active = Uri.parse(saved);
    }

    void launch() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        activity.startActivityForResult(intent, REQUEST);
    }

    void onResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            notifyPicked("cancel");
            return;
        }
        Uri picked = data.getData();
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            activity.getContentResolver().takePersistableUriPermission(picked, flags);
        } catch (SecurityException ignored) {
            notifyPicked("cancel");
            return;
        }
        if (active != null && sameTree(active, picked)) {
            release(picked);
            notifyPicked("same");
            return;
        }
        if (pending != null && pending != active) release(pending);
        pending = picked;
        notifyPicked("ok");
    }

    @JavascriptInterface
    public boolean usingFolder() {
        return active != null;
    }

    @JavascriptInterface
    public String locationLabel() {
        if (active == null) return "App storage";
        return friendly(active);
    }

    @JavascriptInterface
    public String pendingLabel() {
        if (pending == null) return "";
        return friendly(pending);
    }

    @JavascriptInterface
    public void pickFolder() {
        activity.runOnUiThread(this::launch);
    }

    @JavascriptInterface
    public boolean commitFolder() {
        if (pending == null) return active != null;
        Uri old = active;
        active = pending;
        pending = null;
        prefs.edit().putString(KEY_URI, active.toString()).apply();
        if (old != null && !sameTree(old, active)) {
            try {
                deleteLibrary(old);
            } catch (Exception ignored) {
                // The new folder already has the books. The old grant is still dropped.
            }
            release(old);
        }
        return true;
    }

    @JavascriptInterface
    public void discardFolder() {
        if (pending != null) {
            release(pending);
            pending = null;
        }
    }

    @JavascriptInterface
    public String readManifest(boolean staged) {
        try {
            Uri root = root(staged);
            if (root == null) return "";
            Uri file = findChild(root, "narrivox.json");
            if (file == null) return "";
            return new String(readAll(file), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean writeManifest(boolean staged, String json) {
        try {
            Uri root = root(staged);
            if (root == null) return false;
            Uri file = findOrCreate(root, "narrivox.json", false);
            if (file == null) return false;
            try (OutputStream output = activity.getContentResolver().openOutputStream(file, "wt")) {
                if (output == null) return false;
                output.write((json == null ? "" : json).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String listAudio(boolean staged) {
        JSONArray rows = new JSONArray();
        try {
            Uri root = root(staged);
            if (root == null) return "[]";
            Uri audio = findChild(root, "audio");
            if (audio == null) return "[]";
            for (Child book : children(audio)) {
                if (!book.dir) continue;
                for (Child chapter : children(book.uri)) {
                    if (chapter.dir || chapter.size <= 0) continue;
                    JSONObject row = new JSONObject();
                    row.put("bookId", book.name);
                    row.put("chapterId", chapter.name);
                    row.put("size", chapter.size);
                    rows.put(row);
                }
            }
        } catch (Exception ignored) {
            return "[]";
        }
        return rows.toString();
    }

    @JavascriptInterface
    public boolean writeChunk(boolean staged, String bookId, String chapterId, int offset, String base64) {
        if (offset < 0 || base64 == null || !safe(bookId) || !safe(chapterId)) return false;
        try {
            Uri root = root(staged);
            if (root == null) return false;
            Uri audio = findOrCreate(root, "audio", true);
            if (audio == null) return false;
            Uri book = findOrCreate(audio, bookId, true);
            if (book == null) return false;
            Uri file = findOrCreate(book, chapterId, false);
            if (file == null) return false;
            try (OutputStream output = activity.getContentResolver().openOutputStream(file, offset == 0 ? "wt" : "wa")) {
                if (output == null) return false;
                output.write(Base64.decode(base64, Base64.NO_WRAP));
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String readChunk(boolean staged, String bookId, String chapterId, int offset, int length) {
        if (offset < 0 || length <= 0 || !safe(bookId) || !safe(chapterId)) return "";
        try {
            Uri file = audioFile(staged, bookId, chapterId);
            if (file == null) return "";
            int amount = Math.min(length, CHUNK);
            try (InputStream input = activity.getContentResolver().openInputStream(file)) {
                if (input == null) return "";
                long left = offset;
                while (left > 0) {
                    long skipped = input.skip(left);
                    if (skipped <= 0) return "";
                    left -= skipped;
                }
                byte[] buffer = new byte[amount];
                int filled = 0;
                while (filled < amount) {
                    int read = input.read(buffer, filled, amount - filled);
                    if (read < 0) break;
                    filled += read;
                }
                if (filled <= 0) return "";
                if (filled < buffer.length) {
                    byte[] exact = new byte[filled];
                    System.arraycopy(buffer, 0, exact, 0, filled);
                    buffer = exact;
                }
                return Base64.encodeToString(buffer, Base64.NO_WRAP);
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean deleteBook(boolean staged, String bookId) {
        if (!safe(bookId)) return false;
        try {
            Uri root = root(staged);
            if (root == null) return false;
            Uri audio = findChild(root, "audio");
            if (audio == null) return true;
            Uri book = findChild(audio, bookId);
            if (book == null) return true;
            DocumentsContract.deleteDocument(activity.getContentResolver(), book);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private Uri audioFile(boolean staged, String bookId, String chapterId) {
        Uri root = root(staged);
        if (root == null) return null;
        Uri audio = findChild(root, "audio");
        if (audio == null) return null;
        Uri book = findChild(audio, bookId);
        if (book == null) return null;
        return findChild(book, chapterId);
    }

    private Uri root(boolean staged) {
        Uri tree = staged && pending != null ? pending : active;
        if (tree == null) return null;
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private void deleteLibrary(Uri tree) {
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri manifest = findChildIn(tree, root, "narrivox.json");
        if (manifest != null) {
            try {
                DocumentsContract.deleteDocument(activity.getContentResolver(), manifest);
            } catch (Exception ignored) {
                // The folder grant is released either way.
            }
        }
        Uri audio = findChildIn(tree, root, "audio");
        if (audio != null) {
            try {
                DocumentsContract.deleteDocument(activity.getContentResolver(), audio);
            } catch (Exception ignored) {
                // Same as a manifest that was already gone.
            }
        }
    }

    private Uri findChildIn(Uri tree, Uri parent, String name) {
        for (Child child : childrenOf(tree, parent)) {
            if (name.equals(child.name)) return child.uri;
        }
        return null;
    }

    private Uri findOrCreate(Uri parent, String name, boolean directory) {
        Uri existing = findChild(parent, name);
        if (existing != null) return existing;
        try {
            return DocumentsContract.createDocument(
                activity.getContentResolver(),
                parent,
                directory ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream",
                name
            );
        } catch (Exception ignored) {
            return null;
        }
    }

    private Uri findChild(Uri parent, String name) {
        for (Child child : children(parent)) {
            if (name.equals(child.name)) return child.uri;
        }
        return null;
    }

    private static final class Child {
        final Uri uri;
        final String name;
        final boolean dir;
        final long size;

        Child(Uri uri, String name, boolean dir, long size) {
            this.uri = uri;
            this.name = name;
            this.dir = dir;
            this.size = size;
        }
    }

    private java.util.List<Child> children(Uri parent) {
        return childrenOf(treeOf(parent), parent);
    }

    private java.util.List<Child> childrenOf(Uri tree, Uri parent) {
        java.util.List<Child> rows = new java.util.ArrayList<>();
        if (parent == null || tree == null) return rows;
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent));
        try (Cursor cursor = activity.getContentResolver().query(
            kids,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
            },
            null,
            null,
            null
        )) {
            if (cursor == null) return rows;
            while (cursor.moveToNext()) {
                String id = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                long size = cursor.isNull(3) ? 0 : cursor.getLong(3);
                if (id == null || name == null) continue;
                rows.add(new Child(
                    DocumentsContract.buildDocumentUriUsingTree(tree, id),
                    name,
                    DocumentsContract.Document.MIME_TYPE_DIR.equals(mime),
                    size
                ));
            }
        } catch (Exception ignored) {
            return rows;
        }
        return rows;
    }

    private Uri treeOf(Uri document) {
        try {
            String id = DocumentsContract.getTreeDocumentId(document);
            if (active != null && id.equals(DocumentsContract.getTreeDocumentId(active))) return active;
            if (pending != null && id.equals(DocumentsContract.getTreeDocumentId(pending))) return pending;
        } catch (Exception ignored) {
            return active != null ? active : pending;
        }
        return active != null ? active : pending;
    }

    private byte[] readAll(Uri file) throws Exception {
        try (InputStream input = activity.getContentResolver().openInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return new byte[0];
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }

    private String friendly(Uri uri) {
        try {
            String doc = DocumentsContract.getTreeDocumentId(uri);
            if (doc != null && doc.startsWith("primary:")) {
                String rest = doc.substring("primary:".length());
                if (rest.isEmpty()) return "Internal storage";
                return "Internal storage/" + rest;
            }
        } catch (Exception ignored) {
            // Fall through to the display name.
        }
        String name = queryName(uri);
        return name.isEmpty() ? "Chosen folder" : name;
    }

    private String queryName(Uri uri) {
        Uri document = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
        try (Cursor cursor = activity.getContentResolver().query(
            document,
            new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                return name == null ? "" : name;
            }
        } catch (Exception ignored) {
            return "";
        }
        return "";
    }

    private static boolean sameTree(Uri left, Uri right) {
        try {
            return DocumentsContract.getTreeDocumentId(left).equals(DocumentsContract.getTreeDocumentId(right));
        } catch (Exception ignored) {
            return left.equals(right);
        }
    }

    private static boolean safe(String id) {
        if (id == null || id.isEmpty() || id.length() > 180) return false;
        for (int i = 0; i < id.length(); i += 1) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z')
                || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9')
                || c == '.'
                || c == '_'
                || c == '-';
            if (!ok) return false;
        }
        return true;
    }

    private void release(Uri uri) {
        if (uri == null) return;
        try {
            activity.getContentResolver().releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Already released, or the grant was only temporary.
        }
    }

    private void notifyPicked(String result) {
        activity.runOnUiThread(() -> {
            WebView webView = webViewProvider.webView();
            if (webView == null) return;
            String safe = "ok".equals(result) || "same".equals(result) ? result : "cancel";
            webView.evaluateJavascript(
                "window.__narrivoxLibraryPicked&&window.__narrivoxLibraryPicked('" + safe + "')",
                null
            );
        });
    }
}
