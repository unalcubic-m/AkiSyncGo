package com.akisync.offline;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

final class ReminderOpenings {
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");
    private static final long MINUTE = 60_000L;
    private static final long DAY = 1440 * MINUTE;

    record Interval(long start, long end) {}
    record WorkingDay(String date, List<JSONObject> hours) {}

    static WorkingDay nextWorkingDay(JSONObject records, Calendar today) {
        Calendar cursor = (Calendar) today.clone();
        cursor.set(Calendar.HOUR_OF_DAY, 12);
        cursor.add(Calendar.DATE, 1);
        List<JSONObject> recurring = objects(records, "workingHours");
        List<JSONObject> overrides = objects(records, "hoursOverrides");
        List<JSONObject> daysOff = objects(records, "timeOff");
        if (recurring.isEmpty()) {
            String date = isoDate(cursor.getTimeInMillis(), cursor.getTimeZone());
            WorkingDay next = null;
            for (JSONObject override : overrides) {
                String day = override.optString("date");
                if (day.compareTo(date) < 0 || (next != null && day.compareTo(next.date()) >= 0)
                    || closedThrough(daysOff, day) != null) continue;
                List<JSONObject> hours = objects(override, "windows");
                if (!hours.isEmpty()) next = new WorkingDay(day, hours);
            }
            return next;
        }
        while (cursor.get(Calendar.YEAR) < 10000) {
            String date = isoDate(cursor.getTimeInMillis(), cursor.getTimeZone());
            String closed = closedThrough(daysOff, date);
            if (closed != null) {
                cursor.setTimeInMillis(at(closed, "12:00", cursor.getTimeZone()));
                cursor.add(Calendar.DATE, 1);
                continue;
            }
            List<JSONObject> hours = workingHours(recurring, overrides, date, cursor.get(Calendar.DAY_OF_WEEK) - 1);
            if (!hours.isEmpty()) return new WorkingDay(date, hours);
            cursor.add(Calendar.DATE, 1);
        }
        return null;
    }

    private static List<JSONObject> workingHours(List<JSONObject> recurring, List<JSONObject> overrides, String date, int weekday) {
        for (JSONObject override : overrides) {
            if (date.equals(override.optString("date"))) return objects(override, "windows");
        }
        List<JSONObject> hours = new ArrayList<>();
        for (JSONObject item : recurring) if (item.optInt("day", -1) == weekday) hours.add(item);
        return hours;
    }

    static int longestOpening(JSONObject records, WorkingDay day, JSONArray calendar, TimeZone timezone) {
        String date = day.date();
        List<Interval> busy = new ArrayList<>();
        for (JSONObject item : objects(records, "appointments")) {
            String status = item.optString("status");
            if (date.equals(item.optString("date")) && ("Scheduled".equals(status) || "Completed".equals(status) || "Blocked time".equals(status))) {
                busy.add(interval(item, date, timezone));
            }
        }
        for (JSONObject item : objects(records, "timeOff")) {
            JSONObject hours = item.optJSONObject("hours");
            if (hours != null && covers(item, date)) busy.add(interval(hours, date, timezone));
        }
        for (JSONObject rule : objects(records, "breaks")) {
            boolean replaced = false;
            for (JSONObject change : objects(rule, "changes")) {
                String original = change.optString("date");
                if (date.equals(original)) replaced = true;
                JSONObject replacement = change.optJSONObject("replacement");
                if (replacement != null && date.equals(replacement.optString("date")) && occurs(rule, original)) {
                    busy.add(interval(replacement, date, timezone));
                }
            }
            JSONObject hours = rule.optJSONObject("hours");
            if (!replaced && hours != null && occurs(rule, date)) busy.add(interval(hours, date, timezone));
        }
        for (int index = 0; index < calendar.length(); index++) {
            JSONObject event = calendar.optJSONObject(index);
            if (event == null || event.optBoolean("ignored")) continue;
            long start = event.optLong("begin");
            long end = event.optLong("end");
            if (event.optBoolean("allDay")) {
                start = at(isoDate(start, UTC), "00:00", timezone);
                end = at(isoDate(end, UTC), "00:00", timezone);
            }
            if (end > start) busy.add(new Interval(start, end));
        }
        Collections.sort(busy, (first, second) -> Long.compare(first.start(), second.start()));
        int longest = 0;
        for (JSONObject hours : day.hours()) {
            Interval window = interval(hours, date, timezone);
            long cursor = window.start();
            for (Interval block : busy) {
                if (cursor >= window.end()) break;
                longest = Math.max(longest, wholeMinutes(cursor, Math.min(block.start(), window.end()), timezone));
                cursor = Math.max(cursor, block.end());
            }
            longest = Math.max(longest, wholeMinutes(cursor, window.end(), timezone));
        }
        return longest;
    }

    static long at(String date, String time, TimeZone timezone) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT);
        format.setTimeZone(timezone);
        try {
            return format.parse(date + " " + time).getTime();
        } catch (ParseException invalid) {
            throw new IllegalArgumentException("Invalid reminder date", invalid);
        }
    }

    static String isoDate(long timestamp, TimeZone timezone) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setTimeZone(timezone);
        return format.format(timestamp);
    }

    private static Interval interval(JSONObject value, String date, TimeZone timezone) {
        return new Interval(at(date, value.optString("start"), timezone), at(date, value.optString("end"), timezone));
    }

    private static long floorMinute(long timestamp) {
        long remainder = timestamp % MINUTE;
        return timestamp - (remainder < 0 ? remainder + MINUTE : remainder);
    }

    private static int wholeMinutes(long start, long end, TimeZone timezone) {
        if (end <= start) return 0;
        long roundedStart = floorMinute(start + MINUTE - 1);
        long roundedEnd = floorMinute(end);
        long elapsed = roundedEnd - roundedStart;
        long wallClock = elapsed + timezone.getOffset(roundedEnd) - timezone.getOffset(roundedStart);
        return (int) (Math.max(0, Math.min(elapsed, wallClock)) / MINUTE);
    }

    private static boolean occurs(JSONObject rule, String date) {
        String from = rule.optString("from");
        JSONObject repeat = rule.optJSONObject("repeat");
        if (repeat == null) return from.equals(date);
        if (date.compareTo(from) < 0) return false;
        long first = at(from, "00:00", UTC);
        long elapsed = (at(date, "00:00", UTC) - first) / DAY;
        Calendar start = Calendar.getInstance(UTC);
        start.setTimeInMillis(first);
        int firstDay = start.get(Calendar.DAY_OF_WEEK) - 1;
        JSONArray days = repeat.optJSONArray("weekdays");
        boolean[] weekdays = new boolean[7];
        if (days == null) return false;
        for (int i = 0; i < days.length(); i++) {
            int which = days.optInt(i, -1);
            if (which >= 0 && which < 7) weekdays[which] = true;
        }
        int offset = (int) (elapsed % 7);
        if (!weekdays[(firstDay + offset) % 7]) return false;
        JSONObject end = repeat.optJSONObject("end");
        if (end == null || "never".equals(end.optString("type"))) return true;
        if ("date".equals(end.optString("type"))) return date.compareTo(end.optString("through")) <= 0;
        long count = elapsed / 7 * days.length();
        for (int i = 0; i <= offset; i++) if (weekdays[(firstDay + i) % 7]) count++;
        return count <= end.optLong("count");
    }

    private static String closedThrough(List<JSONObject> daysOff, String date) {
        String through = null;
        for (JSONObject item : daysOff) {
            if (!item.isNull("hours") || !covers(item, date)) continue;
            String candidate = item.optString("through");
            if (through == null || candidate.compareTo(through) > 0) through = candidate;
        }
        return through;
    }

    private static boolean covers(JSONObject item, String date) {
        return item.optString("from").compareTo(date) <= 0 && item.optString("through").compareTo(date) >= 0;
    }

    private static List<JSONObject> objects(JSONObject source, String field) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray values = source.optJSONArray(field);
        if (values != null) for (int index = 0; index < values.length(); index++) {
            JSONObject item = values.optJSONObject(index);
            if (item != null) result.add(item);
        }
        return result;
    }
}
