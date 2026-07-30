// Kegwall tablet kiosk — a deliberately tiny Android wrapper around the web app's
// /tablet/:slug page (see android/README.md). Zero library dependencies: the app is a
// single Activity + framework WebView, so the only version coupling to manage is
// AGP <-> Gradle <-> Kotlin (all pinned here; the CI image pins Gradle).
plugins {
  id("com.android.application") version "8.2.2" apply false
  id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}
