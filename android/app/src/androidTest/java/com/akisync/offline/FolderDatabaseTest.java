package com.akisync.offline;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FolderDatabaseTest {
    @Test
    public void writesReadableChunksAndRejectsAnIncompleteSnapshot() throws IOException {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = File.createTempFile("test-folder-db-", ".sqlite", context.getCacheDir());
        String contents = "fictional patient 💡".repeat(280_000);
        FolderDatabase.Snapshot snapshot = new FolderDatabase.Snapshot(2, contents);
        try {
            FolderDatabase.writeSnapshot(file, snapshot);
            assertEquals(snapshot, FolderDatabase.readSnapshot(file));
            try (SQLiteDatabase database = SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
                 android.database.Cursor chunk = database.rawQuery("SELECT json FROM records WHERE position = 0", null)) {
                assertTrue(chunk.moveToFirst());
                assertTrue(chunk.getString(0).contains("fictional patient"));
                database.execSQL("DELETE FROM records WHERE position = 1");
            }
            assertThrows(IOException.class, () -> FolderDatabase.readSnapshot(file));
        } finally {
            SQLiteDatabase.deleteDatabase(file);
        }
    }
}
