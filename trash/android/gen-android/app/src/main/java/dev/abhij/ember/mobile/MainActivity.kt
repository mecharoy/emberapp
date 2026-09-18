package dev.abhij.ember.mobile

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Paper-coloured system bars with dark icons, whatever the phone's theme.
    val paper = Color.parseColor("#F6F1E7")
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(paper, paper),
      navigationBarStyle = SystemBarStyle.light(paper, paper),
    )
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(paper)

    // Edge-to-edge draws the page under the status bar, the gesture bar and
    // the keyboard, and not every Android WebView reports those areas to CSS.
    // Padding the content view keeps the page between the bars and shrinks it
    // while the keyboard is open, so the chat box stays in sight.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  private var webView: WebView? = null

  // Restoring a backup: the picker's answer is copied aside off the main
  // thread, then handed to the page.
  private val backupPicker = registerForActivityResult(OpenBackupFile()) { uri ->
    if (uri == null) {
      replyBackupPicked("cancel")
    } else {
      Thread {
        val problem = Backups.stage(applicationContext, uri)
        runOnUiThread { replyBackupPicked(problem) }
      }.start()
    }
  }

  private fun replyBackupPicked(result: String) {
    webView?.evaluateJavascript("window.__emberBackupPicked && window.__emberBackupPicked(${JSONObject.quote(result)})", null)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    webView.addJavascriptInterface(
      EmberBridge(applicationContext) { runOnUiThread { backupPicker.launch(arrayOf("*/*")) } },
      "EmberAndroid",
    )
  }

  override fun onResume() {
    super.onResume()
    // Also catches the moment notification permission was just granted.
    QuickNotes.refresh(applicationContext)
  }
}
