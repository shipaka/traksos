package ru.traksos.minidiagnostic

// Published catalog associations only; not a diagnostic identity or permission to connect.
data class CatalogModulePart(val number:String,val targetId:String,val variant:String,val source:String)
object CatalogModuleParts {
    private val rows=listOf(
        CatalogModulePart("820011001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820011131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-011-xxx/"),
        CatalogModulePart("820019001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820019121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-019-xxx/"),
        CatalogModulePart("820008001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820008131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-008-001/"),
        CatalogModulePart("820007001","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007101","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007111","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007121","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007131","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007141","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007151","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007161","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007171","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820007181","haldex-eb2","2M — каталожная модификация","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/820-007-0012/"),
        CatalogModulePart("820026001","haldex-eb2","2M master в системе 3M","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("810011001","haldex-eb2","Ведомый узел 3M; также встречается в Gen1","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("812011001","haldex-eb2","Ведомый узел 3M; также встречается в Gen1","https://www.haldex.com/es/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen2-series/"),
        CatalogModulePart("4801021050","zf-iebs","Basic Steel","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022010","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022020","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801022030","zf-iebs","Basic Air","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023010","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023020","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023030","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023050","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023110","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023120","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023130","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801023150","zf-iebs","Standard","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024010","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024020","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024030","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024050","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024110","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024120","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024130","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("4801024150","zf-iebs","Premium","https://aftermarket.zf.com/en/aftermarket-portal/knowledge-hub/iebs-trailer-modulator/"),
        CatalogModulePart("942013001","haldex-eb4","Premium+ 2M","https://www.haldex.com/en/eu/ebs-system/eb-system/942013001/"),
        CatalogModulePart("842005001","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842005011","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842006001","haldex-eb4","Basic 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842015001","haldex-eb4","Basic+ 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842015011","haldex-eb4","Basic+ 2M без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842001001","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842001011","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842002001","haldex-eb4","Basic 2M с OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011001","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011121","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011811","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842011401","haldex-eb4","Basic+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842003001","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842003011","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842004001","haldex-eb4","Premium 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013001","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013011","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("842013131","haldex-eb4","Premium+ 2M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942015001","haldex-eb4","Basic+ 2M AM без OR","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011001","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011121","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011811","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942011401","haldex-eb4","Basic+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("942013131","haldex-eb4","Premium+ 2M AM","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("841001001","haldex-eb4","Ведомый модулятор 1M, не основной ECU","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("823034001","haldex-eb3","Master 2M в системе 3M","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf"),
        CatalogModulePart("810023001","haldex-eb3","Ведомый модулятор 1M, не основной ECU","https://www.haldex.com/globalassets/europe/61.-documents/haldex/006700150_en.pdf")
,
        CatalogModulePart("K211213","kb-itebs-x","ECO · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K211212","kb-itebs-x","PLUS · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K211211","kb-itebs-x","LAC · базовый номер","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K267862","kb-itebs-x","IAM ECO / PLUS · вариант не определён","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("K267861","kb-itebs-x","IAM LAC","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2031","kb-itebs-x","ECO · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2033","kb-itebs-x","PLUS · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf"),
        CatalogModulePart("ES2035","kb-itebs-x","LAC · тип блока","https://n0c357rmy1njbuit2friqwu.blob.core.windows.net/documents/THDArDW7I0EBhB_Y425339-000-EN_WEB.pdf")
    )
    init {
        check(rows.map { it.number to it.targetId }.distinct().size==rows.size)
    }
    private fun normalized(input:String):String? {
        if(input.length>120) return null
        // Knorr base/type lookup only. Vxx/Nxx suffixes describe software/packaging;
        // a match does not validate that this particular suffix combination exists.
        val label=input.trim().uppercase(java.util.Locale.ROOT)
        if(Regex("K[0-9]{6}(V[0-9]{2}N[0-9]{2})?").matches(label))
            return label.take(7)
        if(Regex("ES[0-9]{4}").matches(label)) return label
        if(input.any { it !in '0'..'9' && it!=' ' && it!='-' })return null
        return input.filter { it in '0'..'9' }.takeIf { it.length in 9..10 }
    }
    fun find(input:String):List<CatalogModulePart> {
        val number=normalized(input) ?: return emptyList()
        return rows.filter { it.number==number }
    }
    // Include existing Gen1 lookup instead of short-circuiting on its first match.
    fun targetIds(input:String):List<String> =
        (find(input).map { it.targetId } +
            if(HaldexEarlyReference.isListedPart(input)) listOf("haldex-eb1") else emptyList()).distinct()
    val count get()=rows.size
}
