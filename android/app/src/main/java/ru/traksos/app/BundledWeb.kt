package ru.traksos.app

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.IOException

/**
 * Root-level public web resources shipped inside this APK.
 * The live /api/ endpoints are NEVER bundled, intercepted, or cached.
 */
class BundledWeb(private val context: Context) : WebViewAssetLoader.PathHandler {
    private val safeFile = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

    override fun handle(path: String): WebResourceResponse? {
        val relative = path.trimStart('/')
        if (relative == "api" || relative.startsWith("api/") ||
            relative == "ws" || relative.startsWith("ws/")) return null
        val file = if (relative.isEmpty()) "index.html" else relative
        if (!safeFile.matches(file)) return null
        val mime = when {
            file.endsWith(".html") -> "text/html"
            file.endsWith(".js") -> "text/javascript"
            file.endsWith(".css") -> "text/css"
            file.endsWith(".svg") -> "image/svg+xml"
            file.endsWith(".png") -> "image/png"
            file.endsWith(".ico") -> "image/x-icon"
            file.endsWith(".webp") -> "image/webp"
            file.endsWith(".woff2") -> "font/woff2"
            file.endsWith(".json") -> "application/json"
            file.endsWith(".webmanifest") -> "application/manifest+json"
            else -> return null
        }
        val input = try {
            context.assets.open("www/$file")
        } catch (_: IOException) {
            // Missing static resource: fail closed rather than fetching remote JS.
            return WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(byteArrayOf()))
        }
        return WebResourceResponse(mime, if (mime.startsWith("text/")) "UTF-8" else null, input).apply {
            responseHeaders = mapOf("Cache-Control" to "no-store",
                                    "X-Content-Type-Options" to "nosniff")
        }
    }
}
