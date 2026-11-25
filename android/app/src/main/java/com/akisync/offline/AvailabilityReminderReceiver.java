package com.akisync.offline;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AvailabilityReminderReceiver extends BroadcastReceiver {
    static final Object SCHEDULING_LOCK = new Object();
    private static final String ACTION = "com.akisync.offline.CHECK_AVAILABILITY";
    private static final String CHANNEL = "clinic-availability";
    private static final String EXPECTED_TIME = "expectedTime";
    private static final String TAG = "AvailabilityReminder";
    private static final int REQUEST_ID = 130;
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        worker.execute(() -> {
            try {
                synchronized (SCHEDULING_LOCK) {
                    runCheck(context, intent);
                }
            } finally {
                pending.finish();
            }
        });
    }

    private static void runCheck(Context context, Intent intent) {
        JSONObject records;
        try {
            String folder = preferences(context).getString("recordsFolder", null);
            FolderDatabase.Snapshot latest = folder == null ? null : new FolderDatabase(context, Uri.parse(folder)).read();
            records = latest == null ? null : new JSONObject(latest.records());
        } catch (Exception unavailable) {
            Log.w(TAG, "Could not read availability settings for this reminder");
            if (DailyLabReminder.ACTION.equals(intent.getAction())) DailyLabReminder.retry(context, intent);
            else retry(context);
            return;
        }

        Calendar now = Calendar.getInstance();
        if (!ACTION.equals(intent.getAction())) {
            try {
                DailyLabReminder.update(context, records, now, intent);
            } catch (RuntimeException unavailable) {
                Log.w(TAG, "Could not update daily laboratory reminders");
            }
        }
        if (DailyLabReminder.ACTION.equals(intent.getAction())) return;
        try {
            JSONObject settings = settings(records);
            ReminderOpenings.WorkingDay availableDay = dayWithLocalOpening(records, settings, now);
            schedule(context, settings, now, availableDay != null);
            long expected = intent.getLongExtra(EXPECTED_TIME, 0);
            if (ACTION.equals(intent.getAction()) && availableDay != null && shouldCheck(settings, expected, now)) {
                checkAndNotify(context, records, settings, availableDay, now, expected);
            }
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "Could not check calendar availability for this reminder");
        }
    }

    static void updateSchedule(Context context, String records) {
        try {
            JSONObject snapshot = records == null ? null : new JSONObject(records);
            JSONObject settings = settings(snapshot);
            Calendar now = Calendar.getInstance();
            DailyLabReminder.update(context, snapshot, now, null);
            // If the AkiSync calendar alone has no qualifying gap, an outside calendar change
            // cannot reopen it. A later write reevaluates and restores any remaining checks.
            schedule(context, settings, now, dayWithLocalOpening(snapshot, settings, now) != null);
        } catch (Exception unavailable) {
            Log.w(TAG, "Could not update availability reminders");
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("akisync-settings", Context.MODE_PRIVATE);
    }

    private static JSONObject settings(JSONObject records) {
        JSONObject stored = records == null ? null : records.optJSONObject("availabilitySettings");
        return stored != null && stored.optBoolean("remindersEnabled") ? stored : null;
    }

    private static ReminderOpenings.WorkingDay dayWithLocalOpening(JSONObject records, JSONObject settings, Calendar now) {
        if (settings == null) return null;
        ReminderOpenings.WorkingDay day = ReminderOpenings.nextWorkingDay(records, now);
        if (day == null) return null;
        int longest = ReminderOpenings.longestOpening(records, day, new JSONArray(), now.getTimeZone());
        return longest >= settings.optInt("minimumMinutes", 30) ? day : null;
    }

    private static void schedule(Context context, JSONObject settings, Calendar now, boolean checkToday) {
        JSONArray times = settings == null ? null : settings.optJSONArray("reminderTimes");
        if (times == null || times.length() == 0) {
            PendingIntent previous = PendingIntent.getBroadcast(context, REQUEST_ID, alarmIntent(context, 0),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (previous != null) {
                context.getSystemService(AlarmManager.class).cancel(previous);
                previous.cancel();
            }
            return;
        }
        long next = nextReminderAt(times, now, checkToday);
        if (next != Long.MAX_VALUE) setAlarm(context, next, next);
    }

    static long nextReminderAt(JSONArray times, Calendar now, boolean checkToday) {
        long next = Long.MAX_VALUE;
        for (int day = checkToday ? 0 : 1; day <= 1; day++) {
            Calendar date = (Calendar) now.clone();
            date.add(Calendar.DATE, day);
            String dateString = ReminderOpenings.isoDate(date.getTimeInMillis(), date.getTimeZone());
            for (int i = 0; i < times.length(); i++) {
                long candidate = ReminderOpenings.at(dateString, times.optString(i), date.getTimeZone());
                if (candidate > now.getTimeInMillis()) next = Math.min(next, candidate);
            }
            if (next != Long.MAX_VALUE) break;
        }
        return next;
    }

    private static Intent alarmIntent(Context context, long expected) {
        return new Intent(context, AvailabilityReminderReceiver.class).setAction(ACTION).putExtra(EXPECTED_TIME, expected);
    }

    private static void retry(Context context) {
        setAlarm(context, System.currentTimeMillis() + 30 * 60_000L, 0);
    }

    private static void setAlarm(Context context, long timestamp, long expected) {
        PendingIntent pending = PendingIntent.getBroadcast(context, REQUEST_ID, alarmIntent(context, expected),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        setReminderAlarm(context, timestamp, pending);
    }

    static void setReminderAlarm(Context context, long timestamp, PendingIntent pending) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestamp, pending);
                return;
            } catch (SecurityException permissionChanged) {
                // Exact-alarm access can change between the check and the call.
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestamp, pending);
    }

    private static boolean shouldCheck(JSONObject settings, long expected, Calendar now) {
        if (expected <= 0 || expected > now.getTimeInMillis()) return false;
        String date = ReminderOpenings.isoDate(now.getTimeInMillis(), now.getTimeZone());
        if (!date.equals(ReminderOpenings.isoDate(expected, now.getTimeZone()))) return false;
        return containsTime(settings.optJSONArray("reminderTimes"), clock(expected, now));
    }

    private static boolean containsTime(JSONArray times, String time) {
        if (times != null) for (int i = 0; i < times.length(); i++) {
            if (time.equals(times.optString(i))) return true;
        }
        return false;
    }

    private static String clock(long timestamp, Calendar local) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.ROOT);
        format.setTimeZone(local.getTimeZone());
        return format.format(new Date(timestamp));
    }

    private static void checkAndNotify(Context context, JSONObject records, JSONObject settings,
                                      ReminderOpenings.WorkingDay day, Calendar now, long expected) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 24 && !notifications.areNotificationsEnabled()) return;
        long from = ReminderOpenings.at(day.date(), "00:00", now.getTimeZone());
        Calendar after = Calendar.getInstance(now.getTimeZone());
        after.setTimeInMillis(from);
        after.add(Calendar.DATE, 1);
        int longest = ReminderOpenings.longestOpening(records, day,
            AkiSyncCalendarPlugin.readForReminder(context, from, after.getTimeInMillis()), now.getTimeZone());
        if (longest < settings.optInt("minimumMinutes", 30)) return;

        String stamp = ReminderOpenings.isoDate(expected, now.getTimeZone()) + ' ' + clock(expected, now);
        SharedPreferences preferences = preferences(context);
        if (stamp.equals(preferences.getString("lastAvailabilityReminder", null))) return;
        if (Build.VERSION.SDK_INT >= 26) {
            notifications.createNotificationChannel(new NotificationChannel(CHANNEL,
                context.getString(R.string.availability_reminder_title), NotificationManager.IMPORTANCE_DEFAULT));
        }
        PendingIntent open = PendingIntent.getActivity(context, REQUEST_ID,
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        SimpleDateFormat dayLabel = new SimpleDateFormat("EEEE, d MMMM", Locale.getDefault());
        dayLabel.setTimeZone(now.getTimeZone());
        notifications.notify(REQUEST_ID, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(R.string.availability_reminder_title))
            .setContentText(context.getString(R.string.availability_reminder_text, longest, dayLabel.format(new Date(from))))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build());
        preferences.edit().putString("lastAvailabilityReminder", stamp).apply();
    }
}
