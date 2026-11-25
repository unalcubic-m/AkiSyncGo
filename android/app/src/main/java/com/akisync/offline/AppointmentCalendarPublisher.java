package com.akisync.offline;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.text.TextUtils;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;

final class AppointmentCalendarPublisher {
    private static final String GOOGLE = "com.google";
    private static final String DESTINATION = "calendarPublishingDestination";
    private static final String ENABLED = "calendarPublishingEnabled";
    private static final String EXCLUDED = "calendarPublishingExclusions";
    private static final String SECRET = "calendarPublishingSecret";
    private static final String REFERENCES = "calendarPublishingEvents:";
    private static final String URI_PREFIX = "akisync://published/";
    private static final String[] CALENDAR_COLUMNS = {
        Calendars._ID, Calendars.ACCOUNT_NAME, Calendars.CALENDAR_DISPLAY_NAME,
        Calendars._SYNC_ID, Calendars.NAME, Calendars.SYNC_EVENTS, Calendars.CALENDAR_ACCESS_LEVEL,
    };
    private static final String[] EVENT_COLUMNS = {
        Events._ID, Events.DTSTART, Events.DTEND, Events.TITLE, Events.EVENT_TIMEZONE,
        Events.EVENT_END_TIMEZONE, Events.UID_2445, Events.CUSTOM_APP_URI, Events._SYNC_ID,
    };

    record Calendar(long id, String account, String name, String key) {
        String identity() {
            return new JSONArray().put(account).put(key).toString();
        }

        JSObject json() {
            return new JSObject().put("id", Long.toString(id)).put("account", account).put("name", name).put("key", key);
        }
    }

    private record DeviceCalendar(Calendar calendar, boolean writable) {}
    record Visit(String id, String title, long start, long end) {}
    private record Reference(long id, String marker, String syncId, long start) {}
    private record Published(Reference reference, String title, long end, String zone, String endZone) {}
    static final class OwnershipUnavailable extends RuntimeException {}

    private final ContentResolver resolver;
    private final SharedPreferences preferences;

    AppointmentCalendarPublisher(ContentResolver resolver, SharedPreferences preferences) {
        this.resolver = resolver;
        this.preferences = preferences;
    }

    synchronized JSObject settings() {
        JSObject result = new JSObject().put("enabled", preferences.getBoolean(ENABLED, false));
        Calendar destination = savedDestination();
        return destination == null ? result : result.put("calendar", destination.json());
    }

    synchronized List<Calendar> writableCalendars() {
        List<Calendar> writable = new ArrayList<>();
        for (DeviceCalendar row : googleCalendars()) {
            if (row.writable()) writable.add(row.calendar());
        }
        return writable;
    }

    synchronized boolean configure(boolean enabled, String id, String account, String key) {
        if (!enabled) {
            commit(preferences.edit().putBoolean(ENABLED, false));
            return true;
        }
        Calendar selection = null;
        if (id == null) {
            selection = currentDestination();
        } else {
            for (Calendar row : writableCalendars()) {
                if (Long.toString(row.id()).equals(id) && row.account().equals(account) && row.key().equals(key)) {
                    selection = row;
                    break;
                }
            }
        }
        if (selection == null) return false;
        Set<String> exclusions = new HashSet<>(preferences.getStringSet(EXCLUDED, Collections.emptySet()));
        exclusions.add(selection.identity());
        commit(preferences.edit().putBoolean(ENABLED, true).putString(DESTINATION, selection.json().toString())
            .putStringSet(EXCLUDED, exclusions));
        return true;
    }

    synchronized Set<Long> excludedCalendarIds() {
        Set<String> identities = preferences.getStringSet(EXCLUDED, Collections.emptySet());
        Set<Long> excluded = new HashSet<>();
        if (!identities.isEmpty()) {
            for (DeviceCalendar row : googleCalendars()) {
                if (identities.contains(row.calendar().identity())) excluded.add(row.calendar().id());
            }
        }
        return excluded;
    }

    synchronized Calendar currentDestination() {
        Calendar saved = savedDestination();
        if (saved == null) return null;
        Calendar match = null;
        for (Calendar row : writableCalendars()) {
            if (!row.identity().equals(saved.identity())) continue;
            if (row.id() == saved.id()) return row;
            if (match != null) return null;
            match = row;
        }
        return match;
    }

    synchronized boolean isEnabled() {
        return preferences.getBoolean(ENABLED, false);
    }

    /** Reconcile only AkiSync rows inside the same date window as the saved visits. */
    synchronized void publish(Calendar destination, List<Visit> visits, long cutoff, String zone) {
        String secret = preferences.getString(SECRET, null);
        if (secret == null) {
            secret = UUID.randomUUID().toString();
            commit(preferences.edit().putString(SECRET, secret));
        }
        String prefix = "akisync." + uuid("publisher:" + secret) + ".";
        Map<String, Visit> desired = new LinkedHashMap<>();
        for (Visit visit : visits) {
            if (visit.start() < cutoff || visit.end() <= visit.start()) throw new IllegalArgumentException();
            String key = uuid(secret + ":" + visit.id()).toString();
            if (desired.put(key, visit) != null) throw new IllegalArgumentException();
        }

        String referenceKey = REFERENCES + destination.identity();
        List<Reference> previous = savedReferences(referenceKey, cutoff);
        List<Published> published = readPublished(destination.id(), cutoff, prefix, previous);
        List<Reference> retained = new ArrayList<>();
        for (Published event : published) {
            Reference reference = event.reference();
            String key = reference.marker().substring(prefix.length(), prefix.length() + 36);
            Visit visit = desired.remove(key);
            String[] match = {
                Long.toString(reference.id()), Long.toString(destination.id()), Long.toString(cutoff),
                reference.marker(), URI_PREFIX + reference.marker(), reference.syncId() == null ? "" : reference.syncId(),
            };
            String selection = Events._ID + "=? AND " + Events.CALENDAR_ID + "=? AND " + Events.DTSTART
                + ">=? AND " + Events.DELETED + "=0 AND (" + Events.UID_2445 + "=? OR "
                + Events.CUSTOM_APP_URI + "=? OR (length(" + Events._SYNC_ID + ")>0 AND " + Events._SYNC_ID + "=?))";
            if (visit == null) {
                if (resolver.delete(Events.CONTENT_URI, selection, match) != 1) throw new IllegalStateException();
                continue;
            }
            if (reference.start() != visit.start() || event.end() != visit.end() || !visit.title().equals(event.title())
                || !zone.equals(event.zone()) || !zone.equals(event.endZone())) {
                if (resolver.update(Events.CONTENT_URI, details(visit, zone), selection, match) != 1) {
                    throw new IllegalStateException();
                }
            }
            retained.add(new Reference(reference.id(), reference.marker(), reference.syncId(), visit.start()));
        }
        for (Map.Entry<String, Visit> entry : desired.entrySet()) {
            Visit visit = entry.getValue();
            // A fresh UID allows a visit moved back into the window to coexist with its archived copy.
            String marker = prefix + entry.getKey() + "." + UUID.randomUUID() + "@akisync.local";
            ContentValues values = details(visit, zone);
            values.put(Events.CALENDAR_ID, destination.id());
            // The marker is written in the same provider operation as the event.
            values.put(Events.UID_2445, marker);
            values.put(Events.CUSTOM_APP_URI, URI_PREFIX + marker);
            var inserted = resolver.insert(Events.CONTENT_URI, values);
            if (inserted == null) throw new IllegalStateException();
            retained.add(new Reference(Long.parseLong(inserted.getLastPathSegment()), marker, null, visit.start()));
        }
        JSONArray refs = new JSONArray();
        for (Reference ref : retained) {
            refs.put(new JSONArray().put(ref.id()).put(ref.marker()).put(ref.syncId()).put(ref.start()));
        }
        SharedPreferences.Editor editor = preferences.edit();
        if (!refs.toString().equals(preferences.getString(referenceKey, "[]"))) editor.putString(referenceKey, refs.toString());
        if (!destination.equals(savedDestination())) editor.putString(DESTINATION, destination.json().toString());
        commit(editor);
    }

    private List<Published> readPublished(long calendar, long cutoff, String prefix, List<Reference> previous) {
        Set<Long> trackedIds = new HashSet<>();
        Map<String, String> syncedMarkers = new HashMap<>();
        for (Reference ref : previous) {
            trackedIds.add(ref.id());
            if (ref.syncId() != null) syncedMarkers.put(ref.syncId(), ref.marker());
        }
        List<Published> events = new ArrayList<>();
        String selection = Events.CALENDAR_ID + "=? AND " + Events.DTSTART + ">=? AND " + Events.DELETED + "=0";
        try (Cursor rows = resolver.query(Events.CONTENT_URI, EVENT_COLUMNS, selection,
            new String[] { Long.toString(calendar), Long.toString(cutoff) }, Events._ID)) {
            if (rows == null) throw new IllegalStateException();
            while (rows.moveToNext()) {
                long id = rows.getLong(0);
                String uri = rows.getString(7);
                String syncId = rows.getString(8);
                String marker = rows.getString(6);
                if (!isMarker(marker, prefix)) marker = uri != null && uri.startsWith(URI_PREFIX) ? uri.substring(URI_PREFIX.length()) : null;
                if (!isMarker(marker, prefix)) marker = syncedMarkers.get(syncId);
                if (!isMarker(marker, prefix)) {
                    if (trackedIds.contains(id)) throw new OwnershipUnavailable();
                    continue;
                }
                Reference ref = new Reference(id, marker, TextUtils.isEmpty(syncId) ? null : syncId, rows.getLong(1));
                String zone = rows.getString(4);
                String endZone = rows.getString(5);
                events.add(new Published(ref, rows.getString(3), rows.getLong(2), zone, TextUtils.isEmpty(endZone) ? zone : endZone));
            }
        }
        return events;
    }

    private static boolean isMarker(String marker, String prefix) {
        return marker != null && marker.startsWith(prefix) && marker.endsWith("@akisync.local")
            && marker.length() == prefix.length() + 36 + 1 + 36 + "@akisync.local".length();
    }

    private List<Reference> savedReferences(String key, long cutoff) {
        try {
            JSONArray array = new JSONArray(preferences.getString(key, "[]"));
            List<Reference> references = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                JSONArray row = array.getJSONArray(i);
                if (row.getLong(3) >= cutoff) {
                    references.add(new Reference(row.getLong(0), row.getString(1), row.isNull(2) ? null : row.getString(2), row.getLong(3)));
                }
            }
            return references;
        } catch (JSONException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private Calendar savedDestination() {
        String stored = preferences.getString(DESTINATION, null);
        if (stored == null) return null;
        try {
            JSObject data = new JSObject(stored);
            return new Calendar(Long.parseLong(data.getString("id")), data.getString("account"), data.getString("name"), data.getString("key"));
        } catch (JSONException | NumberFormatException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private List<DeviceCalendar> googleCalendars() {
        List<DeviceCalendar> calendars = new ArrayList<>();
        try (Cursor rows = resolver.query(Calendars.CONTENT_URI, CALENDAR_COLUMNS, Calendars.ACCOUNT_TYPE + "=?",
            new String[] { GOOGLE }, Calendars.DEFAULT_SORT_ORDER)) {
            if (rows == null) throw new IllegalStateException();
            while (rows.moveToNext()) {
                String account = rows.getString(1);
                String providerName = rows.getString(4);
                String syncId = rows.getString(3);
                if (TextUtils.isEmpty(account) || (TextUtils.isEmpty(syncId) && TextUtils.isEmpty(providerName))) continue;
                String key = TextUtils.isEmpty(syncId) ? "name:" + providerName : "sync:" + syncId;
                String name = rows.getString(2);
                Calendar calendar = new Calendar(rows.getLong(0), account, TextUtils.isEmpty(name) ? account : name, key);
                calendars.add(new DeviceCalendar(calendar, rows.getInt(5) == 1 && rows.getInt(6) >= Calendars.CAL_ACCESS_CONTRIBUTOR));
            }
        }
        return calendars;
    }

    private static ContentValues details(Visit visit, String zone) {
        ContentValues values = new ContentValues();
        values.put(Events.TITLE, visit.title());
        values.put(Events.DTSTART, visit.start());
        values.put(Events.DTEND, visit.end());
        values.put(Events.EVENT_TIMEZONE, zone);
        values.put(Events.EVENT_END_TIMEZONE, zone);
        return values;
    }

    private static UUID uuid(String value) {
        return UUID.nameUUIDFromBytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private static void commit(SharedPreferences.Editor editor) {
        if (!editor.commit()) throw new IllegalStateException("Could not save calendar publishing settings.");
    }
}
