package com.akisync.offline;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Calendar;

final class DailyLabReminder {
    static final String ACTION = "com.akisync.offline.CHECK_DAILY_LAB";
    private static final String EXPECTED = "expectedDailyLabTime";
    private static final String CHANNEL = "daily-lab-check";
    private static final String LAST_DELIVERED = "lastDailyLabReminder";
    private static final String SCHEDULED_AT = "dailyLabScheduledAt";
    private static final int REQUEST_ID = 131;

    private DailyLabReminder() {}

    static long nextReminderAt(JSONArray days, String time, Calendar now, boolean skipToday) {
        for (int offset = skipToday ? 1 : 0; offset <= 7; offset++) {
            Calendar date = (Calendar) now.clone();
            date.add(Calendar.DATE, offset);
            if (!includesDay(days, date)) continue;
            long candidate = at(date, time);
            if (candidate > now.getTimeInMillis()) return candidate;
        }
        return 0;
    }

    static void update(Context context, JSONObject records, Calendar now, Intent intent) {
        JSONObject settings = records == null ? null : records.optJSONObject("dailyLabReminder");
        JSONObject check = records == null ? null : records.optJSONObject("dailyLabCheck");
        String today = date(now);
        boolean enabled = records != null && (settings == null || settings.optBoolean("enabled", true));
        boolean closed = check != null && today.equals(check.optString("date"));
        SharedPreferences preferences = context.getSharedPreferences("akisync-settings", Context.MODE_PRIVATE);
        if (!enabled || closed) context.getSystemService(NotificationManager.class).cancel(REQUEST_ID);
        if (!enabled) {
            cancelAlarm(context);
            preferences.edit().remove(SCHEDULED_AT).apply();
            return;
        }

        String time = settings == null ? "10:00" : settings.optString("time", "10:00");
        JSONArray days = settings == null ? null : settings.optJSONArray("days");
        boolean delivered = today.equals(preferences.getString(LAST_DELIVERED, null));
        // Foregrounding the app can coincide with a delayed Android alarm. Honor the scheduled time once.
        long expected = intent != null && ACTION.equals(intent.getAction())
            ? intent.getLongExtra(EXPECTED, 0) : preferences.getLong(SCHEDULED_AT, 0);
        if (!closed && !delivered && expected == at(now, time) && expected <= now.getTimeInMillis()
            && includesDay(days, now) && send(context)) {
            preferences.edit().putString(LAST_DELIVERED, today).apply();
            delivered = true;
        }
        long next = nextReminderAt(days, time, now, closed || delivered);
        schedule(context, next);
        preferences.edit().putLong(SCHEDULED_AT, next).apply();
    }

    static void retry(Context context, Intent intent) {
        long expected = intent.getLongExtra(EXPECTED, 0);
        setAlarm(context, System.currentTimeMillis() + 30 * 60_000L, expected);
    }

    private static boolean includesDay(JSONArray days, Calendar calendar) {
        if (days == null) return true;
        int weekday = calendar.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
        for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == weekday) return true;
        return false;
    }

    private static String date(Calendar calendar) {
        return ReminderOpenings.isoDate(calendar.getTimeInMillis(), calendar.getTimeZone());
    }

    private static long at(Calendar day, String time) {
        return ReminderOpenings.at(date(day), time, day.getTimeZone());
    }

    private static Intent alarmIntent(Context context, long expected) {
        return new Intent(context, AvailabilityReminderReceiver.class).setAction(ACTION).putExtra(EXPECTED, expected);
    }

    private static void cancelAlarm(Context context) {
        PendingIntent previous = PendingIntent.getBroadcast(context, REQUEST_ID, alarmIntent(context, 0),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (previous == null) return;
        context.getSystemService(AlarmManager.class).cancel(previous);
        previous.cancel();
    }

    private static void schedule(Context context, long next) {
        if (next > 0) setAlarm(context, next, next);
        else cancelAlarm(context);
    }

    private static void setAlarm(Context context, long timestamp, long expected) {
        PendingIntent pending = PendingIntent.getBroadcast(context, REQUEST_ID, alarmIntent(context, expected),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AvailabilityReminderReceiver.setReminderAlarm(context, timestamp, pending);
    }

    private static boolean send(Context context) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 24 && !notifications.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            notifications.createNotificationChannel(new NotificationChannel(CHANNEL,
                context.getString(R.string.daily_lab_reminder_title), NotificationManager.IMPORTANCE_DEFAULT));
            if (notifications.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("akisync://daily-lab"), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(context, REQUEST_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        notifications.notify(REQUEST_ID, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(R.string.daily_lab_reminder_title))
            .setContentText(context.getString(R.string.daily_lab_reminder_text))
            .setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
        return true;
    }
}
