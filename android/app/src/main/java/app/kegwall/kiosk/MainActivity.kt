package app.kegwall.kiosk

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.util.Patterns
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Kegwall tablet kiosk: a fullscreen WebView pinned to the web app's /tablet/:slug
 * page (or any Kegwall URL — a wall works too). Single Activity, zero dependencies.
 *
 *  - First launch shows a setup screen; the URL persists in SharedPreferences.
 *  - Screen never sleeps (FLAG_KEEP_SCREEN_ON) and chrome stays hidden (immersive
 *    sticky), which is what makes it a kiosk rather than a browser.
 *  - Load failures flip to a quiet retry screen that re-attempts every 10s — a
 *    kegerator tablet must survive the server rebooting without a human touching it.
 *  - 5 taps in the top-left corner within 3s reopens setup (deliberately awkward so
 *    party guests don't find it).
 */
class MainActivity : Activity() {

  private lateinit var root: FrameLayout
  private lateinit var webView: WebView
  private lateinit var errorView: LinearLayout
  private var setupView: LinearLayout? = null

  private var cornerTaps = 0
  private var firstCornerTapAt = 0L
  private var retryScheduled = false

  private val prefs by lazy { getSharedPreferences("kiosk", MODE_PRIVATE) }
  private var url: String?
    get() = prefs.getString("url", null)
    set(value) {
      prefs.edit().putString("url", value).apply()
    }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true // the tablet flow's "remembered pourer" is localStorage
      settings.mediaPlaybackRequiresUserGesture = false
      settings.loadWithOverviewMode = true
      settings.useWideViewPort = true
      webViewClient = KioskClient()
      setBackgroundColor(Color.BLACK)
    }
    errorView = buildErrorView()
    root.addView(webView, matchParent())
    root.addView(errorView, matchParent())
    errorView.visibility = View.GONE
    setContentView(root)

    val saved = url
    if (saved == null) showSetup(prefill = "") else webView.loadUrl(saved)
  }

  override fun onResume() {
    super.onResume()
    enterImmersive()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) enterImmersive()
  }

  @Suppress("DEPRECATION")
  private fun enterImmersive() {
    window.decorView.systemUiVisibility = (
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        or View.SYSTEM_UI_FLAG_FULLSCREEN
        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      )
  }

  /** 5 taps in the top-left 15% of the screen within 3s -> setup. */
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (ev.action == MotionEvent.ACTION_DOWN) {
      val inCorner = ev.x < root.width * 0.15f && ev.y < root.height * 0.15f
      val now = System.currentTimeMillis()
      if (inCorner) {
        if (now - firstCornerTapAt > 3000) {
          cornerTaps = 0
          firstCornerTapAt = now
        }
        cornerTaps += 1
        if (cornerTaps >= 5 && setupView == null) {
          cornerTaps = 0
          showSetup(prefill = url ?: "")
        }
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // Kiosk: never exit via back. Inside the web app, back still navigates.
    if (setupView == null && webView.canGoBack()) webView.goBack()
  }

  private fun showSetup(prefill: String) {
    if (setupView != null) return
    val input = EditText(this).apply {
      hint = getString(R.string.setup_hint)
      setText(prefill)
      setSingleLine()
      setTextColor(Color.WHITE)
      setHintTextColor(Color.GRAY)
    }
    val save = Button(this).apply {
      text = getString(R.string.setup_save)
      setOnClickListener {
        var entered = input.text.toString().trim()
        if (entered.isNotEmpty() && !entered.startsWith("http")) entered = "http://$entered"
        if (Patterns.WEB_URL.matcher(entered).matches()) {
          url = entered
          hideSetup()
          errorView.visibility = View.GONE
          webView.loadUrl(entered)
        } else {
          input.error = getString(R.string.setup_hint)
        }
      }
    }
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.BLACK)
      val pad = (24 * resources.displayMetrics.density).toInt()
      setPadding(pad * 2, pad, pad * 2, pad)
      addView(TextView(this@MainActivity).apply {
        text = getString(R.string.setup_title)
        textSize = 28f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
      })
      addView(TextView(this@MainActivity).apply {
        text = getString(R.string.setup_help)
        textSize = 14f
        setTextColor(Color.LTGRAY)
        gravity = Gravity.CENTER
        setPadding(0, pad / 2, 0, pad)
      })
      addView(input)
      addView(save, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { gravity = Gravity.CENTER; topMargin = pad / 2 })
    }
    setupView = panel
    root.addView(panel, matchParent())
  }

  private fun hideSetup() {
    setupView?.let { root.removeView(it) }
    setupView = null
  }

  private fun buildErrorView(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    setBackgroundColor(Color.BLACK)
    addView(TextView(this@MainActivity).apply {
      text = getString(R.string.error_retrying)
      textSize = 18f
      setTextColor(Color.LTGRAY)
      gravity = Gravity.CENTER
    })
    addView(Button(this@MainActivity).apply {
      text = getString(R.string.error_change_url)
      setOnClickListener { showSetup(prefill = url ?: "") }
    })
  }

  private fun scheduleRetry() {
    if (retryScheduled) return
    retryScheduled = true
    root.postDelayed({
      retryScheduled = false
      if (setupView == null) url?.let { webView.loadUrl(it) }
    }, 10_000)
  }

  private fun matchParent() = FrameLayout.LayoutParams(
    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT,
  )

  private inner class KioskClient : WebViewClient() {
    override fun onReceivedError(
      view: WebView, request: WebResourceRequest, error: WebResourceError,
    ) {
      // Only a failed MAIN document flips to the retry screen — a busted favicon or
      // one lost websocket upgrade shouldn't blank a working wall.
      if (request.isForMainFrame) {
        errorView.visibility = View.VISIBLE
        scheduleRetry()
      }
    }

    override fun onPageFinished(view: WebView, loadedUrl: String) {
      if (errorView.visibility == View.VISIBLE && view.progress == 100) {
        errorView.visibility = View.GONE
      }
    }
  }
}
