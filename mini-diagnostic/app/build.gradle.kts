plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
// Release signing material is provided only by a trusted local release environment.
val signingNames = listOf("TRAKSOS_MINI_KEYSTORE", "TRAKSOS_MINI_STORE_PASSWORD",
    "TRAKSOS_MINI_KEY_ALIAS", "TRAKSOS_MINI_KEY_PASSWORD")
val signingValues = signingNames.map { providers.environmentVariable(it).orNull?.takeIf(String::isNotBlank) }
val hasReleaseSigning = signingValues.all { it != null }
require(hasReleaseSigning || signingValues.all { it == null }) {
    "Incomplete Mini Diagnostic release signing environment"
}
android {
    namespace = "ru.traksos.minidiagnostic"
    compileSdk = 35
    defaultConfig {
        applicationId = "ru.traksos.minidiagnostic"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "0.2-demo"
    }
    signingConfigs {
        if (hasReleaseSigning) create("privateRelease") {
            storeFile = file(signingValues[0]!!)
            storePassword = signingValues[1]!!
            keyAlias = signingValues[2]!!
            keyPassword = signingValues[3]!!
        }
    }
    buildTypes {
        getByName("release") {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("privateRelease")
        }
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("androidx.compose.foundation:foundation:1.7.5")
    testImplementation("junit:junit:4.13.2")
}
