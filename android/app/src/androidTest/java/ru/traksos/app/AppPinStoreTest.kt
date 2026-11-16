package ru.traksos.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real emulator tests: AndroidKeyStore and persisted retry rules must work
 * on both Android 10 and Android 15. Never transmit/store an entered PIN.
 */
@RunWith(AndroidJUnit4::class)
class AppPinStoreTest {
    private val ctx: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun setUp() = AppPinStore.clear(ctx)
    @After fun cleanUp() = AppPinStore.clear(ctx)

    @Test fun setupRequiresFourDigitsAndBindsAccount() {
        assertFalse(AppPinStore.create(ctx, "123", "account-A"))
        assertFalse(AppPinStore.create(ctx, "12345", "account-A"))
        assertFalse(AppPinStore.create(ctx, "abcd", "account-A"))
        assertFalse(AppPinStore.create(ctx, "1234", ""))
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(AppPinStore.enabled(ctx))
        assertEquals("account-A", AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "4321"))
        assertEquals(AppPinStore.Check.OK, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun wrongAttemptsPersistAndForceReauthentication() {
        assertTrue(AppPinStore.create(ctx, "9341", "account-B"))
        for (tryNumber in 1..4)
            assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "0000"))
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "0000"))
        assertTrue(AppPinStore.waitSeconds(ctx) > 0)
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "9341"))

        // Test-only clock simulation: clear lockout expiration, not the failed count.
        // The 15-attempt limit must survive restarts/cooldown resets.
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        for (tryNumber in 6..15) {
            p.edit().putLong("blockedUntil", 0L).commit()
            val result = AppPinStore.verify(ctx, "0000")
            if (tryNumber < 15) assertEquals(AppPinStore.Check.COOLDOWN, result)
            else assertEquals(AppPinStore.Check.RELOGIN, result)
        }
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "9341"))
    }

    @Test fun clearingPinAlsoInvalidatesOldKeystoreVerifier() {
        assertTrue(AppPinStore.create(ctx, "1234", "account-A"))
        AppPinStore.clear(ctx)
        assertFalse(AppPinStore.enabled(ctx))
        assertNull(AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "1234"))
        assertTrue(AppPinStore.create(ctx, "6543", "account-C"))
        assertEquals("account-C", AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "1234"))
        assertEquals(AppPinStore.Check.OK, AppPinStore.verify(ctx, "6543"))
    }
}
