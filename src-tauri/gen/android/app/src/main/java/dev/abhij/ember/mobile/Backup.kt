package dev.abhij.ember.mobile

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Process
import android.provider.MediaStore
import java.io.File

/**
 * A copy of the journal in Documents/Ember, where it outlives the app: after
 * uninstalling and installing again, the first-run screen can restore it.
 * The webview writes a consistent snapshot (VACUUM INTO) to [snapshotFile];
 * [saveCopy] then puts it in Documents through MediaStore, which needs no
 * storage permission on Android 10 and newer.
 */
object Backups {
  const val FILE_NAME = "Ember backup.db"
  private val RELATIVE_DIR = Environment.DIRECTORY_DOCUMENTS + "/Ember/"

  fun supported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

  /** Where the snapshot goes. Cleared first: VACUUM INTO refuses to overwrite. */
  fun snapshotFile(context: Context): File {
    val file = File(context.cacheDir, "ember-snapshot.db")
    file.delete()
    return file
  }

  /** Copies the snapshot over this install's copy in Documents/Ember, or adds
   *  one. Returns an empty string on success, otherwise what went wrong. */
  fun saveCopy(context: Context): String {
    if (!supported()) return "Backup copies need Android 10 or newer."
    val snapshot = File(context.cacheDir, "ember-snapshot.db")
    if (!snapshot.exists() || snapshot.length() == 0L) return "The snapshot wasn't written."
    return try {
      val resolver = context.contentResolver
      val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      // Only files this install created are visible here, which is what we want.
      val existing = resolver.query(
        collection,
        arrayOf(MediaStore.MediaColumns._ID),
        "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
        arrayOf(RELATIVE_DIR, FILE_NAME),
        null,
      )?.use { c -> if (c.moveToFirst()) android.content.ContentUris.withAppendedId(collection, c.getLong(0)) else null }
      val uri = existing ?: resolver.insert(collection, ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, FILE_NAME)
        put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
        put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE_DIR)
      }) ?: return "Couldn't create the file in Documents."
      resolver.openOutputStream(uri, "wt")?.use { out -> snapshot.inputStream().use { it.copyTo(out) } }
        ?: return "Couldn't open the file in Documents."
      snapshot.delete()
      ""
    } catch (e: Exception) {
      e.message ?: "Couldn't write the backup copy."
    }
  }

  /** Closes Ember and opens it again, so a restored database goes through the
   *  migrations on a fresh start. */
  fun restart(context: Context) {
    val intent = Intent(context, RestartActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(RestartActivity.EXTRA_PID, Process.myPid())
    context.startActivity(intent)
  }
}

/** Runs in its own process: ends Ember's, then starts it again. */
class RestartActivity : Activity() {
  companion object {
    const val EXTRA_PID = "pid"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Process.killProcess(intent.getIntExtra(EXTRA_PID, -1))
    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    finish()
    Process.killProcess(Process.myPid())
  }
}
