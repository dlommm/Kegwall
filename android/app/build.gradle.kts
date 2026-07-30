import java.util.Base64

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "app.kegwall.kiosk"
  compileSdk = 34

  defaultConfig {
    applicationId = "app.kegwall.kiosk"
    minSdk = 23 // old kegerator tablets welcome (Android 6+)
    targetSdk = 34
    versionCode = 1
    versionName = "1.0"
  }

  // Optional stable signing for install-over-the-top updates: provide the keystore as
  // base64 via -PkeystoreB64 (CI passes $ANDROID_KEYSTORE_B64) plus -PkeystorePass /
  // -PkeyAlias / -PkeyPass. Without it, CI falls back to a debug build, whose
  // per-machine signature means the tablet needs an uninstall before each update —
  // see docs/install/android-tablet.md for the one-time keystore setup.
  val keystoreB64 = (findProperty("keystoreB64") as String?) ?: ""
  if (keystoreB64.isNotEmpty()) {
    val keystoreFile = layout.buildDirectory.file("kegwall-kiosk.keystore").get().asFile
    keystoreFile.parentFile.mkdirs()
    keystoreFile.writeBytes(Base64.getDecoder().decode(keystoreB64))
    signingConfigs {
      create("release") {
        storeFile = keystoreFile
        storePassword = findProperty("keystorePass") as String?
        keyAlias = findProperty("keyAlias") as String?
        keyPassword = findProperty("keyPass") as String?
      }
    }
    buildTypes.getByName("release").signingConfig = signingConfigs.getByName("release")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
}
