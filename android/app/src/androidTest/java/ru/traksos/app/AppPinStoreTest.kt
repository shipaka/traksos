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

    @Test fun backupPoliciesExcludeAllPrivateStorageForCloudAndDeviceTransfer() {
        assertEquals(0, ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
        val domains = setOf("root", "file", "database", "sharedpref", "external",
            "device_root", "device_file", "device_database", "device_sharedpref")
        fun readPolicy(resource: Int): Map<String, Set<String>> {
            val sections = mutableMapOf<String, MutableSet<String>>()
            val xml = ctx.resources.getXml(resource)
            var section = ""
            try {
                while (xml.eventType != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                    if (xml.eventType == org.xmlpull.v1.XmlPullParser.START_TAG) {
                        when (xml.name) {
                            "full-backup-content", "cloud-backup", "device-transfer" -> {
                                section = xml.name
                                sections.getOrPut(section) { mutableSetOf() }
                            }
                            "include" -> fail("Unexpected backup include")
                            "exclude" -> {
                                assertEquals(".", xml.getAttributeValue(null, "path"))
                                assertTrue(section.isNotEmpty())
                                sections.getValue(section).add(xml.getAttributeValue(null, "domain"))
                            }
                        }
                    }
                    xml.next()
                }
            } finally { xml.close() }
            return sections
        }
        assertEquals(mapOf("full-backup-content" to domains), readPolicy(R.xml.traksos_backup_rules))
        assertEquals(mapOf("cloud-backup" to domains, "device-transfer" to domains),
            readPolicy(R.xml.traksos_data_extraction_rules))
    }

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
            assertTrue(p.edit().putLong("blockedUntilElapsed", android.os.SystemClock.elapsedRealtime() - 1L).commit())
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
    @Test fun changingAccountMetadataCannotUnlockWithOriginalPin() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(p.edit().putString("ownerId", "account-B").commit())
        assertNotEquals(AppPinStore.Check.OK, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun oldUnboundVerifierRequiresAccountRecovery() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(p.edit().remove("version").commit())
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun malformedVerifierFailsClosed() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(p.edit().putString("salt", "AAAA").commit())
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun concurrentWrongAttemptsCannotLoseRetryCounts() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        val pool = java.util.concurrent.Executors.newFixedThreadPool(5)
        val start = java.util.concurrent.CountDownLatch(1)
        try {
            val results = (1..5).map {
                pool.submit<AppPinStore.Check> {
                    start.await()
                    AppPinStore.verify(ctx, "9999")
                }
            }
            start.countDown()
            val checks = results.map { it.get(15, java.util.concurrent.TimeUnit.SECONDS) }
            assertEquals(4, checks.count { it == AppPinStore.Check.WRONG })
            assertEquals(1, checks.count { it == AppPinStore.Check.COOLDOWN })
            val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
            assertEquals(5, p.getInt("failures", 0))
            assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "0123"))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test fun malformedInputConsumesAnAttempt() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        repeat(4) { assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "bad")) }
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "bad"))
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun corruptedRetryMetadataRequiresFullLoginInsteadOfCrashing() {
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(p.edit().putString("failures", "broken").commit())
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(p.edit().putInt("failures", -1).commit())
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun damagedDeadlineAndAccountMetadataDoNotUnlock() {
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(p.edit().putString("blockedUntil", "broken").commit())
        assertEquals(0L, AppPinStore.waitSeconds(ctx))
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        assertTrue(p.edit().putInt("ownerId", 123).commit())
        assertNull(AppPinStore.owner(ctx))
        assertEquals(AppPinStore.Check.RELOGIN, AppPinStore.verify(ctx, "0123"))
    }

    @Test fun legacyOrRebootedDeadlineRearmsInsteadOfUnlocking() {
        assertTrue(AppPinStore.create(ctx, "0123", "account-A"))
        repeat(4) { assertEquals(AppPinStore.Check.WRONG, AppPinStore.verify(ctx, "9999")) }
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "9999"))
        val p = ctx.getSharedPreferences("traksos_app_pin", Context.MODE_PRIVATE)
        assertTrue(p.edit().putInt("blockedBootCount", -1).putLong("blockedUntilElapsed", 0L).commit())
        assertEquals(AppPinStore.Check.COOLDOWN, AppPinStore.verify(ctx, "0123"))
        assertTrue(AppPinStore.waitSeconds(ctx) > 0L)
        assertEquals(5, p.getInt("failures", 0))
    }
}
