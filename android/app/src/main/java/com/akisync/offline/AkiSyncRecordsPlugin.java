package com.akisync.offline;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.database.sqlite.SQLiteDatabase;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "AkiSyncRecords")
public class AkiSyncRecordsPlugin extends Plugin {
    private static final String FOLDER = "recordsFolder";
    private static final String VERIFIER = "appLock";
    private static final String MIGRATION = "retireOldVault";
    private static final String LEGACY_DATABASE = "akisync_vault.sqlite";
    private static final int ACCESS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private SharedPreferences settings;

    @Override
    public void load() {
        settings = getContext().getSharedPreferences("akisync-settings", 0);
        File[] stale = getContext().getCacheDir().listFiles((directory, name) ->
            (name.startsWith("akisync-read-") || name.startsWith("akisync-write-")) && name.endsWith(".sqlite"));
        if (stale != null) {
            for (File file : stale) SQLiteDatabase.deleteDatabase(file);
        }
    }

    @PluginMethod
    public void configuration(PluginCall call) {
        String folder = settings.getString(FOLDER, null);
        JSObject result = new JSObject();
        if (folder != null) result.put("folder", folder);
        String verifier = settings.getString(VERIFIER, null);
        if (verifier != null) result.put("verifier", verifier);
        result.put("legacy", folder == null && getContext().getDatabasePath(LEGACY_DATABASE).exists());
        call.resolve(result);
    }

    @PluginMethod
    public void setVerifier(PluginCall call) {
        String verifier = call.getString("verifier");
        if (verifier != null && !verifier.matches("[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=")) {
            call.reject("Invalid app passphrase verifier.");
            return;
        }
        if (settings.edit().putString(VERIFIER, verifier).commit()) call.resolve();
        else call.reject("Could not save the app passphrase setting.");
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(ACCESS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        startPicker(call, intent, "folderSelected");
    }

    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        Uri uri = selectedDocument(call, result);
        if (uri == null) return;
        try {
            int flags = result.getData().getFlags() & ACCESS;
            if (flags != ACCESS) throw new SecurityException();
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            call.resolve(new JSObject().put("uri", uri.toString()).put("cancelled", false));
        } catch (RuntimeException error) {
            call.reject("Choose a folder that AkiSync can read and write.");
        }
    }

    @PluginMethod
    public void inspectFolder(PluginCall call) {
        try {
            String uri = call.getString("uri");
            FolderDatabase database = folder(uri);
            JSObject result = new JSObject().put("name", database.name());
            FolderDatabase.Snapshot snapshot = database.read();
            if (snapshot != null) {
                result.put("records", snapshot.records());
                if (uri.equals(settings.getString(FOLDER, null))) retireLegacyDatabase();
            }
            call.resolve(result);
        } catch (IOException | RuntimeException error) {
            rejectFolder(call, error);
        }
    }

    @PluginMethod
    public void setFolder(PluginCall call) {
        String uri = call.getString("uri");
        String seed = call.getString("seed");
        String adopted = call.getString("adopted");
        try {
            FolderDatabase database = folder(uri);
            String name = database.name();
            FolderDatabase.Snapshot original = database.read();
            if (seed != null) {
                if (original != null || !database.write(0, seed)) throw new IOException("Choose an empty folder for these records.");
            } else if (original == null || !original.records().equals(adopted)) {
                throw new IOException("The folder contents changed. Select the folder again.");
            }
            SharedPreferences.Editor selection = settings.edit().putString(FOLDER, uri);
            if (Boolean.TRUE.equals(call.getBoolean("migrated"))) selection.putBoolean(MIGRATION, true);
            synchronized (AvailabilityReminderReceiver.SCHEDULING_LOCK) {
                if (!selection.commit()) throw new IOException("Could not save the selected folder.");
                AvailabilityReminderReceiver.updateSchedule(getContext(), original == null ? seed : original.records());
            }
            retireLegacyDatabase();
            call.resolve(new JSObject().put("name", name));
        } catch (IOException | RuntimeException error) {
            rejectFolder(call, error);
        }
    }

    @PluginMethod
    public void readRecords(PluginCall call) {
        try {
            FolderDatabase.Snapshot row = folder(settings.getString(FOLDER, null)).read();
            if (row == null) throw new IOException("The database files are missing. Select the records folder again.");
            call.resolve(new JSObject().put("revision", row.revision()).put("records", row.records()));
        } catch (IOException | RuntimeException error) {
            rejectFolder(call, error);
        }
    }

    @PluginMethod
    public void writeRecords(PluginCall call) {
        Integer revision = call.getInt("revision");
        String records = call.getString("records");
        if (revision == null || revision <= 0 || revision == Integer.MAX_VALUE || records == null) {
            call.reject("Invalid records update.");
            return;
        }
        try {
            synchronized (AvailabilityReminderReceiver.SCHEDULING_LOCK) {
                if (!folder(settings.getString(FOLDER, null)).write(revision, records)) {
                    throw new IOException("The database changed. Reopen the app before retrying.");
                }
                AvailabilityReminderReceiver.updateSchedule(getContext(), records);
            }
            call.resolve();
        } catch (IOException | RuntimeException error) {
            rejectFolder(call, error);
        }
    }

    @PluginMethod
    public void readLegacy(PluginCall call) {
        if (settings.contains(FOLDER) || !getContext().getDatabasePath(LEGACY_DATABASE).exists()) {
            call.resolve(new JSObject());
            return;
        }
        try (VaultDatabase database = new VaultDatabase(getContext(), LEGACY_DATABASE)) {
            VaultDatabase.Row row = database.read();
            call.resolve(row.revision() == 0 ? new JSObject() : new JSObject().put("encrypted", row.encrypted()));
        } catch (RuntimeException error) {
            call.reject("Could not read the previous AkiSync vault.");
        }
    }

    @PluginMethod
    public void chooseRecordsFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        startPicker(call, intent, "recordsFileSelected");
    }

    @ActivityCallback
    private void recordsFileSelected(PluginCall call, ActivityResult result) {
        Uri uri = selectedDocument(call, result);
        if (uri == null) return;
        execute(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IOException();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                int limit = "patient-list".equals(call.getString("kind")) ? 2 * 1024 * 1024 : VaultDatabase.MAX_BYTES;
                byte[] chunk = new byte[16 * 1024];
                int count;
                while ((count = input.read(chunk)) != -1) {
                    if (buffer.size() + count > limit) {
                        call.reject("The selected file is too large.");
                        return;
                    }
                    buffer.write(chunk, 0, count);
                }
                call.resolve(new JSObject().put("cancelled", false).put("content", buffer.toString(StandardCharsets.UTF_8.name())));
            } catch (IOException | RuntimeException error) {
                call.reject("Could not read the selected file.");
            }
        });
    }

    private FolderDatabase folder(String value) throws IOException {
        if (value == null) throw new IOException("Select the records folder first.");
        Uri uri = Uri.parse(value);
        if (!"content".equals(uri.getScheme())) throw new IOException("Select a records folder.");
        for (UriPermission grant : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (uri.equals(grant.getUri()) && grant.isReadPermission() && grant.isWritePermission()) {
                return new FolderDatabase(getContext(), uri);
            }
        }
        throw new IOException("AkiSync lost access to the records folder. Select it again.");
    }

    private void retireLegacyDatabase() {
        if (!settings.getBoolean(MIGRATION, false)) return;
        if (getContext().deleteDatabase(LEGACY_DATABASE) || !getContext().getDatabasePath(LEGACY_DATABASE).exists()) {
            settings.edit().remove(MIGRATION).apply();
        }
    }

    private void startPicker(PluginCall call, Intent intent, String callback) {
        try { startActivityForResult(call, intent, callback); }
        catch (RuntimeException error) { call.reject("The Android file picker could not open."); }
    }

    private Uri selectedDocument(PluginCall call, ActivityResult result) {
        if (call == null) return null;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.resolve(new JSObject().put("cancelled", true));
            return null;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null) call.reject("The file picker returned no selection.");
        return uri;
    }

    private void rejectFolder(PluginCall call, Exception error) {
        call.reject(error instanceof IOException ? error.getMessage() : "Could not access the selected records folder.");
    }
}
