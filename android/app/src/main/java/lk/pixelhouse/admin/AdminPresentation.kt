package lk.pixelhouse.admin

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

const val STORE_ZONE = "Asia/Colombo"
private val storeZone = ZoneId.of(STORE_ZONE)
fun displayMoney(value: Double, code: String = "LKR"): String {
    val safe = runCatching { Currency.getInstance(code) }.getOrDefault(Currency.getInstance("LKR"))
    val format = NumberFormat.getNumberInstance(Locale.forLanguageTag("en-LK")).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }
    return (if (safe.currencyCode == "LKR") "Rs. " else safe.currencyCode + " ") + format.format(value)
}
fun serverInstant(value: String): Instant? = runCatching {
    var text = value.trim().replace(' ', 'T').replace(Regex("([+-]\\d{2})$"), "$1:00")
    if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(text)) text += "T00:00:00Z"
    else if (!Regex("(?:Z|[+-]\\d{2}:\\d{2})$").containsMatchIn(text)) text += "Z"
    Instant.parse(text)
}.getOrNull()
fun displayTime(value: String): String = serverInstant(value)?.atZone(storeZone)?.format(DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH)) ?: "Not available"
fun displayDay(value: String): String = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)) }.getOrDefault(value)
fun todayInStore(): String = LocalDate.now(storeZone).toString()
fun statusTitle(value: String): String = when(value) { "pending" -> "Pending"; "credit-card" -> "Card"; "in_store" -> "In store"; else -> value.replace('_', ' ').replaceFirstChar { it.uppercase() } }
fun JSONObject.number(key: String) = optDouble(key, 0.0).takeIf { it.isFinite() } ?: 0.0

data class OrderCardData(val id: Long, val customer: String, val total: Double, val status: String, val payment: String, val date: String, val items: Int) {
    companion object { fun parse(row: JSONObject) = OrderCardData(row.optLong("id"), row.display("full_name").ifBlank { "Customer" }, row.number("total"), row.display("status"), row.display("payment_status"), row.display("created_at"), row.optInt("item_count", row.optJSONArray("items")?.length() ?: 0)) }
}
data class SalesPoint(val day: String, val sales: Double, val orders: Int)
fun salesPoints(array: JSONArray?, monthly: Boolean = false): List<SalesPoint> = array?.objects()?.map { SalesPoint(it.display(if(monthly) "month" else "date"), it.number("revenue"), it.optInt("orders")) }.orEmpty()
fun dailyPoints(array: JSONArray?, start: String, end: String): List<SalesPoint> {
    val rows = salesPoints(array).associateBy { it.day }
    return runCatching { generateSequence(LocalDate.parse(start)) { it.plusDays(1) }.takeWhile { !it.isAfter(LocalDate.parse(end)) }.take(733).map { rows[it.toString()] ?: SalesPoint(it.toString(), 0.0, 0) }.toList() }.getOrDefault(rows.values.toList())
}
val friendlyHomeSections = linkedMapOf("featured_gear" to "Featured Gear", "top_products" to "Top Products", "weekly_best_sellers" to "Weekly Best Sellers", "featured_products" to "Featured Products")
val settingsGroups = linkedMapOf(
    "Store details" to listOf("store_name", "currency", "store_email", "store_phone", "store_open"),
    "Payments" to listOf("cash_enabled", "bank_enabled"),
    "Delivery" to listOf("shipping_fee", "standard_delivery_enabled", "express_delivery_enabled"),
    "Notifications" to listOf("order_notifications", "low_stock_notifications", "vendor_notifications")
)
val settingTitles = mapOf("store_name" to "Store name", "currency" to "Currency code", "store_email" to "Contact email", "store_phone" to "Contact phone", "store_open" to "Accept website orders", "cash_enabled" to "Cash on delivery", "bank_enabled" to "Bank transfer", "shipping_fee" to "Standard delivery fee", "standard_delivery_enabled" to "Standard delivery", "express_delivery_enabled" to "Express delivery", "order_notifications" to "New orders", "low_stock_notifications" to "Low stock", "vendor_notifications" to "Vendor applications")
fun settingsChanges(fields: List<Field>, values: Map<String,String>, original: JSONObject): JSONObject {
    val body = formBody(fields, values)
    val changed = JSONObject()
    fields.forEach { field ->
        val value = body.opt(field.key)
        val previous = original.opt(field.key)
        val same = if (value is Number && previous is Number) value.toDouble() == previous.toDouble() else value == previous
        if (!same) changed.put(field.key, value)
    }
    return changed
}
