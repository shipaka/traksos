plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "ru.traksos.minidiagnostic"
    compileSdk = 35
    defaultConfig {
        applicationId = "ru.traksos.minidiagnostic"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1-demo"
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
