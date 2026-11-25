package com.akisync.offline;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class FolderDatabase {
    static final String MAIN = "AkiSync.sqlite";
    static final String RECOVERY = "AkiSync-recovery.sqlite";
    private static final int MAX_RECORD_BYTES = 32 * 1024 * 1024;
    private static final int MAX_DATABASE_BYTES = 40 * 1024 * 1024;
    private static final int CHUNK_SIZE = 128 * 1024;

    record Snapshot(int revision, String records) {}
    private record State(Uri main, Uri recovery, boolean mainIsCurrent, Snapshot snapshot) {}

    private final Context context;
    private final ContentResolver resolver;
    private final Uri tree;
    private final Uri directory;
    private final String directoryId;

    FolderDatabase(Context context, Uri tree) {
        this.context = context;
        this.resolver = context.getContentResolver();
        this.tree = tree;
        this.directoryId = DocumentsContract.getTreeDocumentId(tree);
        this.directory = DocumentsContract.buildDocumentUriUsingTree(tree, directoryId);
    }

    String name() throws IOException {
        try (Cursor cursor = resolver.query(directory, new String[]{Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst() || !Document.MIME_TYPE_DIR.equals(cursor.getString(1))) {
                throw new IOException("The records folder is unavailable. Select it again.");
            }
            return cursor.getString(0);
        }
    }

    Snapshot read() throws IOException {
        return state().snapshot();
    }

    private State state() throws IOException {
        Uri main = null;
        Uri recovery = null;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, directoryId);
        String[] columns = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME};
        try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
            if (cursor == null) throw new IOException("Could not list the records folder.");
            while (cursor.moveToNext()) {
                String name = cursor.getString(1);
                if (MAIN.equals(name)) main = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                if (RECOVERY.equals(name)) recovery = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
            }
        }
        Snapshot first = readDocument(main);
        Snapshot second = readDocument(recovery);
        if (first == null && second == null && (main != null || recovery != null)) {
            throw new IOException("The selected folder contains a database that AkiSync could not read.");
        }
        boolean mainIsCurrent = first != null && (second == null || first.revision() >= second.revision());
        return new State(main, recovery, mainIsCurrent, mainIsCurrent ? first : second);
    }

    boolean write(int expectedRevision, String records) throws IOException {
        if (records.getBytes(StandardCharsets.UTF_8).length > MAX_RECORD_BYTES) throw new IOException("The database exceeds its 32 MiB records limit.");
        State current = state();
        int revision = current.snapshot() == null ? 0 : current.snapshot().revision();
        if (revision != expectedRevision) return false;
        Snapshot next = new Snapshot(revision + 1, records);
        File stage = File.createTempFile("akisync-write-", ".sqlite", context.getCacheDir());
        try {
            writeSnapshot(stage, next);
            if (current.mainIsCurrent()) {
                writeDocument(current.recovery(), RECOVERY, stage, next);
                try {
                    writeDocument(current.main(), MAIN, stage, next);
                } catch (IOException | RuntimeException ignored) {
                    // The verified recovery file already contains this revision.
                }
            } else {
                writeDocument(current.main(), MAIN, stage, next);
            }
            return true;
        } finally {
            SQLiteDatabase.deleteDatabase(stage);
        }
    }

    private Snapshot readDocument(Uri document) throws IOException {
        if (document == null) return null;
        File stage = File.createTempFile("akisync-read-", ".sqlite", context.getCacheDir());
        try {
            try (InputStream input = resolver.openInputStream(document); OutputStream output = new FileOutputStream(stage)) {
                copy(input, output);
            }
            return readSnapshot(stage);
        } catch (IOException | android.database.sqlite.SQLiteException error) {
            return null;
        } finally {
            SQLiteDatabase.deleteDatabase(stage);
        }
    }

    private void writeDocument(Uri document, String name, File stage, Snapshot expected) throws IOException {
        Uri target = document == null
            ? DocumentsContract.createDocument(resolver, directory, "application/octet-stream", name) : document;
        if (target == null) throw new IOException("Could not create a database file in this folder.");
        try {
            try (InputStream input = new FileInputStream(stage); OutputStream output = resolver.openOutputStream(target, "wt")) {
                copy(input, output);
            }
            if (!expected.equals(readDocument(target))) throw new IOException("Could not verify the saved database.");
        } catch (IOException | RuntimeException error) {
            if (document == null) {
                try { DocumentsContract.deleteDocument(resolver, target); }
                catch (IOException | RuntimeException ignored) { }
            }
            throw error;
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        if (input == null || output == null) throw new IOException("Could not open the database document.");
        byte[] buffer = new byte[64 * 1024];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_DATABASE_BYTES) throw new IOException("The database document is too large.");
            output.write(buffer, 0, count);
        }
    }

    static void writeSnapshot(File destination, Snapshot snapshot) {
        try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(destination, null)) {
            db.execSQL("CREATE TABLE metadata (format TEXT NOT NULL, revision INTEGER NOT NULL, checksum BLOB NOT NULL)");
            db.execSQL("CREATE TABLE records (position INTEGER PRIMARY KEY, json TEXT NOT NULL)");
            db.beginTransaction();
            try {
                ContentValues metadata = new ContentValues();
                metadata.put("format", "akisync-records/1");
                metadata.put("revision", snapshot.revision());
                metadata.put("checksum", checksum(snapshot));
                db.insertOrThrow("metadata", null, metadata);
                String records = snapshot.records();
                int offset = 0;
                int position = 0;
                while (offset < records.length()) {
                    int end = Math.min(offset + CHUNK_SIZE, records.length());
                    if (end < records.length() && Character.isHighSurrogate(records.charAt(end - 1))) end--;
                    ContentValues chunk = new ContentValues();
                    chunk.put("position", position++);
                    chunk.put("json", records.substring(offset, end));
                    db.insertOrThrow("records", null, chunk);
                    offset = end;
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
    }

    static Snapshot readSnapshot(File source) throws IOException {
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(source.getPath(), null, SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
             Cursor metadata = db.rawQuery("SELECT format, revision, checksum FROM metadata", null);
             Cursor chunks = db.rawQuery("SELECT position, json FROM records ORDER BY position", null)) {
            if (!metadata.moveToFirst() || !"akisync-records/1".equals(metadata.getString(0))) throw new IOException("Unknown AkiSync database format.");
            int revision = metadata.getInt(1);
            byte[] expected = metadata.getBlob(2);
            if (revision < 1 || metadata.moveToNext()) throw new IOException("Invalid database revision.");
            int position = 0;
            StringBuilder records = new StringBuilder();
            while (chunks.moveToNext()) {
                if (chunks.getInt(0) != position++) throw new IOException("Missing database records.");
                records.append(chunks.getString(1));
                if (records.length() > MAX_RECORD_BYTES) throw new IOException("The database records are too large.");
            }
            Snapshot snapshot = new Snapshot(revision, records.toString());
            if (!MessageDigest.isEqual(expected, checksum(snapshot))) throw new IOException("The database contents are incomplete.");
            return snapshot;
        }
    }

    private static byte[] checksum(Snapshot snapshot) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update((snapshot.revision() + "\n").getBytes(StandardCharsets.UTF_8));
            return digest.digest(snapshot.records().getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
