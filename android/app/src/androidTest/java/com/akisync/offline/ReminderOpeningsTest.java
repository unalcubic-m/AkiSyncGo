package com.akisync.offline;

import static org.junit.Assert.assertEquals;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.Calendar;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ReminderOpeningsTest {
    private static final TimeZone CLINIC = TimeZone.getTimeZone("Europe/Istanbul");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");
    private static final String FRIDAY = "2026-11-27";
    private static final String MONDAY = "2026-11-30";

    @Test
    public void fridayFindsMondayAndLaterChecksReactToNewBooking() throws Exception {
        JSONObject records = new JSONObject("""
            {"workingHours":[{"day":1,"start":"09:00","end":"12:00"},
                             {"day":2,"start":"09:00","end":"12:00"}]}
            """);
        Calendar friday = Calendar.getInstance(CLINIC);
        friday.setTimeInMillis(ReminderOpenings.at(FRIDAY, "10:30", CLINIC));
        var workingDay = ReminderOpenings.nextWorkingDay(records, friday);
        assertEquals(MONDAY, workingDay.date());
        assertEquals(180, ReminderOpenings.longestOpening(records, workingDay, new JSONArray(), CLINIC));

        records.put("appointments", new JSONArray("""
            [{"date":"2026-11-30","start":"09:00","end":"12:00","status":"Scheduled"}]
            """));
        assertEquals(0, ReminderOpenings.longestOpening(records, workingDay, new JSONArray(), CLINIC));

        records.put("timeOff", new JSONArray("""
            [{"from":"2026-11-30","through":"2026-11-30","hours":null}]
            """));
        assertEquals("2026-12-01", ReminderOpenings.nextWorkingDay(records, friday).date());
    }

    @Test
    public void savingAndCancellingABookingRecalculatesTheRemainingFridayReminders() throws Exception {
        JSONObject records = new JSONObject("""
            {"workingHours":[{"day":1,"start":"09:00","end":"12:00"}]}
            """);
        Calendar friday = Calendar.getInstance(CLINIC);
        friday.setTimeInMillis(ReminderOpenings.at(FRIDAY, "11:00", CLINIC));
        JSONArray times = new JSONArray().put("10:30").put("12:30").put("16:00");
        long fridayAfternoon = ReminderOpenings.at(FRIDAY, "12:30", CLINIC);
        long saturdayMorning = ReminderOpenings.at("2026-11-28", "10:30", CLINIC);

        assertEquals(fridayAfternoon, nextReminder(records, times, friday));

        JSONObject booking = new JSONObject("""
            {"date":"2026-11-30","start":"09:00","end":"12:00","status":"Scheduled"}
            """);
        records.put("appointments", new JSONArray().put(booking));
        assertEquals(saturdayMorning, nextReminder(records, times, friday));

        booking.put("status", "Cancelled");
        assertEquals(fridayAfternoon, nextReminder(records, times, friday));
        assertEquals(Long.MAX_VALUE, nextReminder(records, new JSONArray(), friday));
    }

    private static long nextReminder(JSONObject records, JSONArray times, Calendar now) {
        var day = ReminderOpenings.nextWorkingDay(records, now);
        boolean hasOpening = ReminderOpenings.longestOpening(records, day, new JSONArray(), now.getTimeZone()) >= 30;
        return AvailabilityReminderReceiver.nextReminderAt(times, now, hasOpening);
    }

    @Test
    public void countsMovedBreaksAndVisibleDeviceEvents() throws Exception {
        JSONObject records = new JSONObject("""
            {"workingHours":[{"day":1,"start":"09:00","end":"17:00"}],
             "appointments":[{"date":"2026-11-30","start":"09:00","end":"10:00","status":"Completed"},
                             {"date":"2026-11-30","start":"12:00","end":"13:00","status":"Cancelled"}],
             "timeOff":[{"from":"2026-11-30","through":"2026-11-30","hours":{"start":"16:00","end":"17:00"}}],
             "breaks":[{"from":"2026-11-23","hours":{"start":"12:00","end":"13:00"},
                        "repeat":{"weekdays":[1],"end":{"type":"never"}},
                        "changes":[{"date":"2026-11-30","replacement":{"date":"2026-11-30","start":"11:00","end":"12:00"}}]}]}
            """);
        Calendar sunday = Calendar.getInstance(CLINIC);
        sunday.setTimeInMillis(ReminderOpenings.at("2026-11-29", "16:00", CLINIC));
        var workingDay = ReminderOpenings.nextWorkingDay(records, sunday);
        JSONObject conflict = new JSONObject()
            .put("begin", ReminderOpenings.at(MONDAY, "13:00", CLINIC))
            .put("end", ReminderOpenings.at(MONDAY, "15:00", CLINIC));
        JSONArray events = new JSONArray().put(conflict);
        assertEquals(60, ReminderOpenings.longestOpening(records, workingDay, events, CLINIC));

        conflict.put("ignored", true);
        assertEquals(240, ReminderOpenings.longestOpening(records, workingDay, events, CLINIC));

        JSONObject allDay = new JSONObject().put("allDay", true)
            .put("begin", ReminderOpenings.at(MONDAY, "00:00", UTC))
            .put("end", ReminderOpenings.at("2026-12-01", "00:00", UTC));
        assertEquals(0, ReminderOpenings.longestOpening(records, workingDay, events.put(allDay), CLINIC));
    }
}
