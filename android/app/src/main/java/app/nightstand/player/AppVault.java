package app.nightstand.player;

import android.content.Context;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Library and settings stored under the app files directory. That directory
 * survives an update; the WebView store does not always.
 */
public final class AppVault {
    private static final int CHUNK = 128 * 1024;
    private final File root;

    public AppVault(Context context) {
        root = new File(context.getFilesDir(), "narrivox");
    }

    @JavascriptInterface
    public String readText(String name) {
        try {
            File file = textFile(name);
            if (!file.isFile()) return "";
            byte[] bytes = readAll(file);
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean writeText(String name, String json) {
        try {
            File file = textFile(name);
            if (!root.exists() && !root.mkdirs()) return false;
            byte[] bytes = (json == null ? "" : json).getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean hasAudio(String bookId, String chapterId) {
        try {
            File file = audioFile(bookId, chapterId);
            return file.isFile() && file.length() > 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String audioSize(String bookId, String chapterId) {
        try {
            File file = audioFile(bookId, chapterId);
            if (!file.isFile()) return "0";
            return Long.toString(file.length());
        } catch (Exception ignored) {
            return "0";
        }
    }

    @JavascriptInterface
    public boolean writeChunk(String bookId, String chapterId, int offset, String base64) {
        if (offset < 0 || base64 == null) return false;
        try {
            File file = audioFile(bookId, chapterId);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) return false;
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
                if (offset == 0) raf.setLength(0);
                raf.seek(offset);
                raf.write(bytes);
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String readChunk(String bookId, String chapterId, int offset, int length) {
        if (offset < 0 || length <= 0) return "";
        try {
            File file = audioFile(bookId, chapterId);
            if (!file.isFile()) return "";
            int amount = (int) Math.min(Math.min(length, CHUNK), file.length() - offset);
            if (amount <= 0) return "";
            byte[] buffer = new byte[amount];
            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                raf.seek(offset);
                int read = raf.read(buffer);
                if (read <= 0) return "";
                if (read < buffer.length) {
                    byte[] exact = new byte[read];
                    System.arraycopy(buffer, 0, exact, 0, read);
                    buffer = exact;
                }
            }
            return Base64.encodeToString(buffer, Base64.NO_WRAP);
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean deleteBook(String bookId) {
        try {
            File directory = new File(new File(root, "audio"), safe(bookId));
            deleteTree(directory);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String listAudio() {
        JSONArray rows = new JSONArray();
        try {
            File audio = new File(root, "audio");
            File[] books = audio.listFiles();
            if (books == null) return "[]";
            for (File book : books) {
                if (!book.isDirectory()) continue;
                File[] chapters = book.listFiles();
                if (chapters == null) continue;
                for (File chapter : chapters) {
                    if (!chapter.isFile() || chapter.length() <= 0) continue;
                    JSONObject row = new JSONObject();
                    row.put("bookId", book.getName());
                    row.put("chapterId", chapter.getName());
                    row.put("size", chapter.length());
                    rows.put(row);
                }
            }
        } catch (Exception ignored) {
            return "[]";
        }
        return rows.toString();
    }

    private File textFile(String name) {
        if (!"config".equals(name) && !"books".equals(name)) {
            throw new IllegalArgumentException("bad name");
        }
        return new File(root, name + ".json");
    }

    private File audioFile(String bookId, String chapterId) {
        return new File(new File(new File(root, "audio"), safe(bookId)), safe(chapterId));
    }

    private static String safe(String id) {
        if (id == null || id.isEmpty() || id.length() > 180) throw new IllegalArgumentException("bad id");
        for (int i = 0; i < id.length(); i += 1) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z')
                || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9')
                || c == '.'
                || c == '_'
                || c == '-';
            if (!ok) throw new IllegalArgumentException("bad id");
        }
        return id;
    }

    private static byte[] readAll(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            return input.readAllBytes();
        }
    }

    private static void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteTree(child);
            }
        }
        file.delete();
    }
}
