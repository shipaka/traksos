plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Адрес сайта и проект RuStore Push задаются при сборке (GitHub Actions → Variables):
//   APP_URL=https://traksos.ru   RUSTORE_PROJECT_ID=...
val appUrl: String = System.getenv("APP_URL") ?: "https://traksos.ru"
val rustoreProjectId: String = System.getenv("RUSTORE_PROJECT_ID") ?: ""
val versionCodeEnv: Int = (System.getenv("VERSION_CODE") ?: "1").toInt()

android {
    namespace = "ru.traksos.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.traksos.app"
        minSdk = 24
        targetSdk = 35
        versionCode = versionCodeEnv
        versionName = System.getenv("VERSION_NAME") ?: "0.1.0"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
        buildConfigField("String", "RUSTORE_PROJECT_ID", "\"$rustoreProjectId\"")
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks != null) {
                storeFile = file(ks)
                storeType = "pkcs12"
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // RuStore Push — https://www.rustore.ru/help/sdk/push-notifications/kotlin-java
    implementation("ru.rustore.sdk:pushclient:7.5.0")
}
