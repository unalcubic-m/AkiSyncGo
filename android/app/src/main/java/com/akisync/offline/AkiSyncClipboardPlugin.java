package com.akisync.offline;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.os.Build;
import android.os.PersistableBundle;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AkiSyncClipboard")
public class AkiSyncClipboardPlugin extends Plugin {
    @PluginMethod
    public void copyPatientPhone(PluginCall call) {
        String phone = call.getString("phone", "");
        if (phone.trim().isEmpty()) {
            call.reject("No phone number to copy.");
            return;
        }
        copyText(call, "Phone number", phone, true);
    }

    @PluginMethod
    public void copyAppointmentTime(PluginCall call) {
        String text = call.getString("text", "");
        if (text.trim().isEmpty()) {
            call.reject("No appointment time to copy.");
            return;
        }
        copyText(call, "Appointment time", text, false);
    }

    private void copyText(PluginCall call, String label, String text, boolean sensitive) {
        ClipboardManager clipboard = getContext().getSystemService(ClipboardManager.class);
        if (clipboard == null) {
            call.reject("Clipboard is unavailable.");
            return;
        }

        ClipData clip = ClipData.newPlainText(label, text);
        if (sensitive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }

        try {
            clipboard.setPrimaryClip(clip);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Could not copy to the clipboard.");
        }
    }
}
