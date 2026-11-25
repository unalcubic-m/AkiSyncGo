package com.akisync.offline;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

final class VaultDatabase extends SQLiteOpenHelper {
    static final int MAX_BYTES = 32 * 1024 * 1024;

    record Row(int revision, String encrypted) {}

    VaultDatabase(Context context, String name) {
        super(context, name, null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE vault (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)");
        db.execSQL("INSERT INTO vault (id, revision) VALUES (1, 0)");
        db.execSQL("CREATE TABLE vault_chunk (position INTEGER PRIMARY KEY, encrypted TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("This SQLite vault version is unsupported.");
    }

    Row read() {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            int revision;
            try (Cursor cursor = db.rawQuery("SELECT revision FROM vault WHERE id = 1", null)) {
                if (!cursor.moveToFirst()) throw new IllegalStateException("Missing vault metadata.");
                revision = cursor.getInt(0);
            }
            StringBuilder encrypted = new StringBuilder();
            try (Cursor cursor = db.rawQuery("SELECT position, encrypted FROM vault_chunk ORDER BY position", null)) {
                int position = 0;
                while (cursor.moveToNext()) {
                    if (cursor.getInt(0) != position++) throw new IllegalStateException("Missing ciphertext chunk.");
                    encrypted.append(cursor.getString(1));
                    if (encrypted.length() > MAX_BYTES) throw new IllegalStateException("The vault exceeds its size limit.");
                }
            }
            if ((revision == 0) != (encrypted.length() == 0)) throw new IllegalStateException("Incomplete vault contents.");
            db.setTransactionSuccessful();
            return new Row(revision, encrypted.toString());
        } finally {
            db.endTransaction();
        }
    }
}
