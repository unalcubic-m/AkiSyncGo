package com.akisync.offline;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Instances;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONException;

@CapacitorPlugin(
    name = "AkiSyncCalendar",
    permissions = {
        @Permission(alias = "calendar", strings = Manifest.permission.READ_CALENDAR),
        @Permission(alias = "publishCalendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }),
    }
)
public class AkiSyncCalendarPlugin extends Plugin {
    private static final long DAY_MS = 86_400_000L;
    private static final String IGNORED_EVENTS = "ignoredDeviceCalendarEvents";
    private static final String[] TIMING_PROJECTION = {
        Instances.EVENT_ID, Instances.BEGIN, Instances.END, Instances.ALL_DAY,
        Instances.STATUS, Instances.ORIGINAL_ID, Instances.CALENDAR_ID,
    };
    private final Handler calendarHandler = new Handler(Looper.getMainLooper());
    private final Runnable publishChange = () -> notifyListeners("calendarChanged", new JSObject());
    private final ContentObserver calendarObserver = new ContentObserver(calendarHandler) {
        @Override
        public void onChange(boolean selfChange) {
            calendarHandler.removeCallbacks(publishChange);
            calendarHandler.postDelayed(publishChange, 200);
        }
    };
    private boolean observing;
    private AppointmentCalendarPublisher publisher;

    @Override
    public void load() {
        publisher = new AppointmentCalendarPublisher(getContext().getContentResolver(), preferences());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        SharedPreferences preferences = preferences();
        PermissionState permission = getPermissionState("calendar");
        boolean automatic = Boolean.TRUE.equals(call.getBoolean("automatic"));
        if (permission == PermissionState.GRANTED
            || (automatic && (permission != PermissionState.PROMPT || preferences.getBoolean("calendarPermissionAsked", false)))) {
            accessResult(call);
        } else {
            preferences.edit().putBoolean("calendarPermissionAsked", true).apply();
            requestPermissionForAlias("calendar", call, "accessResult");
        }
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) calendarHandler.post(this::observeCalendar);
        call.resolve(new JSObject().put("access", calendarAccess()));
    }

    @PluginMethod
    public void publishingSettings(PluginCall call) {
        try {
            call.resolve(publisher.settings());
        } catch (RuntimeException unavailable) {
            call.reject("Could not open calendar publishing settings.");
        }
    }

    @PluginMethod
    public void publishingCalendars(PluginCall call) {
        if (canPublish()) publishingCalendarResult(call);
        else requestPermissionForAlias("publishCalendar", call, "publishingCalendarResult");
    }

    @PermissionCallback
    private void publishingCalendarResult(PluginCall call) {
        if (!canPublish()) {
            call.resolve(publishingStatus("permission"));
            return;
        }
        try {
            JSArray calendars = new JSArray();
            for (AppointmentCalendarPublisher.Calendar calendar : publisher.writableCalendars()) calendars.put(calendar.json());
            call.resolve(new JSObject().put("calendars", calendars));
        } catch (SecurityException denied) {
            call.resolve(publishingStatus("permission"));
        } catch (RuntimeException unavailable) {
            call.resolve(publishingStatus("error"));
        }
    }

    @PluginMethod
    public void configurePublishing(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        if (enabled && !canPublish()) {
            call.resolve(publishingStatus("permission"));
            return;
        }
        try {
            if (!publisher.configure(enabled, call.getString("calendarId"), call.getString("account"), call.getString("key"))) {
                call.resolve(publishingStatus("unavailable"));
                return;
            }
            calendarHandler.post(publishChange);
            call.resolve(publisher.settings());
        } catch (SecurityException denied) {
            call.resolve(publishingStatus("permission"));
        } catch (RuntimeException unavailable) {
            call.resolve(publishingStatus("error"));
        }
    }

    @PluginMethod
    public void publishAppointments(PluginCall call) {
        synchronized (publisher) {
            if (!publisher.isEnabled()) {
                call.resolve(publishingStatus("paused"));
                return;
            }
            if (!canPublish()) {
                call.resolve(publishingStatus("permission"));
                return;
            }
            try {
                AppointmentCalendarPublisher.Calendar calendar = publisher.currentDestination();
                if (calendar == null) {
                    call.resolve(publishingStatus("unavailable"));
                    return;
                }
                Long cutoff = call.getLong("cutoff");
                String zone = call.getString("zone");
                JSArray items = call.getArray("visits");
                if (cutoff == null || TextUtils.isEmpty(zone) || items == null) throw new IllegalArgumentException();
                List<AppointmentCalendarPublisher.Visit> visits = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                    var item = items.getJSONObject(i);
                    visits.add(new AppointmentCalendarPublisher.Visit(item.getString("id"), item.getString("title"),
                        item.getLong("start"), item.getLong("end")));
                }
                publisher.publish(calendar, visits, cutoff, zone);
                call.resolve(publishingStatus("saved").put("calendar", calendar.json()));
            } catch (AppointmentCalendarPublisher.OwnershipUnavailable unavailable) {
                call.resolve(publishingStatus("ownership"));
            } catch (SecurityException denied) {
                call.resolve(publishingStatus("permission"));
            } catch (RuntimeException | JSONException unavailable) {
                call.resolve(publishingStatus("error"));
            }
        }
    }

    @PluginMethod
    public void configureUnavailability(PluginCall call) {
        try {
            JSObject options = call.getObject("preferences");
            if (options == null) throw new IllegalArgumentException();
            publisher.configureUnavailability(AppointmentCalendarPublisher.UnavailabilityPreferences.parse(options));
            call.resolve(publisher.settings());
        } catch (RuntimeException | JSONException failure) {
            call.reject("Could not save calendar publishing settings.");
        }
    }

    @PluginMethod
    public void publishUnavailability(PluginCall call) {
        synchronized (publisher) {
            if (!publisher.isEnabled()) {
                call.resolve(publishingStatus("paused"));
                return;
            }
            if (!canPublish()) {
                call.resolve(publishingStatus("permission"));
                return;
            }
            try {
                var calendar = publisher.currentDestination();
                if (calendar == null) {
                    call.resolve(publishingStatus("unavailable"));
                    return;
                }
                JSObject destination = call.getObject("destination");
                JSObject options = call.getObject("preferences");
                if (destination == null || options == null) throw new IllegalArgumentException();
                if (!calendar.account().equals(destination.getString("account")) || !calendar.key().equals(destination.getString("key"))
                    || !publisher.unavailabilityPreferences().equals(AppointmentCalendarPublisher.UnavailabilityPreferences.parse(options))) {
                    // A read started before publishing preferences or the destination changed.
                    call.resolve(publishingStatus("stale"));
                    return;
                }
                Long cutoff = call.getLong("cutoff");
                Long allDayCutoff = call.getLong("allDayCutoff");
                String zone = call.getString("zone");
                String title = call.getString("title");
                JSArray items = call.getArray("blocks");
                if (cutoff == null || allDayCutoff == null || TextUtils.isEmpty(zone) || items == null
                    || !("Unavailable for appointments".equals(title) || "Randevuya Kapalı".equals(title))) throw new IllegalArgumentException();
                List<AppointmentCalendarPublisher.Unavailability> blocks = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                    var item = items.getJSONObject(i);
                    blocks.add(new AppointmentCalendarPublisher.Unavailability(item.getLong("start"), item.getLong("end"),
                        item.getBoolean("allDay")));
                }
                publisher.publishUnavailability(calendar, blocks, cutoff, allDayCutoff, zone, title);
                call.resolve(publishingStatus("saved"));
            } catch (AppointmentCalendarPublisher.OwnershipUnavailable unavailable) {
                call.resolve(publishingStatus("ownership"));
            } catch (SecurityException denied) {
                call.resolve(publishingStatus("permission"));
            } catch (RuntimeException | JSONException unavailable) {
                call.resolve(publishingStatus("error"));
            }
        }
    }

    private boolean canPublish() {
        return getPermissionState("publishCalendar") == PermissionState.GRANTED;
    }

    private static JSObject publishingStatus(String status) {
        return new JSObject().put("status", status);
    }

    @PluginMethod
    public void events(PluginCall call) {
        String access = calendarAccess();
        JSObject result = new JSObject().put("access", access);
        if (!"granted".equals(access)) {
            call.resolve(result);
            return;
        }
        calendarHandler.post(this::observeCalendar);
        Long from = call.getLong("from");
        Long until = call.getLong("until");
        if (from == null || until == null || until <= from || until - from > 136 * DAY_MS) {
            call.reject("Invalid calendar date range.");
            return;
        }
        try {
            call.resolve(result.put("events", readInstances(getContext().getContentResolver(), from, until,
                publisher.excludedCalendarIds(), ignoredEvents(), Boolean.TRUE.equals(call.getBoolean("anonymous")))));
        } catch (SecurityException denied) {
            call.resolve(new JSObject().put("access", "denied"));
        } catch (RuntimeException unavailable) {
            call.reject("Could not read device calendars.");
        }
    }

    static JSArray readInstances(ContentResolver resolver, long from, long until, Set<Long> excluded, Set<String> ignored) {
        return readInstances(resolver, from, until, excluded, ignored, false);
    }

    static JSArray readInstances(ContentResolver resolver, long from, long until, Set<Long> excluded, Set<String> ignored, boolean anonymous) {
        JSArray events = new JSArray();
        List<String> projection = new ArrayList<>();
        Collections.addAll(projection, TIMING_PROJECTION);
        if (!anonymous) Collections.addAll(projection, Instances.TITLE, Instances.CALENDAR_DISPLAY_NAME);
        // Android stores all-day dates at midnight UTC. Query the bordering days as well.
        try (Cursor cursor = Instances.query(resolver, projection.toArray(new String[0]), from - DAY_MS, until + DAY_MS)) {
            if (cursor == null) throw new IllegalStateException();
            while (cursor.moveToNext()) {
                if (excluded.contains(cursor.getLong(6))) continue;
                long begin = cursor.getLong(1);
                long end = cursor.getLong(2);
                if (end <= begin || cursor.getInt(4) == Events.STATUS_CANCELED) continue;
                long rowId = cursor.getLong(0);
                long originalId = cursor.getLong(5);
                String eventId = Long.toString(originalId > 0 ? originalId : rowId);
                JSObject event = new JSObject().put("ignored", ignored.contains(eventId))
                    .put("begin", begin).put("end", end).put("allDay", cursor.getInt(3) == 1);
                if (!anonymous) {
                    event.put("id", rowId + ":" + begin + ":" + end).put("eventId", eventId)
                        .put("title", cursor.isNull(7) ? "" : cursor.getString(7))
                        .put("calendar", cursor.isNull(8) ? "" : cursor.getString(8));
                }
                events.put(event);
            }
        }
        return events;
    }

    static JSArray readForReminder(Context context, long from, long until) {
        if (context.checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) return new JSArray();
        SharedPreferences preferences = context.getSharedPreferences("akisync-settings", 0);
        ContentResolver resolver = context.getContentResolver();
        return readInstances(resolver, from, until, new AppointmentCalendarPublisher(resolver, preferences).excludedCalendarIds(),
            preferences.getStringSet(IGNORED_EVENTS, Collections.emptySet()));
    }

    @PluginMethod
    public void setEventIgnored(PluginCall call) {
        String id = call.getString("eventId");
        Boolean ignored = call.getBoolean("ignored");
        if (!validEventId(id) || ignored == null) {
            call.reject("Invalid calendar event.");
            return;
        }
        Set<String> events = ignoredEvents();
        if (ignored) events.add(id);
        else events.remove(id);
        if (preferences().edit().putStringSet(IGNORED_EVENTS, events).commit()) call.resolve();
        else call.reject("Could not save the calendar event preference.");
    }

    @PluginMethod
    public void ignoredEventDetails(PluginCall call) {
        Set<String> ignored = ignoredEvents();
        JSArray ignoredIds = new JSArray();
        ignored.forEach(ignoredIds::put);
        Set<String> lookupIds = new LinkedHashSet<>(ignored);
        JSArray requested = call.getArray("eventIds");
        if (requested != null) {
            for (int i = 0; i < requested.length(); i++) {
                String id = requested.optString(i);
                if (validEventId(id)) lookupIds.add(id);
            }
        }
        JSArray details = new JSArray();
        boolean detailsAvailable = getPermissionState("calendar") == PermissionState.GRANTED;
        if (detailsAvailable) {
            List<String> ids = new ArrayList<>(lookupIds);
            try {
                Set<Long> excluded = publisher.excludedCalendarIds();
                for (int i = 0; i < ids.size(); i += 200) {
                    appendEventDetails(details, ids.subList(i, Math.min(ids.size(), i + 200)), excluded);
                }
            } catch (RuntimeException unavailable) {
                detailsAvailable = false;
            }
        }
        call.resolve(new JSObject().put("ignored", ignoredIds).put("details", details).put("detailsAvailable", detailsAvailable));
    }

    private void appendEventDetails(JSArray details, List<String> ids, Set<Long> excluded) {
        String[] projection = { Events._ID, Events.TITLE, Events.CALENDAR_DISPLAY_NAME, Events.CALENDAR_ID };
        String selection = Events.DELETED + " = 0 AND " + Events._ID + " IN (" + TextUtils.join(",", Collections.nCopies(ids.size(), "?")) + ")";
        try (Cursor cursor = getContext().getContentResolver().query(Events.CONTENT_URI, projection, selection, ids.toArray(new String[0]), null)) {
            if (cursor == null) throw new IllegalStateException("Device calendar provider unavailable.");
            while (cursor.moveToNext()) {
                if (excluded.contains(cursor.getLong(3))) continue;
                details.put(new JSObject().put("eventId", cursor.getString(0))
                    .put("title", cursor.isNull(1) ? "" : cursor.getString(1))
                    .put("calendar", cursor.isNull(2) ? "" : cursor.getString(2)));
            }
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("akisync-settings", 0);
    }

    private Set<String> ignoredEvents() {
        return new LinkedHashSet<>(preferences().getStringSet(IGNORED_EVENTS, Collections.emptySet()));
    }

    private static boolean validEventId(String id) {
        return id != null && id.matches("[0-9]{1,19}");
    }

    private void observeCalendar() {
        if (observing || getActivity().isDestroyed() || getPermissionState("calendar") != PermissionState.GRANTED) return;
        try {
            getContext().getContentResolver().registerContentObserver(CalendarContract.CONTENT_URI, true, calendarObserver);
            observing = true;
        } catch (IllegalArgumentException | SecurityException unavailable) {
            // Calendar queries still run when the app returns to the foreground or saves a visit.
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (observing) getContext().getContentResolver().unregisterContentObserver(calendarObserver);
        calendarHandler.removeCallbacksAndMessages(null);
    }

    private String calendarAccess() {
        return switch (getPermissionState("calendar")) {
            case GRANTED -> "granted";
            case DENIED -> "denied";
            default -> "prompt";
        };
    }
}
