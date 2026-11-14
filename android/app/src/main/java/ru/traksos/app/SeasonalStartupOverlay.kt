package ru.traksos.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.Random
import kotlin.concurrent.thread
import kotlin.math.roundToInt
import org.json.JSONObject

/** The four realistic Scania road photos are packaged inside the APK for true offline startup.
 *  Observed weather always describes Saint Petersburg, never the user's assumed location.
 *  Real Yandex weather is obtained from the TrakSOS backend; no API credential lives in Android.
 */
internal object SeasonalStartupOverlay {
    private enum class Fx { SUN, FOG, RAIN, SNOW }
    private data class Season(val name: String, val file: String, val default: String, val fx: Fx)
    private data class Weather(val fx: Fx, val description: String, val temperature: Int, val at: Long)
    private data class Scene(val name: String, val label: TextView, val effect: Particles)
    private const val PREFS = "traksos_splash_weather"
    private const val FRESH_MS = 90 * 60 * 1000L

    private fun season(ctx: Context): Season {
        val choice = if (BuildConfig.DEBUG && ctx is android.app.Activity)
            ctx.intent.getStringExtra("traksos.preview.season") else null
        val month = Calendar.getInstance().get(Calendar.MONTH) + 1
        return when (choice ?: when (month) {
            3,4,5 -> "spring"
            6,7,8 -> "summer"
            9,10,11 -> "autumn"
            else -> "winter"
        }) {
            "spring" -> Season("Весна", "spring", "Весенняя трасса · оттепель", Fx.RAIN)
            "summer" -> Season("Лето", "summer", "Летняя трасса · солнце", Fx.SUN)
            "autumn" -> Season("Осень", "autumn", "Осенняя трасса · туман", Fx.FOG)
            else -> Season("Зима", "winter", "Зимняя трасса · снег", Fx.SNOW)
        }
    }
    private fun dp(ctx: Context, n: Int) = (ctx.resources.displayMetrics.density * n).roundToInt()

    private fun observed(condition: String, description: String, temp: Int, at: Long): Weather? {
        if (temp !in -80..65 || at <= 0 || System.currentTimeMillis() - at !in 0..FRESH_MS) return null
        val fx = when (condition) {
            "clear" -> Fx.SUN
            "cloudy" -> Fx.FOG
            "rain", "storm" -> Fx.RAIN
            "snow" -> Fx.SNOW
            else -> return null
        }
        return Weather(fx, description.take(40).replace("\n", "").replace("\r", ""), temp, at)
    }

    private fun cached(ctx: Context): Weather? {
        val pref = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return observed(pref.getString("condition", "") ?: "",
            pref.getString("description", "") ?: "", pref.getInt("temp", 999), pref.getLong("at", 0))
    }

    private fun label(s: Season, w: Weather?): String {
        if (w == null) return s.default + " · сезонный фон"
        val degrees = if (w.temperature > 0) "+" + w.temperature else w.temperature.toString()
        return s.name + " · Санкт-Петербург: " + w.description.lowercase() +
            " " + degrees + "°C · Яндекс Погода"
    }

    fun build(ctx: Context): View {
        val current = season(ctx)
        val weather = cached(ctx)
        val root = FrameLayout(ctx)
        root.setBackgroundColor(Color.rgb(4,18,34))
        root.contentDescription = "TrakSOS. " + label(current, weather)
        val image = ImageView(ctx)
        image.scaleType = ImageView.ScaleType.CENTER_CROP
        try {
            ctx.assets.open("seasonal_splash/" + current.file + ".webp").use {
                image.setImageBitmap(BitmapFactory.decodeStream(it))
            }
        } catch (_: Exception) {
            image.setImageResource(R.drawable.splash_truck)
        }
        root.addView(image, FrameLayout.LayoutParams(-1,-1))

        val shade = View(ctx)
        shade.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0xEC041426.toInt(), 0x46041426, 0x10041426, 0xD2041426.toInt()))
        root.addView(shade, FrameLayout.LayoutParams(-1,-1))
        val animate = if (Build.VERSION.SDK_INT >= 26) android.animation.ValueAnimator.areAnimatorsEnabled() else true
        val particles = Particles(ctx, weather?.fx ?: current.fx, animate)
        root.addView(particles, FrameLayout.LayoutParams(-1,-1))

        val top = LinearLayout(ctx)
        top.orientation = LinearLayout.VERTICAL
        top.gravity = Gravity.CENTER_HORIZONTAL
        val wordmark = TextView(ctx)
        val title = SpannableString("TrakSOS")
        title.setSpan(ForegroundColorSpan(0xFFFF158A.toInt()),4,7,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        wordmark.text = title
        wordmark.textSize = 40f
        wordmark.typeface = Typeface.create("sans-serif-black", Typeface.BOLD_ITALIC)
        wordmark.gravity = Gravity.CENTER
        wordmark.setTextColor(Color.WHITE)
        top.addView(wordmark)
        val subtitle = TextView(ctx)
        subtitle.text = "Помощь грузовику в дороге"
        subtitle.setTextColor(0xFFE2ECF7.toInt())
        subtitle.gravity = Gravity.CENTER
        subtitle.textSize = 15f
        top.addView(subtitle, LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(ctx,4) })

        val weatherLabel = TextView(ctx)
        weatherLabel.text = label(current, weather)
        weatherLabel.gravity = Gravity.CENTER
        weatherLabel.textSize = 13f
        weatherLabel.setTextColor(Color.WHITE)
        weatherLabel.setPadding(dp(ctx,12),dp(ctx,8),dp(ctx,12),dp(ctx,8))
        weatherLabel.background = GradientDrawable().apply {
            cornerRadius = dp(ctx,24).toFloat()
            setColor(0xBE061D33.toInt())
            setStroke(dp(ctx,1),0x9961DDEE.toInt())
        }
        top.addView(weatherLabel, LinearLayout.LayoutParams(-2,-2).apply { topMargin = dp(ctx,18) })
        root.addView(top, FrameLayout.LayoutParams(-1,-2,Gravity.TOP).apply {
            topMargin = (ctx.resources.displayMetrics.heightPixels * 0.10f).roundToInt()
            leftMargin = dp(ctx,16)
            rightMargin = dp(ctx,16)
        })

        val bottom = LinearLayout(ctx)
        bottom.gravity = Gravity.CENTER
        bottom.orientation = LinearLayout.VERTICAL
        bottom.addView(TextView(ctx).apply {
            text = "Загрузка приложения…"
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
        })
        bottom.addView(ProgressBar(ctx,null,android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(0xFFFF158A.toInt())
            progressTintList = ColorStateList.valueOf(0xFFFF158A.toInt())
        },LinearLayout.LayoutParams(-1,dp(ctx,5)).apply { topMargin = dp(ctx,14) })
        root.addView(bottom,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM).apply {
            leftMargin = dp(ctx,34)
            rightMargin = dp(ctx,34)
            bottomMargin = dp(ctx,46)
        })
        root.tag = Scene(current.name,weatherLabel,particles)
        return root
    }

    /** Fire and forget: even a broken network must not delay a ready WebView. */
    fun refreshFromYandex(ctx: Context, overlay: View?) {
        val app = ctx.applicationContext
        thread(name="traksos-weather",isDaemon=true) {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(Session.server(app).trimEnd('/') + "/api/public/weather")
                if (url.protocol != "https") return@thread
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 1500
                    readTimeout = 1500
                    instanceFollowRedirects = false
                    setRequestProperty("Accept","application/json")
                }
                if (connection.responseCode != 200) return@thread
                val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText().take(4096) })
                if (json.optString("source") != "yandex" ||
                    json.optString("location") != "Санкт-Петербург") return@thread
                val condition = json.optString("condition")
                val desc = json.optString("description")
                val temp = json.optInt("temperatureC",999)
                val at = json.optLong("observedEpochSeconds",0) * 1000L
                val w = observed(condition,desc,temp,at) ?: return@thread
                app.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit()
                    .putString("condition",condition).putString("description",desc)
                    .putInt("temp",temp).putLong("at",at).apply()
                overlay?.post {
                    if (!overlay.isAttachedToWindow || overlay.visibility != View.VISIBLE) return@post
                    val scene = overlay.tag as? Scene ?: return@post
                    scene.effect.kind = w.fx
                    scene.effect.invalidate()
                    val degrees = if (w.temperature > 0) "+" + w.temperature else w.temperature.toString()
                    scene.label.text = scene.name + " · Санкт-Петербург: " + w.description.lowercase() +
                        " " + degrees + "°C · Яндекс Погода"
                    overlay.contentDescription = scene.label.text
                }
            } catch (_: Exception) {
                // The launch scene remains usable without a weather API or connection.
            } finally {
                connection?.disconnect()
            }
        }
    }

    /** Lightweight weather layers, with road reflections, never a heavy video decoder. */
    private class Particles(ctx: Context, var kind: Fx, private val animate: Boolean): View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val xs = FloatArray(76)
        private val ys = FloatArray(76)
        private val sizes = FloatArray(76)
        private val d = resources.displayMetrics.density
        private val start = SystemClock.uptimeMillis()
        init {
            val random = Random(20261114)
            for (i in xs.indices) {
                xs[i] = random.nextFloat()
                ys[i] = random.nextFloat()
                sizes[i] = 0.6f + random.nextFloat() * 1.6f
            }
            isClickable = false
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        override fun onDraw(c: Canvas) {
            super.onDraw(c)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w < 1 || h < 1) return
            val t = if (animate) (SystemClock.uptimeMillis() - start)/1000f else 0f
            when (kind) {
                Fx.RAIN -> {
                    // Rain sheen across the lower roadway; makes conditions visible on the road.
                    p.style = Paint.Style.FILL
                    p.color = 0x244BCBE8
                    c.drawRect(0f,h*.68f,w,h,p)
                    p.color = 0x7AB6F5FF
                    p.strokeWidth = d
                    for (i in 0..69) {
                        val x = (xs[i]*w + t*(18+sizes[i]*8)*d)%w
                        val y = (ys[i]*h + t*(85+sizes[i]*35)*d)%h
                        c.drawLine(x,y,x-3*d,y+(12+sizes[i]*5)*d,p)
                    }
                }
                Fx.SNOW -> {
                    p.style = Paint.Style.FILL
                    p.color = 0x248BD6FD
                    c.drawRect(0f,h*.70f,w,h,p)
                    for (i in xs.indices) {
                        p.color = if (i%3==0) Color.WHITE else 0xADDDF5FF.toInt()
                        val x = (xs[i]*w+t*5*d)%w
                        val y = (ys[i]*h+t*(17+sizes[i]*8)*d)%h
                        c.drawCircle(x,y,sizes[i]*1.25f*d,p)
                    }
                }
                Fx.FOG -> {
                    p.style = Paint.Style.FILL
                    p.color = 0x20E5F5FF
                    for(i in 0..6) {
                        val y = h*(.45f+i*.066f) + kotlin.math.sin(t*.2f+i)*5*d
                        c.drawRoundRect(-w*.1f,y,w*1.1f,y+25*d,16*d,16*d,p)
                    }
                }
                Fx.SUN -> {
                    p.color = 0x36FFF4D0
                    p.strokeWidth = d*1.8f
                    for(i in 0..9) {
                        val x = w*(.72f+i*.024f)
                        val y = h*.26f + (i%2)*6*d
                        c.drawLine(x,y,x+4*d,y+5*d,p)
                    }
                }
            }
            if (animate && isAttachedToWindow) postInvalidateDelayed(80)
        }
    }
}
