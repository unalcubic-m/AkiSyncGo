# AkiSync Go

AkiSync Go is a standalone app for one clinician on one Android phone. It is the only AkiSync version in active use and development. In this project, **AkiSync** means **AkiSync Go**, and all fixes and features target the Android app.

The original AkiSync web app and its Django server are retired. Their source is a read-only reference for bringing existing features and behavior to the mobile app. [Historical Django source](https://github.com/unalcubic-m/AkiSync/tree/ecf1eca760a94fc40efd5750711f87434b6e5569)

The app opens in Turkish by default. To follow the English menu names in this guide, select **English** under **İşler → Ayarlar → Dil** on Android or **İşler → Önizleme verileri → Dil** in the browser preview.

## Editable browser preview

The browser preview is for trying the Android app's mobile workflows during development. Run these commands from the repository root.

```sh
npm ci
npm run dev
```

Open the [Galaxy S24 Ultra preview](http://127.0.0.1:5173/preview/s24-ultra.html) for a fixed 384 × 832 portrait view or the [resizable preview](http://127.0.0.1:5173/) to try other sizes. Vite reloads the UI as you edit. To view it from a phone on your local network, run `npm run dev -- --host 0.0.0.0` and use the network URL Vite prints.

The preview seeds fictional records and stores edits in the browser. Use the gear on **Work** to open **Preview data** and reset to the fictional fixtures.

| Screen or behavior | Where to edit |
| --- | --- |
| Today | [src/screens/Today.tsx](src/screens/Today.tsx) |
| Patients | [src/screens/Patients.tsx](src/screens/Patients.tsx) |
| Calendar | [src/screens/Calendar.tsx](src/screens/Calendar.tsx) |
| Patient Detail | [src/screens/PatientDetail.tsx](src/screens/PatientDetail.tsx) |
| Add Appointment, edit and reschedule | [src/screens/Appointment.tsx](src/screens/Appointment.tsx) |
| Patient, treatment, note, alert and response forms | [src/screens/PatientForms.tsx](src/screens/PatientForms.tsx) |
| Planning and availability | [src/screens/Operations.tsx](src/screens/Operations.tsx) |
| Tasks and expected responses | [src/screens/Work.tsx](src/screens/Work.tsx), [src/screens/Tasks.tsx](src/screens/Tasks.tsx) |
| Navigation and shared UI | [src/App.tsx](src/App.tsx), [src/components/ui.tsx](src/components/ui.tsx) |
| Colors, type, spacing and responsive layout | [src/theme.css](src/theme.css) |
| Fictional records | [src/storage/fixtures.ts](src/storage/fixtures.ts) |
| Validation, search, scheduling and ranking | [src/domain/model.ts](src/domain/model.ts), [src/domain/workflows.ts](src/domain/workflows.ts) |

## Workflow choices

- Closing a treatment records its closure date and optional note. Active and Passive are set on the patient’s own edit form. Passive records stay searchable, and manual booking shows the Passive status.
- Planning uses urgency weights inherited from the retired Django app and weights elapsed days by three. Completed visits and clinical encounter notes count as contact. For patients without a recorded visit, elapsed time starts from the patient record’s creation date. A scheduled visit dated today or later, an open task that blocks booking, or a waiting response that blocks booking excludes a patient from planning.
- Appointments use the phone’s local date and time. Initial working hours are Monday–Friday, 09:00–17:00, and can be edited in **Calendar → Availability**. For a manually selected overlap, check **Ignore overlap for this booking** for each affected item, including closures. AkiSync records the confirmation under **Scheduling exceptions**. Manual booking records a separate reason for applicable working-hours exceptions, blocking tasks, and blocking waits.
- **Calendar** opens in **3 days** and remembers your choice of daily, three-day, weekly, or monthly view. Tap the month to jump to a date. **New appointment**, **Close for appointments**, and **Availability** open for the selected date. **Today** lists upcoming visits.
- Use the calendar view options to turn on **Working days only**. Calendar navigation skips days without working hours or patient appointments. Date-specific hours and all-day time off determine which dates count as working.
- On Android, allow calendar access once to show visible, locally stored events in **Calendar**, including events from synced Google calendars. Device events show as yellow busy time, and AkiSync checks for overlaps before saving a visit.
- AkiSync checks upcoming visits when the app opens, returns to the foreground, or receives an Android calendar change. **Current conflicts** lets you ignore an event for a specific appointment or use **View event** to open the matching Calendar entry.
- Under **Calendar → Device calendar events**, tap **Ignore event** to keep an event visible and stop it from blocking or warning about any booking. Recurring events are ignored as a series. **Ignored events** lists device-wide and appointment-specific ignores and lets you restore each one. The app stores event IDs locally and reads event details from Android.
- New appointments default to the **Medium** duration, with at least one hour before the suggested start. From **Calendar**, the form opens on the selected date and suggests a time if one fits. From **Today** or a patient profile, the **New appointment** button opens at **First availability**. Set the **Easy**, **Medium**, and **Hard** lengths under **Work → Settings → Appointment durations**. Switching difficulty tries the selected date first and offers the first fitting later date when needed. **First availability**, **Next week**, and **Two weeks** search from today, seven days out, and fourteen days out.
- **Change time** offers the day's first, last, and middle blocks based on actual working hours and the selected duration. The app uses spare minutes for gaps of up to 30 minutes between patients while keeping the same number of full visits available. **Previous/Next slot** steps through the blocks on the selected date. **Previous/Next available day** selects the first block on the nearest day that fits.
- In **Calendar → Availability**, set common hours for selected weekdays or override one date. Add a one-time break or a weekly break with an optional end date or occurrence count. Move or skip individual occurrences. The agenda highlights visits that overlap a break. Slot searches avoid breaks, time off, existing bookings, and accessible device calendar events.
- Add tasks for a patient or for the clinic from **Work**. Tasks have no due-date field. New patient tasks have **Block booking while this task is open** checked by default. Completing the task clears the hold, and reopening it restores the hold. Existing tasks carry over as regular tasks.
- The **Need attention** tile on **Today** counts open tasks. Open it to see the tasks, response reviews, and scheduled visits that have ended and still need a status update.
- On a patient profile, use **Expected responses → Add lab check** to track a **Laboratory return**. Every waiting response appears in **Response reviews** immediately if the review date is blank, or on the chosen date. **Block booking** holds the patient independently of the review date. Mark the response **Resolved** when it arrives or **Cancelled** when it is no longer expected.

## Android build and verification

Use Node 22 or another supported Node version (20+), JDK 21, and Android Studio or the Android SDK with API 35. Then run the build and open Android Studio.

```sh
npm ci
npm run android:sync
npm run android:open
```

To build a debug APK from the command line, run `./gradlew :app:assembleDebug` from `android` after syncing. The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

For the workspace-local tools installed under `.android-tools`, run these commands from the mobile directory.

```sh
export JAVA_HOME="$PWD/.android-tools/jdk"
export ANDROID_HOME="$PWD/.android-tools/sdk"
export ANDROID_USER_HOME="$PWD/.android-tools/android-user"
export GRADLE_USER_HOME="$PWD/.android-tools/gradle"
export PATH="$PWD/.android-tools/node/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
npm run android:sync
(cd android && ./gradlew :app:assembleDebug)
```

You can copy the generated debug APK to your phone and open it there, or install it with ADB.

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

With those environment variables set, this starts the workspace’s Android 15 test emulator.

```sh
ANDROID_AVD_HOME="$PWD/.android-tools/avd" "$ANDROID_HOME/emulator/emulator" -avd AkiSync_API_35 -no-snapshot -gpu swiftshader
```

The build packages the frontend and icons locally. On first launch choose or create a dedicated folder on the phone. AkiSync saves readable records in `AkiSync.sqlite` in that folder and uses `AkiSync-recovery.sqlite` to recover from an interrupted write. The selected folder is also the storage root for future patient images. To make a plaintext backup, close AkiSync and copy both SQLite files together. A new installation can open the copied folder.

Open **Settings** with the gear on **Work** to copy records to another folder or turn on the optional app passphrase. The passphrase is off by default. It only controls entry to the app. Anyone who can access the files can read the records.

Under **Work → Settings → Publish to Google Calendar**, choose **Set up publishing**, allow Android calendar access, and select the dedicated **AkiSync Appointments** calendar. Check the account shown before starting. Enable sync for the calendar on the phone and share it with the recipient in Google Calendar using **See event details**.

AkiSync publishes patient names and appointment times for scheduled and completed visits from midnight yesterday onward in the phone’s scheduling time zone. Earlier published events stay as history. **Saved to the phone calendar** confirms the Android write. Google syncs the change separately, including after the phone reconnects. **Pause publishing** stops writes and keeps the dedicated calendar excluded from AkiSync’s calendar and conflict checks. **Resume publishing** catches up within the current date window.

Under **Work → Settings → Import patient list**, open a JSON file with the format `akisync-patient-list`, version `1`, and a `patients` array of `name` and `status` entries. Use `Active` or `Passive` for status. Review the counts and select **Import patients**. Matching names retain their existing records.

To permanently remove one patient and their linked records, open **Patients → [patient] → Edit patient → Delete patient** and confirm.

Existing encrypted vaults can be moved to a selected folder after unlocking with the previous app passphrase. AkiSync verifies the new folder database before retiring the old vault. To import an encrypted backup from the previous version, use **Work → Settings → Restore a backup from an older version**.

Use fictional data for debug builds. To verify changes on Android:

1. Open a fresh install in airplane mode, choose a folder, and add a fictional record.
2. Reopen the app and confirm that the file contains the saved record and that the app opens without a passphrase.
3. Enable a passphrase, verify the unlock screen, then turn it off and relaunch.
4. Upgrade an earlier install containing fictional data and verify the patient and appointment records after moving them to the folder.
5. With a test device connected, run `cd android && ./gradlew connectedDebugAndroidTest` to exercise the plaintext SQLite format and incomplete-write checks.
6. Using fictional visits on a dedicated Google calendar, check that a visit older than yesterday stays out of the first publish, while visits yesterday, today, and far in the future appear. Rename, reschedule, cancel, and delete visits, then retry and reopen AkiSync to check for duplicates. Move one published visit before the cutoff and check that its old in-window copy disappears.
7. Make a booking change offline, reconnect, and check the recipient’s Google Calendar Day and Week views. Pause publishing and confirm the local visit appears once and still occupies its slot. Add an overlapping event on another calendar and confirm that AkiSync flags it. Revoke calendar permission and verify that local saves still work and publishing can resume after permission is restored.

## Automated checks

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

The browser tests cover the first workflow with networking off after preview load, scheduling conflicts and exceptions, planning eligibility, and responsive layouts. They also run the packaged Android frontend offline against a simulated native bridge to exercise first folder selection, record copies, and the optional app passphrase.
