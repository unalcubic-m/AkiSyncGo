package com.akisync.offline;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Colors;
import android.provider.CalendarContract.Events;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppointmentCalendarPublisherTest {
    private static final String ZONE = "Europe/Istanbul";
    private static final long DAY = 86_400_000;
    private static final long CUTOFF = 1_795_294_800_000L; // 2026-11-22 00:00 in Istanbul
    private final String account = UUID.randomUUID() + "@example.invalid";

    @Test
    public void reconcilesOnlyOwnedEventsAndKeepsTheCalendarExcludedWhenPaused() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.READ_CALENDAR);
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.WRITE_CALENDAR);
        ContentResolver resolver = context.getContentResolver();
        SharedPreferences settings = context.getSharedPreferences("calendar-publishing-test", Context.MODE_PRIVATE);
        settings.edit().clear().commit();
        long publishingId = calendar(resolver, "Fictional publishing calendar", Calendars.CAL_ACCESS_OWNER, 1);
        long otherId = calendar(resolver, "Fictional personal calendar", Calendars.CAL_ACCESS_OWNER, 1);
        long unavailableId = calendar(resolver, "Fictional unavailable calendar", Calendars.CAL_ACCESS_OWNER, 0);
        try {
            var publisher = new AppointmentCalendarPublisher(resolver, settings);
            var destination = publisher.writableCalendars().stream().filter(row -> row.id() == publishingId).findFirst().orElseThrow();
            assertFalse(publisher.writableCalendars().stream().anyMatch(row -> row.id() == unavailableId));
            assertFalse(publisher.configure(true, Long.toString(otherId), account, destination.key()));
            assertTrue(publisher.configure(true, Long.toString(destination.id()), account, destination.key()));

            long today = CUTOFF + DAY;
            FixtureEvent manual = event(resolver, publishingId, "Fictional manual event", today);
            FixtureEvent overlap = event(resolver, otherId, "Fictional overlap", today);
            var old = visit("old", "Fictional old visit", CUTOFF - DAY);
            var yesterday = visit("yesterday", "Fictional yesterday", CUTOFF);
            var booked = visit("today", "Fictional today", today);
            var future = visit("future", "Fictional distant visit", CUTOFF + 365 * 10 * DAY);
            publisher.publish(destination, List.of(old), CUTOFF - DAY, ZONE);
            publisher.publish(destination, List.of(yesterday, booked, future), CUTOFF, ZONE);
            Map<String, FixtureEvent> initial = events(resolver, publishingId);
            assertEquals(5, initial.size());
            assertEquals(old.start(), initial.get(old.title()).start());
            assertEquals(future.start(), initial.get(future.title()).start());
            assertEquals(ZONE, initial.get(yesterday.title()).zone());
            assertEquals(yesterday.end(), initial.get(yesterday.title()).end());

            // Lose the saved event references as if the app stopped after the provider committed.
            settings.edit().remove("calendarPublishingEvents:" + destination.identity()).commit();
            publisher = new AppointmentCalendarPublisher(resolver, settings);
            publisher.publish(destination, List.of(yesterday, booked, future), CUTOFF, ZONE);
            assertEquals(initial, events(resolver, publishingId));

            // The provider can later supply a server identity for the same event.
            long bookedId = initial.get(booked.title()).id();
            Uri syncedEvent = ContentUris.withAppendedId(syncAdapter(Events.CONTENT_URI), bookedId);
            ContentValues serverFields = new ContentValues();
            serverFields.put(Events._SYNC_ID, "fictional-server-id");
            assertEquals(1, resolver.update(syncedEvent, serverFields, null, null));
            publisher.publish(destination, List.of(yesterday, booked, future), CUTOFF, ZONE);
            serverFields.putNull(Events.UID_2445);
            serverFields.putNull(Events.CUSTOM_APP_URI);
            assertEquals(1, resolver.update(syncedEvent, serverFields, null, null));

            var moved = visit("today", "Fictional renamed patient", today + 3_600_000);
            publisher.publish(destination, List.of(moved, future), CUTOFF, ZONE);
            Map<String, FixtureEvent> changed = events(resolver, publishingId);
            assertFalse(changed.containsKey(yesterday.title()));
            assertFalse(changed.containsKey(booked.title()));
            assertEquals(initial.get(booked.title()).id(), changed.get(moved.title()).id());
            assertEquals(moved.start(), changed.get(moved.title()).start());
            assertEquals(initial.get(old.title()), changed.get(old.title()));
            assertEquals(manual, changed.get(manual.title()));
            assertEquals(overlap, events(resolver, otherId).get(overlap.title()));

            assertCalendarRead(publisher, resolver, today, changed.get(moved.title()).id(), overlap.id());
            assertTrue(publisher.configure(false, null, null, null));
            publisher = new AppointmentCalendarPublisher(resolver, settings);
            assertFalse(publisher.isEnabled());
            assertCalendarRead(publisher, resolver, today, changed.get(moved.title()).id(), overlap.id());

            assertTrue(publisher.configure(true, null, null, null));
            // Moving a visit before the cutoff removes its current copy, while earlier history stays.
            // A different visit that moves back into the window gets a new current copy.
            var returned = visit("old", "Fictional return from history", today + 7_200_000);
            publisher.publish(destination, List.of(future, returned), CUTOFF, ZONE);
            assertFalse(events(resolver, publishingId).containsKey(moved.title()));
            assertTrue(events(resolver, publishingId).containsKey(old.title()));
            assertEquals(returned.start(), events(resolver, publishingId).get(returned.title()).start());
        } finally {
            for (long id : new long[] { publishingId, otherId, unavailableId }) {
                resolver.delete(ContentUris.withAppendedId(syncAdapter(Calendars.CONTENT_URI), id), null, null);
            }
            settings.edit().clear().commit();
        }
    }

    @Test
    public void anonymousBlocksReconcileSeparatelyFromVisitsAndKeepTheirOwnershipAfterRestart() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.READ_CALENDAR);
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.WRITE_CALENDAR);
        ContentResolver resolver = context.getContentResolver();
        SharedPreferences settings = context.getSharedPreferences("calendar-unavailability-test", Context.MODE_PRIVATE);
        settings.edit().clear().commit();
        long calendarId = calendar(resolver, "Fictional destination", Calendars.CAL_ACCESS_OWNER, 1);
        long sourceId = calendar(resolver, "Fictional private calendar", Calendars.CAL_ACCESS_OWNER, 1);
        long nextId = calendar(resolver, "Fictional next destination", Calendars.CAL_ACCESS_OWNER, 1);
        String gray = "fictional-gray";
        ContentValues palette = new ContentValues();
        palette.put(Colors.ACCOUNT_NAME, account);
        palette.put(Colors.ACCOUNT_TYPE, "com.google");
        palette.put(Colors.COLOR_KEY, gray);
        palette.put(Colors.COLOR_TYPE, Colors.TYPE_EVENT);
        palette.put(Colors.COLOR, Color.GRAY);
        assertNotNull(resolver.insert(syncAdapter(Colors.CONTENT_URI), palette));
        try {
            String label = "Unavailable for appointments";
            long allDayCutoff = Instant.parse("2026-11-22T00:00:00Z").toEpochMilli();
            long allDayStart = allDayCutoff - 2 * DAY;
            long hour = 3_600_000L;
            long start = CUTOFF + DAY + 12 * hour;
            var publisher = new AppointmentCalendarPublisher(resolver, settings);
            var destination = publisher.writableCalendars().stream().filter(row -> row.id() == calendarId).findFirst().orElseThrow();
            assertTrue(publisher.configure(true, Long.toString(calendarId), account, destination.key()));
            var appointment = visit("existing", "Fictional patient", start + hour);
            publisher.publish(destination, List.of(appointment), CUTOFF, ZONE);
            var existing = events(resolver, calendarId).get(appointment.title());
            var unrelated = event(resolver, calendarId, label, start + 10 * hour);
            var source = event(resolver, sourceId, "Private fixture event", start);

            var archived = new AppointmentCalendarPublisher.Unavailability(CUTOFF - 3 * DAY, CUTOFF - 3 * DAY + hour, false);
            publisher.publishUnavailability(destination, List.of(archived), CUTOFF - 4 * DAY, allDayCutoff - 4 * DAY, ZONE, label);
            var fullDays = new AppointmentCalendarPublisher.Unavailability(allDayStart, allDayCutoff + DAY, true);
            var merged = new AppointmentCalendarPublisher.Unavailability(start, start + 3 * hour, false);
            publisher.publishUnavailability(destination, List.of(fullDays, merged), CUTOFF, allDayCutoff, ZONE, label);
            Map<Long, ProviderBlock> saved = providerBlocks(resolver, calendarId, label);
            assertEquals(4, saved.size());
            assertEquals(unrelated.id(), saved.get(unrelated.start()).id());
            assertEquals(merged.end(), saved.get(start).end());
            assertEquals(ZONE, saved.get(start).zone());
            assertEquals(Events.AVAILABILITY_BUSY, saved.get(start).availability());
            assertEquals(gray, saved.get(start).color());
            assertTrue(saved.get(allDayStart).allDay());
            assertEquals("UTC", saved.get(allDayStart).zone());
            assertEquals(fullDays.end(), saved.get(allDayStart).end());
            assertEquals(Events.AVAILABILITY_BUSY, saved.get(allDayStart).availability());
            assertTrue(saved.get(start).marker().startsWith("akisync."));
            assertNull(saved.get(start).description());
            assertNull(saved.get(start).location());
            assertCalendarRead(publisher, resolver, CUTOFF + DAY, saved.get(start).id(), source.id());
            var anonymous = AkiSyncCalendarPlugin.readInstances(resolver, start, start + hour, publisher.excludedCalendarIds(),
                Set.of(Long.toString(source.id())), true);
            assertEquals(1, anonymous.length());
            var timing = anonymous.getJSONObject(0);
            assertEquals(4, timing.length());
            assertEquals(source.start(), timing.getLong("begin"));
            assertEquals(source.end(), timing.getLong("end"));
            assertFalse(timing.getBoolean("allDay"));
            assertTrue(timing.getBoolean("ignored"));

            // Restart between a successful provider write and recording its reference.
            settings.edit().remove("calendarPublishingUnavailabilityEvents:" + destination.identity()).commit();
            publisher = new AppointmentCalendarPublisher(resolver, settings);
            publisher.publishUnavailability(destination, List.of(fullDays, merged), CUTOFF, allDayCutoff, ZONE, label);
            assertEquals(saved, providerBlocks(resolver, calendarId, label));

            long mergedId = saved.get(start).id();
            Uri synced = ContentUris.withAppendedId(syncAdapter(Events.CONTENT_URI), mergedId);
            ContentValues sync = new ContentValues();
            sync.put(Events._SYNC_ID, "fictional-restriction-server-id");
            sync.put(Events.DIRTY, 0);
            assertEquals(1, resolver.update(synced, sync, null, null));
            publisher.publishUnavailability(destination, List.of(fullDays, merged), CUTOFF, allDayCutoff, ZONE, label);
            assertEquals(0, providerBlocks(resolver, calendarId, label).get(start).dirty());
            sync.putNull(Events.UID_2445);
            sync.putNull(Events.CUSTOM_APP_URI);
            assertEquals(1, resolver.update(synced, sync, null, null));

            var first = new AppointmentCalendarPublisher.Unavailability(start, start + hour, false);
            var second = new AppointmentCalendarPublisher.Unavailability(start + 2 * hour, start + 3 * hour, false);
            publisher.publishUnavailability(destination, List.of(fullDays, first, second), CUTOFF, allDayCutoff, ZONE, label);
            var split = providerBlocks(resolver, calendarId, label);
            assertEquals(5, split.size());
            assertEquals(mergedId, split.get(start).id());
            assertEquals(first.end(), split.get(start).end());
            assertEquals(second.end(), split.get(second.start()).end());

            // Appointment reconciliation sees both owned namespaces. It only updates its existing visit.
            var moved = visit(appointment.id(), appointment.title(), appointment.start() + hour);
            publisher.publish(destination, List.of(moved), CUTOFF, ZONE);
            assertEquals(split, providerBlocks(resolver, calendarId, label));
            assertEquals(existing.id(), providerBlocks(resolver, calendarId, moved.title()).get(moved.start()).id());

            publisher.publishUnavailability(destination, List.of(), CUTOFF, allDayCutoff, ZONE, label);
            assertEquals(Set.of(archived.start(), unrelated.start()), providerBlocks(resolver, calendarId, label).keySet());
            assertEquals(source, events(resolver, sourceId).get(source.title()));
            var next = publisher.writableCalendars().stream().filter(row -> row.id() == nextId).findFirst().orElseThrow();
            assertTrue(publisher.configure(true, Long.toString(nextId), account, next.key()));
            assertTrue(publisher.configure(false, null, null, null));
            assertEquals(Set.of(calendarId, nextId), publisher.excludedCalendarIds());
        } finally {
            for (long id : new long[] { calendarId, sourceId, nextId }) {
                resolver.delete(ContentUris.withAppendedId(syncAdapter(Calendars.CONTENT_URI), id), null, null);
            }
            resolver.delete(syncAdapter(Colors.CONTENT_URI), Colors.COLOR_KEY + "=?", new String[] { gray });
            settings.edit().clear().commit();
        }
    }

    @Test
    public void unavailablePublishingPreferencesDefaultOnAndPersistIndependentlyOfPause() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences settings = context.getSharedPreferences("calendar-unavailability-preferences-test", Context.MODE_PRIVATE);
        settings.edit().clear().commit();
        try {
            var resolver = context.getContentResolver();
            var publisher = new AppointmentCalendarPublisher(resolver, settings);
            assertEquals(new AppointmentCalendarPublisher.UnavailabilityPreferences(true, true, true, true, true, 90),
                publisher.unavailabilityPreferences());
            var chosen = new AppointmentCalendarPublisher.UnavailabilityPreferences(false, true, false, false, true, 365);
            publisher.configureUnavailability(chosen);
            assertTrue(publisher.configure(false, null, null, null));
            var restarted = new AppointmentCalendarPublisher(resolver, settings);
            assertFalse(restarted.isEnabled());
            assertEquals(chosen, restarted.unavailabilityPreferences());
        } finally {
            settings.edit().clear().commit();
        }
    }

    private record ProviderBlock(long id, long end, String zone, boolean allDay, int availability, String color,
                                 String description, String location, String marker, int dirty) {}

    private static Map<Long, ProviderBlock> providerBlocks(ContentResolver resolver, long calendar, String title) {
        String[] columns = { Events._ID, Events.DTSTART, Events.DTEND, Events.EVENT_TIMEZONE, Events.ALL_DAY, Events.AVAILABILITY,
            Events.EVENT_COLOR_KEY, Events.DESCRIPTION, Events.EVENT_LOCATION, Events.UID_2445, Events.DIRTY };
        Map<Long, ProviderBlock> blocks = new HashMap<>();
        try (Cursor rows = resolver.query(Events.CONTENT_URI, columns, Events.CALENDAR_ID + "=? AND " + Events.DELETED
            + "=0 AND " + Events.TITLE + "=?", new String[] { Long.toString(calendar), title }, null)) {
            assertNotNull(rows);
            while (rows.moveToNext()) {
                var block = new ProviderBlock(rows.getLong(0), rows.getLong(2), rows.getString(3), rows.getInt(4) == 1,
                    rows.getInt(5), rows.getString(6), rows.getString(7), rows.getString(8), rows.getString(9), rows.getInt(10));
                assertNull(blocks.put(rows.getLong(1), block));
            }
        }
        return blocks;
    }

    private static AppointmentCalendarPublisher.Visit visit(String id, String title, long start) {
        return new AppointmentCalendarPublisher.Visit(id, title, start, start + 1_800_000);
    }

    private static void assertCalendarRead(AppointmentCalendarPublisher publisher, ContentResolver resolver,
                                           long date, long publishedId, long otherId) throws Exception {
        var read = AkiSyncCalendarPlugin.readInstances(resolver, date, date + DAY, publisher.excludedCalendarIds(),
            Collections.emptySet());
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < read.length(); i++) ids.add(read.getJSONObject(i).getString("eventId"));
        assertFalse(ids.contains(Long.toString(publishedId)));
        assertTrue(ids.contains(Long.toString(otherId)));
    }

    private long calendar(ContentResolver resolver, String name, int access, int sync) {
        ContentValues values = new ContentValues();
        values.put(Calendars.ACCOUNT_NAME, account);
        values.put(Calendars.ACCOUNT_TYPE, "com.google");
        values.put(Calendars.OWNER_ACCOUNT, account);
        values.put(Calendars.NAME, name);
        values.put(Calendars._SYNC_ID, name);
        values.put(Calendars.CALENDAR_DISPLAY_NAME, name);
        values.put(Calendars.CALENDAR_ACCESS_LEVEL, access);
        values.put(Calendars.SYNC_EVENTS, sync);
        values.put(Calendars.VISIBLE, 1);
        Uri inserted = resolver.insert(syncAdapter(Calendars.CONTENT_URI), values);
        assertNotNull(inserted);
        return ContentUris.parseId(inserted);
    }

    private Uri syncAdapter(Uri uri) {
        return uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(Calendars.ACCOUNT_NAME, account).appendQueryParameter(Calendars.ACCOUNT_TYPE, "com.google").build();
    }

    private record FixtureEvent(long id, String title, long start, long end, String zone) {}

    private static FixtureEvent event(ContentResolver resolver, long calendar, String title, long start) {
        ContentValues values = new ContentValues();
        values.put(Events.CALENDAR_ID, calendar);
        values.put(Events.TITLE, title);
        values.put(Events.DTSTART, start);
        values.put(Events.DTEND, start + 1_800_000);
        values.put(Events.EVENT_TIMEZONE, ZONE);
        Uri inserted = resolver.insert(Events.CONTENT_URI, values);
        assertNotNull(inserted);
        return new FixtureEvent(ContentUris.parseId(inserted), title, start, start + 1_800_000, ZONE);
    }

    private static Map<String, FixtureEvent> events(ContentResolver resolver, long calendar) {
        String[] columns = { Events._ID, Events.TITLE, Events.DTSTART, Events.DTEND, Events.EVENT_TIMEZONE };
        Map<String, FixtureEvent> result = new HashMap<>();
        try (Cursor rows = resolver.query(Events.CONTENT_URI, columns, Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0",
            new String[] { Long.toString(calendar) }, null)) {
            assertNotNull(rows);
            while (rows.moveToNext()) {
                String title = rows.getString(1);
                FixtureEvent row = new FixtureEvent(rows.getLong(0), title, rows.getLong(2), rows.getLong(3), rows.getString(4));
                if (result.put(title, row) != null) throw new AssertionError("Duplicate fixture event: " + title);
            }
        }
        return result;
    }
}
