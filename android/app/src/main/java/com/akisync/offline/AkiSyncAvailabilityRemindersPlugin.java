package com.akisync.offline;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "AkiSyncAvailabilityReminders", permissions = {
    @Permission(alias = "reminders", strings = Manifest.permission.POST_NOTIFICATIONS),
})
public class AkiSyncAvailabilityRemindersPlugin extends Plugin {
    @PluginMethod
    public void requestNotificationAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("reminders") != PermissionState.GRANTED) {
            requestPermissionForAlias("reminders", call, "accessResult");
        } else {
            accessResult(call);
        }
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        boolean granted = Build.VERSION.SDK_INT < 24 || manager.areNotificationsEnabled();
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void notificationAccess(PluginCall call) {
        accessResult(call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
            if (Build.VERSION.SDK_INT >= 26) intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            getActivity().startActivity(intent);
            call.resolve();
        } catch (RuntimeException unavailable) {
            call.reject("Could not open Android notification settings.");
        }
    }

    @PluginMethod
    public void exactAlarmAccess(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 31 || getContext().getSystemService(AlarmManager.class).canScheduleExactAlarms();
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.fromParts("package", getContext().getPackageName(), null)));
            } catch (RuntimeException unavailable) {
                call.reject("Could not open Android alarm settings.");
                return;
            }
        }
        call.resolve();
    }
}
