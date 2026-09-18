package dev.abhij.ember.mobile

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale

/**
 * Reminders at their usual lunch, break and dinner times (Settings > You):
 * "Had lunch? What did you do this morning?". The answer is typed into the
 * notification and goes straight into that day's check-in, as what they did
 * in that stretch of the day, with the time of the meal or break. The app
 * hands over the times through window.EmberAndroid.setDayReminders.
 */
object DayReminders {
  private const val PREFS = "ember-day-reminders"
  private const val CHANNEL_ID = "day-reminders"
  const val ACTION_ALARM = "dev.abhij.ember.mobile.DAY_REMINDER_ALARM"
  const val ACTION_REPLY = "dev.abhij.ember.mobile.DAY_REMINDER_REPLY"
  const val ACTION_SKIP = "dev.abhij.ember.mobile.DAY_REMINDER_SKIP"
  const val EXTRA_POINT = "point"
  const val REMOTE_INPUT_KEY = "day_reminder_text"

  /** A point in the day: its check-in column, the stretch that ends there, and the words. */
  data class Point(
    val id: String,
    val column: String,
    val stretch: String,
    val notificationId: Int,
    val title: String,
    val question: String,
    val skipLabel: String,
  )

  val POINTS = listOf(
    Point("lunch", "lunch", "morning", 5101, "Lunch time?", "What did you do this morning?", "Skipped lunch"),
    Point("break", "evening_break", "afternoon", 5102, "Taking a break?", "What did you do since lunch?", "No break today"),
    Point("dinner", "dinner", "evening", 5103, "Dinner time?", "What did you do since the break?", "Skipped dinner"),
  )

  private fun point(id: String?): Point? = POINTS.firstOrNull { it.id == id }

  /** From the app: {"enabled": bool, "lunch": "HH:MM", "break": "HH:MM", "dinner": "HH:MM"}. */
  fun configure(context: Context, json: String) {
    try {
      val config = JSONObject(json)
      val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      edit.putBoolean("enabled", config.optBoolean("enabled", false))
      for (p in POINTS) edit.putString(p.id, config.optString(p.id, ""))
      edit.apply()
    } catch (e: Exception) {
      return
    }
    scheduleAll(context)
  }

  private fun enabled(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

  private fun timeOf(context: Context, p: Point): Pair<Int, Int>? {
    val value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(p.id, "") ?: ""
    val match = Regex("^(\\d{2}):(\\d{2})$").find(value) ?: return null
    val (h, m) = match.destructured
    return h.toInt() to m.toInt()
  }

  private fun alarmIntent(context: Context, p: Point): PendingIntent {
    val intent = Intent(context, DayReminderReceiver::class.java).setAction(ACTION_ALARM).putExtra(EXTRA_POINT, p.id)
    return PendingIntent.getBroadcast(
      context,
      p.notificationId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Sets (or clears) the next alarm for every point. Safe to call often. */
  fun scheduleAll(context: Context) {
    for (p in POINTS) schedule(context, p)
  }

  fun schedule(context: Context, p: Point) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val pending = alarmIntent(context, p)
    alarms.cancel(pending)
    if (!enabled(context)) return
    val (hour, minute) = timeOf(context, p) ?: return
    val at = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= System.currentTimeMillis() + 1000) add(Calendar.DAY_OF_YEAR, 1)
    }
    val exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
    if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.timeInMillis, pending)
    else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.timeInMillis, pending)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Day reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "At lunch, the break and dinner: jot down what you did"
    }
    manager.createNotificationChannel(channel)
  }

  private fun canNotify(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun today(): String {
    val c = Calendar.getInstance()
    return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
  }

  private fun nowMinute(): String {
    val c = Calendar.getInstance()
    return String.format(Locale.ROOT, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
  }

  private fun stamp(): String {
    val c = Calendar.getInstance()
    return String.format(
      Locale.ROOT,
      "%sT%02d:%02d:%02d",
      today(),
      c.get(Calendar.HOUR_OF_DAY),
      c.get(Calendar.MINUTE),
      c.get(Calendar.SECOND),
    )
  }

  private fun openDb(context: Context): SQLiteDatabase? {
    val file = File(context.dataDir, "ember.db")
    if (!file.exists()) return null
    return try {
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).also {
        it.rawQuery("PRAGMA busy_timeout = 4000", null).close()
      }
    } catch (e: Exception) {
      null
    }
  }

  /** True when today's check-in already has this point (a time, or skipped). */
  private fun alreadyRecorded(context: Context, p: Point): Boolean {
    val db = openDb(context) ?: return false
    return try {
      db.use {
        it.rawQuery("SELECT ${p.column} FROM checkins WHERE date = ?", arrayOf(today())).use { c ->
          c.moveToFirst() && !c.isNull(0) && c.getString(0).let { v -> v.isNotEmpty() && v != "not-yet" }
        }
      }
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Writes into today's check-in: the point's time (or "skipped") unless one is
   * already there, and, with text, what they did in the stretch before it,
   * added to anything already written for that stretch.
   */
  fun record(context: Context, p: Point, text: String?, skipped: Boolean): Boolean {
    val db = openDb(context) ?: return false
    return try {
      db.use {
        val date = today()
        val value = if (skipped) "skipped" else nowMinute()
        var notes = JSONObject()
        var exists = false
        it.rawQuery("SELECT day_notes FROM checkins WHERE date = ?", arrayOf(date)).use { c ->
          if (c.moveToFirst()) {
            exists = true
            if (!c.isNull(0)) notes = try { JSONObject(c.getString(0)) } catch (e: Exception) { JSONObject() }
          }
        }
        val trimmed = text?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
          val before = notes.optString(p.stretch, "").trim()
          notes.put(p.stretch, if (before.isEmpty()) trimmed else "$before\n$trimmed")
        }
        val notesJson = if (notes.length() == 0) null else notes.toString()
        if (exists) {
          it.execSQL(
            "UPDATE checkins SET day_notes = COALESCE(?, day_notes), " +
              "${p.column} = CASE WHEN ${p.column} IS NULL OR ${p.column} = '' OR ${p.column} = 'not-yet' THEN ? ELSE ${p.column} END, " +
              "updated_at = ? WHERE date = ?",
            arrayOf(notesJson, value, stamp(), date),
          )
        } else {
          it.execSQL(
            "INSERT INTO checkins (date, habits, created_at, updated_at, ${p.column}, day_notes) VALUES (?, '{}', ?, ?, ?, ?)",
            arrayOf(date, stamp(), stamp(), value, notesJson),
          )
        }
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  fun post(context: Context, p: Point, status: String? = null) {
    if (!canNotify(context)) return
    ensureChannel(context)
    val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0

    val replyIntent = Intent(context, DayReminderReceiver::class.java).setAction(ACTION_REPLY).putExtra(EXTRA_POINT, p.id)
    val replyPending = PendingIntent.getBroadcast(context, p.notificationId + 10, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(p.question).build()
    val reply = NotificationCompat.Action.Builder(R.drawable.ic_stat_ember, "Jot it down", replyPending)
      .addRemoteInput(remoteInput)
      .setAllowGeneratedReplies(false)
      .build()

    val skipIntent = Intent(context, DayReminderReceiver::class.java).setAction(ACTION_SKIP).putExtra(EXTRA_POINT, p.id)
    val skipPending = PendingIntent.getBroadcast(
      context,
      p.notificationId + 20,
      skipIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val openIntent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val openPending = PendingIntent.getActivity(context, p.notificationId + 30, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_ember)
      .setColor(Color.parseColor("#B3441A"))
      .setContentTitle(if (status == null) p.title else "Ember")
      .setContentText(status ?: p.question)
      .setContentIntent(openPending)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
    if (status == null) {
      builder.addAction(reply).addAction(R.drawable.ic_stat_ember, p.skipLabel, skipPending)
    } else {
      builder.setSilent(true).setTimeoutAfter(4000)
    }
    NotificationManagerCompat.from(context).notify(p.notificationId, builder.build())
  }

  fun onAlarm(context: Context, id: String?) {
    val p = point(id) ?: return
    // Tomorrow's first, so a failure below never ends the reminders.
    schedule(context, p)
    if (!enabled(context) || alreadyRecorded(context, p)) return
    post(context, p)
  }

  fun onReply(context: Context, id: String?, text: String) {
    val p = point(id) ?: return
    val status = if (record(context, p, text, skipped = false)) "Added to today's check-in." else "Couldn't save that. Open Ember once, then try again."
    // Re-posting also ends the reply field's spinner.
    post(context, p, status)
  }

  fun onSkip(context: Context, id: String?) {
    val p = point(id) ?: return
    record(context, p, null, skipped = true)
    NotificationManagerCompat.from(context).cancel(p.notificationId)
  }
}

class DayReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(DayReminders.EXTRA_POINT)
    when (intent.action) {
      DayReminders.ACTION_ALARM -> DayReminders.onAlarm(context, id)
      DayReminders.ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(DayReminders.REMOTE_INPUT_KEY)?.toString() ?: ""
        DayReminders.onReply(context, id, text)
      }
      DayReminders.ACTION_SKIP -> DayReminders.onSkip(context, id)
    }
  }
}
