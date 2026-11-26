package ru.traksos.minidiagnostic

import org.junit.Assert.*
import org.junit.Test

class OfflineCaptureReviewTest {
    @Test fun unknownSourceAndRawBytesPreserved() {
        val r=OfflineCaptureReview.parse("59 02 49 AB CD EF 09 00 00 01 08",false,1) as CaptureResult.Report
        assertNull(r.metadata.identity)
        assertNull(r.metadata.statusSelectionMask)
        assertNull(r.profileId)
        assertEquals(listOf(DtcStatus.ACTIVE,DtcStatus.STORED),r.records.map { it.raw.status })
        assertTrue(r.records.all { it.descriptionRu==null })
        val text=OfflineCaptureReview.reportText(r)
        assertTrue(text.contains("ABCDEF · статус 09"))
        assertTrue(text.contains("590249ABCDEF0900000108"))
        assertTrue(text.contains("источник не проверен"))
        assertTrue(text.contains("Без подтверждённой расшифровки: 2"))
        assertTrue(text.contains("Неисправность: подтверждённая расшифровка не найдена"))
    }
    @Test fun explanationAndSourceAreVisibleOnlyForReferenceProfile() {
        val id=EcuIdentity(EcuFamily.WABCO_TEBS_E,"TEST-PART","TEST-SW","TEST-HW",ElectricalPath.ISO11992)
        val catalog=DtcCatalog(listOf(DtcDefinition(id.family,"fixture","ABCDEF","Датчик колеса: обрыв цепи","Тестовый источник")))
        val capture=DiagnosticCapture(ProfileRegistry(listOf(ProfileEvidence(id,"fixture","test"))),catalog)
        val metadata=CaptureMetadata(CaptureOrigin.MANUAL_BENCH_IMPORT,id,1)
        val report=capture.importHex(metadata,"590249ABCDEF0900000108") as CaptureResult.Report
        val text=OfflineCaptureReview.reportText(report)
        assertTrue(text.contains("Справочных расшифровок по профилю: 1 из 2"))
        assertTrue(text.contains("Датчик колеса: обрыв цепи"))
        assertTrue(text.contains("Источник справочного описания: Тестовый источник"))
        assertTrue(text.contains("Без подтверждённой расшифровки: 1"))
        assertTrue(text.contains("источник не проверен"))
        val synthetic=report.copy(metadata=metadata.copy(origin=CaptureOrigin.SYNTHETIC))
        assertFalse(OfflineCaptureReview.reportText(synthetic).contains("Датчик колеса: обрыв цепи"))
        val unprofiled=report.copy(profileId=null)
        assertFalse(OfflineCaptureReview.reportText(unprofiled).contains("Датчик колеса: обрыв цепи"))
        for(desc in listOf(" ","ABCDEF"," abcdef ")) {
            assertTrue(runCatching { DtcCatalog(listOf(DtcDefinition(id.family,"fixture","ABCDEF",desc,"test"))) }.isFailure)
        }
    }
    @Test fun countReportNeverConfusesZeroWithConfirmedHealthy() {
        val result=OfflineCaptureReview.parse("59 01 49 03 00 00",true,1) as CaptureResult.Count
        assertEquals(0,result.count)
        assertEquals(3,result.formatIdentifier)
        assertNull(result.metadata.identity)
        val text=OfflineCaptureReview.reportText(result)
        assertTrue(text.contains("Количество по ответу ЭБУ: 0"))
        assertTrue(text.contains("исправность не подтверждена"))
        assertTrue(text.contains("Синтетический пример"))
    }
    @Test fun emptyPendingMalformedAndSyntheticStaySeparate() {
        assertTrue(OfflineCaptureReview.reportText(OfflineCaptureReview.parse("590249",false,1)).contains("исправность не подтверждена"))
        assertTrue(OfflineCaptureReview.reportText(OfflineCaptureReview.parse("7F1978",false,1)).contains("Промежуточный ответ"))
        val invalid=OfflineCaptureReview.parse("59 02 49 FF",false,1)
        assertTrue(invalid is CaptureResult.Rejected)
        assertTrue(OfflineCaptureReview.reportText(invalid).contains("TRUNCATED_RECORD"))
        val sample=OfflineCaptureReview.parse("590249ABCDEF09",true,1) as CaptureResult.Report
        assertEquals(CaptureOrigin.SYNTHETIC,sample.metadata.origin)
        assertTrue(OfflineCaptureReview.reportText(sample).contains("Синтетический пример"))
        assertTrue(OfflineCaptureReview.parse("A".repeat(16385),false,1) is CaptureResult.Rejected)
    }
}
