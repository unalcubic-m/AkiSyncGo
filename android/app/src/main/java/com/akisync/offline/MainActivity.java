package com.akisync.offline;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        sendBroadcast(new Intent(this, AvailabilityReminderReceiver.class));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(AkiSyncRecordsPlugin.class);
        registerPlugin(AkiSyncCalendarPlugin.class);
        registerPlugin(AkiSyncClipboardPlugin.class);
        registerPlugin(AkiSyncAvailabilityRemindersPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            fitWebViewToWindow((View) webView.getParent());
        }
    }

    private static void fitWebViewToWindow(View container) {
        int insetTypes = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime();
        ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
            Insets padding = insets.getInsets(insetTypes);
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
            // The container already reserves these areas, so the WebView sees the resized content bounds.
            return new WindowInsetsCompat.Builder(insets).setInsets(insetTypes, Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(container);
    }
}
