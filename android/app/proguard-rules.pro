# Мост для веб-страницы: методы с @JavascriptInterface должны сохранить имена
-keepclassmembers class ru.traksos.app.WebBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class ru.rustore.sdk.** { *; }
-dontwarn ru.rustore.sdk.**
