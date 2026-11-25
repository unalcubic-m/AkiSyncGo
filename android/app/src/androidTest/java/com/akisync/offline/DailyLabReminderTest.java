package com.akisync.offline;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.Arrays;
import java.util.Calendar;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DailyLabReminderTest {
    private static final TimeZone CLINIC = TimeZone.getTimeZone("Europe/Istanbul");
    private static final String SCHEDULED_AT = "dailyLabScheduledAt";
    private static final int NOTIFICATION_ID = 131;
    private Context context;
    private SharedPreferences preferences;
    private NotificationManager notifications;
    private String friday;
    private String monday;

    @Before
    public void setUp() {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context target = instrumentation.getTargetContext();
        preferences = target.getSharedPreferences("test-daily-lab-reminder", Context.MODE_PRIVATE);
        context = new ContextWrapper(target) {
            @Override
            public SharedPreferences getSharedPreferences(String name, int mode) {
                return preferences;
            }
        };
        notifications = target.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 33 && target.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            instrumentation.getUiAutomation().grantRuntimePermission(target.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        }
        // Use dates far enough ahead that Android won't dispatch the test alarms while the test drives the clock.
        Calendar date = Calendar.getInstance(CLINIC);
        date.add(Calendar.DATE, 7 + Math.floorMod(Calendar.FRIDAY - date.get(Calendar.DAY_OF_WEEK), 7));
        friday = localDate(date);
        date.add(Calendar.DATE, 3);
        monday = localDate(date);
    }

    @After
    public void cleanUp() {
        DailyLabReminder.update(context, null, Calendar.getInstance(CLINIC), null);
        preferences.edit().clear().commit();
    }

    @Test
    public void nothingArrivedSkipsADelayedAlarmAndRestoresTheNextScheduledDayFromDisk() throws Exception {
        JSONObject records = labRecords();
        DailyLabReminder.update(context, records, clock(friday, "09:00"), null);
        assertScheduled(friday, "10:00");

        records.put("dailyLabCheck", new JSONObject().put("date", friday).put("result", "nothing"));
        File file = File.createTempFile("daily-lab-", ".sqlite", context.getCacheDir());
        try {
            FolderDatabase.writeSnapshot(file, new FolderDatabase.Snapshot(1, records.toString()));
            JSONObject reopened = new JSONObject(FolderDatabase.readSnapshot(file).records());
            DailyLabReminder.update(context, reopened, clock(friday, "09:30"), new Intent(Intent.ACTION_BOOT_COMPLETED));
            assertScheduled(monday, "10:00");

            DailyLabReminder.update(context, reopened, clock(friday, "10:00"), alarm(friday, "10:00"));
            assertFalse(isLabNotificationVisible());
            assertNull(preferences.getString("lastDailyLabReminder", null));
            assertScheduled(monday, "10:00");
            DailyLabReminder.update(context, reopened, clock(monday, "10:00"), alarm(monday, "10:00"));
            awaitLabNotification(true);
        } finally {
            SQLiteDatabase.deleteDatabase(file);
        }
    }

    @Test
    public void dismissClearsTheNotificationAndLaterLabWorkDoesNotReopenTodaysSchedule() throws Exception {
        JSONObject records = labRecords();
        DailyLabReminder.update(context, records, clock(friday, "10:00"), alarm(friday, "10:00"));
        awaitLabNotification(true);

        records.put("dailyLabCheck", new JSONObject().put("date", friday).put("result", "dismissed"));
        DailyLabReminder.update(context, records, clock(friday, "10:01"), null);
        awaitLabNotification(false);

        records.put("waits", new JSONArray("""
            [{"type":"Laboratory return","status":"Resolved"}, {"type":"Laboratory return","status":"Waiting"}]
            """));
        records.getJSONObject("dailyLabReminder").put("time", "14:00");
        DailyLabReminder.update(context, records, clock(friday, "13:00"), null);
        assertScheduled(monday, "14:00");
        DailyLabReminder.update(context, records, clock(friday, "14:00"), alarm(friday, "14:00"));
        assertFalse(isLabNotificationVisible());
    }

    private static JSONObject labRecords() throws Exception {
        return new JSONObject("""
            {"dailyLabReminder":{"enabled":true,"time":"10:00","days":[1,5]}}
            """);
    }

    private static Calendar clock(String date, String time) {
        Calendar now = Calendar.getInstance(CLINIC);
        now.setTimeInMillis(ReminderOpenings.at(date, time, CLINIC));
        return now;
    }

    private static String localDate(Calendar calendar) {
        return ReminderOpenings.isoDate(calendar.getTimeInMillis(), CLINIC);
    }

    private static Intent alarm(String date, String time) {
        return new Intent(DailyLabReminder.ACTION).putExtra("expectedDailyLabTime", ReminderOpenings.at(date, time, CLINIC));
    }

    private void assertScheduled(String date, String time) {
        assertEquals(ReminderOpenings.at(date, time, CLINIC), preferences.getLong(SCHEDULED_AT, 0));
    }

    private boolean isLabNotificationVisible() {
        return Arrays.stream(notifications.getActiveNotifications()).anyMatch(notification -> notification.getId() == NOTIFICATION_ID);
    }

    private void awaitLabNotification(boolean visible) {
        long deadline = SystemClock.elapsedRealtime() + 10_000L;
        while (isLabNotificationVisible() != visible && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50L);
        assertEquals(visible, isLabNotificationVisible());
    }
}
