package dev.abhij.ember.mobile

import android.Manifest
import android.app.Activity
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
import android.os.Bundle
import android.service.quicksettings.TileService
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import java.io.File
import java.util.Calendar
import java.util.TimeZone

/**
 * Quick notes from outside the app: a note field in the notification drawer
 * (inline reply on a quiet, always-there notification) and a Quick Settings
 * tile that opens a small note dialog. Both write straight into the same
 * `captures` table the in-app "+ Note" sheet uses, so the note is on the
 * Today tab next time Ember opens. Note text is never shown in a notification.
 */
object QuickNotes {
  private const val CHANNEL_ID = "quick-note"
  private const val NOTIFICATION_ID = 4242
  private const val PREFS = "ember-quick-note"
  private const val KEY_ENABLED = "drawer_enabled"
  const val ACTION_REPLY = "dev.abhij.ember.mobile.QUICK_NOTE_REPLY"
  const val REMOTE_INPUT_KEY = "quick_note_text"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
    refresh(context)
  }

  /** Shows or removes the drawer notification to match the setting. */
  fun refresh(context: Context, status: String? = null) {
    if (isEnabled(context)) post(context, status) else NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  /** Local wall-clock ISO 8601 with milliseconds and offset — the same shape
   *  as isoNow() in src/db/captures.ts, so notes sort and group by day alike. */
  private fun isoNowLocal(): String {
    val c = Calendar.getInstance()
    val offsetMin = TimeZone.getDefault().getOffset(c.timeInMillis) / 60000
    val sign = if (offsetMin >= 0) "+" else "-"
    val abs = Math.abs(offsetMin)
    return String.format(
      java.util.Locale.ROOT,
      "%04d-%02d-%02dT%02d:%02d:%02d.%03d%s%02d:%02d",
      c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
      c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND), c.get(Calendar.MILLISECOND),
      sign, abs / 60, abs % 60,
    )
  }

  /** Saves one note. False when Ember's database doesn't exist yet (the app
   *  was never opened) or the write failed. */
  fun save(context: Context, text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return false
    // tauri-plugin-sql keeps sqlite:ember.db in the app config dir, which on
    // Android is the app's data directory.
    val file = File(context.dataDir, "ember.db")
    if (!file.exists()) return false
    return try {
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
        db.rawQuery("PRAGMA busy_timeout = 4000", null).close()
        db.execSQL("INSERT INTO captures (created_at, text, mood_emoji) VALUES (?, ?, NULL)", arrayOf(isoNowLocal(), trimmed))
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Quick note", NotificationManager.IMPORTANCE_LOW).apply {
      description = "A note field that stays in the notification drawer"
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun post(context: Context, status: String?) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    ensureChannel(context)

    val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
    val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0

    val replyIntent = Intent(context, QuickNoteReceiver::class.java).setAction(ACTION_REPLY)
    val replyPending = PendingIntent.getBroadcast(context, 1, replyIntent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel("What's on your mind?").build()
    val replyAction = NotificationCompat.Action.Builder(R.drawable.ic_stat_ember, "Jot a note", replyPending)
      .addRemoteInput(remoteInput)
      .setAllowGeneratedReplies(false)
      .build()

    val openIntent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val openPending = PendingIntent.getActivity(context, 2, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or immutable)

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_ember)
      .setColor(Color.parseColor("#B3441A"))
      .setContentTitle("Ember")
      .setContentText(status ?: "Something happened? Jot it down.")
      .setContentIntent(openPending)
      .addAction(replyAction)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .build()
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }
}

/** Receives the text typed into the drawer notification. */
class QuickNoteReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != QuickNotes.ACTION_REPLY) return
    val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(QuickNotes.REMOTE_INPUT_KEY)?.toString() ?: ""
    val status = when {
      text.isBlank() -> null
      QuickNotes.save(context, text) -> "Saved to today's notes. Jot another?"
      else -> "Couldn't save that. Open Ember once, then try again."
    }
    // Re-posting is also what ends the reply field's spinner.
    QuickNotes.refresh(context, status)
  }
}

/** Puts the drawer notification back after a restart. */
class QuickNoteBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      QuickNotes.refresh(context)
    }
  }
}

/** Quick Settings tile: opens the note dialog over whatever is on screen. */
class QuickNoteTileService : TileService() {
  override fun onClick() {
    super.onClick()
    val intent = Intent(this, QuickNoteActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      val pending = PendingIntent.getActivity(this, 3, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}

/** A small paper-coloured note dialog, for the tile. */
class QuickNoteActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt() }
    val ink = Color.parseColor("#28231E")
    val faint = Color.parseColor("#766C60")

    val title = TextView(this).apply {
      text = "A quick note"
      setTextColor(ink)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      typeface = android.graphics.Typeface.SERIF
    }
    val input = EditText(this).apply {
      hint = "What's on your mind?"
      setTextColor(ink)
      setHintTextColor(faint)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      typeface = android.graphics.Typeface.SERIF
      minLines = 3
      gravity = Gravity.TOP or Gravity.START
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      background = null
    }
    val cancel = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
      text = "Cancel"
      setTextColor(faint)
      setOnClickListener { finish() }
    }
    val save = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
      text = "Save"
      setTextColor(Color.parseColor("#B3441A"))
      setOnClickListener {
        if (input.text.isBlank()) return@setOnClickListener
        if (QuickNotes.save(this@QuickNoteActivity, input.text.toString())) {
          Toast.makeText(this@QuickNoteActivity, "Saved to today's notes", Toast.LENGTH_SHORT).show()
          finish()
        } else {
          Toast.makeText(this@QuickNoteActivity, "Couldn't save. Open Ember once first.", Toast.LENGTH_LONG).show()
        }
      }
    }
    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
      addView(cancel)
      addView(save)
    }
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(18), dp(14), dp(8))
      setBackgroundColor(Color.parseColor("#FCF9F3"))
      addView(title)
      addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
      addView(buttons)
    }
    setContentView(root)
    window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    input.requestFocus()
  }
}

/** window.EmberAndroid in the webview: lets Settings switch the drawer note. */
class EmberBridge(private val context: Context) {
  @JavascriptInterface
  fun isQuickNoteEnabled(): Boolean = QuickNotes.isEnabled(context)

  @JavascriptInterface
  fun setQuickNoteEnabled(enabled: Boolean) = QuickNotes.setEnabled(context, enabled)

  /** Called after notification permission is granted, so the note appears at once. */
  @JavascriptInterface
  fun refreshQuickNote() = QuickNotes.refresh(context)
}
