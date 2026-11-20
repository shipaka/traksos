package ru.traksos.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import kotlin.math.roundToInt

/**
 * First-screen loading state. Only the owner's accepted 19 Nov 2026 artwork is
 * bundled; the four unapproved 15 Nov seasonal photos and their text overlays
 * must never return. The image is fitted without cropping the truck.
 */
internal object SeasonalStartupOverlay {
    fun build(ctx: Context): View {
        val root = FrameLayout(ctx)
        root.setBackgroundColor(Color.rgb(3, 23, 37))
        root.contentDescription = "TrakSOS. Загрузка приложения"
        root.addView(ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageResource(R.drawable.splash_truck)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, FrameLayout.LayoutParams(-1, -1))

        val progress = ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(0xFF0ACAF1.toInt())
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val density = ctx.resources.displayMetrics.density
        root.addView(progress, FrameLayout.LayoutParams(-1, (4*density).roundToInt(), Gravity.BOTTOM).apply {
            leftMargin = (34*density).roundToInt()
            rightMargin = (34*density).roundToInt()
            bottomMargin = (46*density).roundToInt()
        })
        return root
    }

    // Binary compatibility with the launcher; no location, weather text or
    // pre-approved imagery is fetched or painted over the owner's loading art.
    fun refreshFromYandex(@Suppress("UNUSED_PARAMETER") ctx: Context,
                          @Suppress("UNUSED_PARAMETER") overlay: View?) = Unit
}
